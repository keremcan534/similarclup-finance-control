// Lucky Gift: versioned odds tables, auditable draws, and the economics of multiplier rewards.
// Reward coins are virtual; their real cost is computed separately (valuations) in reports.

import { randomInt } from 'node:crypto';

import type { Db, Row } from '../db.ts';
import { audit, type Ctx } from '../context.ts';
import { bad, conflict } from '../lib/http.ts';
import { ONE, ZERO, dec, fmt, isDecString, mul, toMinor, type Dec } from '../lib/money.ts';

export type Odds = { multiplier: string; probability: string }[];

export function validateOdds(odds: unknown): Odds {
  if (!Array.isArray(odds) || odds.length === 0) throw bad('Olasılık tablosu en az bir satır içermeli');
  const errs: string[] = [];
  let sum = ZERO;
  const seen = new Set<string>();
  odds.forEach((o: any, i) => {
    if (!isDecString(o?.multiplier) || dec(o.multiplier) < ZERO) errs.push(`Satır ${i + 1}: çarpan geçersiz`);
    if (!isDecString(o?.probability) || dec(o.probability) < ZERO || dec(o.probability) > ONE) errs.push(`Satır ${i + 1}: olasılık 0–1 arası olmalı`);
    else sum += dec(o.probability);
    if (seen.has(String(o?.multiplier))) errs.push(`Satır ${i + 1}: çarpan tekrar ediyor`);
    seen.add(String(o?.multiplier));
  });
  if (!errs.length && sum !== ONE) errs.push(`Olasılıkların toplamı 1 olmalı (şu an ${fmt(sum)})`);
  if (errs.length) throw bad('Olasılık tablosu geçersiz', errs);
  return (odds as any[]).map((o) => ({ multiplier: String(o.multiplier), probability: String(o.probability) }));
}

/** Theoretical return to player: Σ multiplier × probability (1 = all coins returned on average). */
export function expectedMultiplier(odds: Odds): Dec {
  return odds.reduce((s, o) => s + mul(dec(o.multiplier), dec(o.probability)), ZERO);
}

/** Maps a uniform draw u ∈ [0,1) onto the odds table (cumulative order as stored). */
export function pick(odds: Odds, u: Dec): string {
  let cum = ZERO;
  for (const o of odds) {
    cum += dec(o.probability);
    if (u < cum) return o.multiplier;
  }
  return odds[odds.length - 1].multiplier;
}

export function activeVersion(db: Db, code: string, at: string, version?: number | null) {
  const cfg = db.get('SELECT * FROM lucky_gift_configurations WHERE code = ?', code);
  if (!cfg) throw bad(`Tanımsız Lucky yapılandırması: ${code}`);
  const v: Row | undefined = version
    ? db.get('SELECT * FROM lucky_gift_config_versions WHERE config_id = ? AND version = ?', cfg.id, version)
    : db.get(
        "SELECT * FROM lucky_gift_config_versions WHERE config_id = ? AND status IN ('active','retired') AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?) ORDER BY valid_from DESC LIMIT 1",
        cfg.id,
        at,
        at,
      );
  if (!v) throw bad(`${code} için ${at.slice(0, 10)} tarihinde geçerli Lucky sürümü yok`);
  if (v.status === 'draft') throw bad('Taslak Lucky sürümüyle işlem yapılamaz');
  return { ...v, code, odds: JSON.parse(v.odds) as Odds } as Row & { code: string; odds: Odds };
}

function rewardsToday(db: Db, versionId: number, day: string, userRef?: string): number {
  return (
    db.value<number>(
      `SELECT COALESCE(SUM(reward_coins),0) FROM lucky_gift_results WHERE config_version_id IN
         (SELECT id FROM lucky_gift_config_versions WHERE config_id = (SELECT config_id FROM lucky_gift_config_versions WHERE id = ?))
       AND substr(occurred_at,1,10) = ? ${userRef ? 'AND user_ref = ?' : ''}`,
      ...(userRef ? [versionId, day, userRef] : [versionId, day]),
    ) ?? 0
  );
}

type ResultIn = {
  key: string;
  config_code: string;
  version: number | null;
  user_ref: string;
  spent_coins: number;
  random_value: string;
  multiplier: string;
  reward_coins: number;
  occurred_at: string;
  source: string;
  capped_by?: string | null;
};

/**
 * Records a draw made elsewhere (Similar Club server) after checking it against the version's table:
 * the multiplier must exist, the random value must map to it, and the reward must equal spend × multiplier
 * (or the max-reward cap). Each key is recorded once.
 */
export function recordLuckyResult(ctx: Ctx, r: ResultIn) {
  const { db } = ctx;
  const prev = db.get('SELECT * FROM lucky_gift_results WHERE idempotency_key = ?', r.key);
  if (prev) throw conflict(`Lucky sonucu zaten kayıtlı: ${r.key}`);
  const v = activeVersion(db, r.config_code, r.occurred_at, r.version);
  if (r.spent_coins !== v.gift_cost_coins) throw bad(`Harcanan jeton (${r.spent_coins}) sürümdeki hediye maliyetiyle (${v.gift_cost_coins}) uyuşmuyor`);
  if (!v.odds.some((o) => dec(o.multiplier) === dec(r.multiplier))) throw bad(`Çarpan ${r.multiplier} olasılık tablosunda yok`);
  if (!isDecString(r.random_value) || dec(r.random_value) < ZERO || dec(r.random_value) >= ONE) throw bad('random_value [0,1) aralığında olmalı');
  if (dec(pick(v.odds, dec(r.random_value))) !== dec(r.multiplier)) throw bad('random_value bu çarpana karşılık gelmiyor (tablo/sürüm uyuşmazlığı)');
  const expected = Math.min(Number(toMinor(mul(dec(r.spent_coins), dec(r.multiplier)), 0, 'down')), v.max_reward_coins);
  // A lower reward is only valid when a daily/user/budget limit cut it, and the event must say so.
  const limited = r.capped_by && ['daily_limit', 'user_limit', 'budget'].includes(r.capped_by);
  if (r.reward_coins > expected || (r.reward_coins < expected && !limited)) throw bad(`Ödül ${r.reward_coins} hatalı; beklenen ${expected}`);
  const capped = r.reward_coins < Number(toMinor(mul(dec(r.spent_coins), dec(r.multiplier)), 0, 'down'));
  const id = db.run(
    `INSERT INTO lucky_gift_results (idempotency_key, config_version_id, user_ref, spent_coins, random_value, multiplier, reward_coins, capped, occurred_at, source)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    r.key,
    v.id,
    r.user_ref,
    r.spent_coins,
    r.random_value,
    r.multiplier,
    r.reward_coins,
    capped ? 1 : 0,
    r.occurred_at,
    r.source,
  ).id;
  return { id, spent_coins: r.spent_coins, reward_coins: r.reward_coins, version: v.version };
}

/**
 * Server-side draw for integrations that want this platform to decide the outcome.
 * Uses a CSPRNG; daily, per-user and budget limits cap the reward (never lift it).
 */
export function drawLucky(ctx: Ctx, code: string, userRef: string): { random_value: string; multiplier: string; reward_coins: number; version: number; capped_by: string | null } {
  const { db } = ctx;
  const at = ctx.now().toISOString();
  const v = activeVersion(db, code, at);
  const u = BigInt(randomInt(0, 2 ** 47)) * 10n ** 12n / 2n ** 47n; // uniform in [0,1) at 12 decimals
  const multiplier = pick(v.odds, u);
  let reward = Number(toMinor(mul(dec(v.gift_cost_coins), dec(multiplier)), 0, 'down'));
  let cappedBy: string | null = null;
  const cap = (limit: number | null, used: number, why: string) => {
    if (limit === null || limit === undefined) return;
    const room = Math.max(0, limit - used);
    if (reward > room) {
      reward = room;
      cappedBy = why;
    }
  };
  if (reward > v.max_reward_coins) {
    reward = v.max_reward_coins;
    cappedBy = 'max_reward';
  }
  const day = at.slice(0, 10);
  cap(v.daily_reward_limit_coins, rewardsToday(db, v.id, day), 'daily_limit');
  cap(v.per_user_daily_limit_coins, rewardsToday(db, v.id, day, userRef), 'user_limit');
  if (v.total_budget_coins !== null) cap(v.total_budget_coins, db.value<number>('SELECT COALESCE(SUM(reward_coins),0) FROM lucky_gift_results WHERE config_version_id = ?', v.id) ?? 0, 'budget');
  return { random_value: fmt(u), multiplier, reward_coins: reward, version: v.version, capped_by: cappedBy };
}

export function createLuckyVersion(ctx: Ctx, code: string, body: any) {
  const { db } = ctx;
  const odds = validateOdds(body.odds);
  const cost = Number(body.gift_cost_coins);
  const maxReward = Number(body.max_reward_coins);
  if (!Number.isSafeInteger(cost) || cost <= 0) throw bad('gift_cost_coins pozitif tam sayı olmalı');
  if (!Number.isSafeInteger(maxReward) || maxReward < 0) throw bad('max_reward_coins tam sayı olmalı');
  const optInt = (v: unknown, f: string) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    if (!Number.isSafeInteger(n) || n < 0) throw bad(`${f} tam sayı olmalı`);
    return n;
  };
  return db.tx(() => {
    let cfg = db.get('SELECT * FROM lucky_gift_configurations WHERE code = ?', code);
    if (!cfg) {
      if (!body.name) throw bad('Yeni yapılandırma için name gerekli');
      db.run('INSERT INTO lucky_gift_configurations (code, name) VALUES (?,?)', code, String(body.name));
      cfg = db.get('SELECT * FROM lucky_gift_configurations WHERE code = ?', code)!;
    }
    const version = (db.value<number>('SELECT MAX(version) FROM lucky_gift_config_versions WHERE config_id = ?', cfg.id) ?? 0) + 1;
    const id = db.run(
      `INSERT INTO lucky_gift_config_versions (config_id, version, gift_cost_coins, odds, max_reward_coins, daily_reward_limit_coins, per_user_daily_limit_coins,
         total_budget_coins, reserve_coins, valid_from, status, created_by) VALUES (?,?,?,?,?,?,?,?,?,?, 'draft', ?)`,
      cfg.id,
      version,
      cost,
      JSON.stringify(odds),
      maxReward,
      optInt(body.daily_reward_limit_coins, 'daily_reward_limit_coins'),
      optInt(body.per_user_daily_limit_coins, 'per_user_daily_limit_coins'),
      optInt(body.total_budget_coins, 'total_budget_coins'),
      optInt(body.reserve_coins, 'reserve_coins') ?? 0,
      ctx.now().toISOString(),
      ctx.user?.id ?? null,
    ).id;
    audit(ctx, 'lucky.version.create', 'lucky_gift_config_versions', id, null, { code, version, odds, expected_multiplier: fmt(expectedMultiplier(odds)) });
    return { id, version };
  });
}

export function activateLuckyVersion(ctx: Ctx, versionId: number) {
  const { db } = ctx;
  const v = db.get('SELECT * FROM lucky_gift_config_versions WHERE id = ?', versionId);
  if (!v) throw bad('Sürüm bulunamadı');
  if (v.status !== 'draft') throw bad('Yalnız taslak sürüm yürürlüğe alınabilir');
  const now = ctx.now().toISOString();
  db.tx(() => {
    db.run("UPDATE lucky_gift_config_versions SET status = 'retired', valid_to = ? WHERE config_id = ? AND status = 'active'", now, v.config_id);
    db.run("UPDATE lucky_gift_config_versions SET status = 'active', valid_from = ? WHERE id = ?", now, versionId);
  });
  audit(ctx, 'lucky.version.activate', 'lucky_gift_config_versions', versionId, { status: 'draft' }, { status: 'active', valid_from: now });
}

/** Economics per config version: realised vs theoretical return, multiplier distribution, outliers, reserve. */
export function luckyAnalysis(db: Db, from: string, to: string) {
  const versions = db.all(
    `SELECT v.*, c.code, c.name FROM lucky_gift_config_versions v JOIN lucky_gift_configurations c ON c.id = v.config_id
      WHERE v.status <> 'draft' ORDER BY c.code, v.version`,
  );
  return versions.map((v) => {
    const odds = JSON.parse(v.odds) as Odds;
    const rows = db.all(
      `SELECT multiplier, COUNT(*) AS n, SUM(spent_coins) AS spent, SUM(reward_coins) AS reward, SUM(capped) AS capped
         FROM lucky_gift_results WHERE config_version_id = ? AND occurred_at >= ? AND occurred_at < ? AND reverses_id IS NULL GROUP BY multiplier`,
      v.id,
      from,
      to,
    );
    const draws = rows.reduce((s, r) => s + r.n, 0);
    const spent = rows.reduce((s, r) => s + (r.spent ?? 0), 0);
    const reward = rows.reduce((s, r) => s + (r.reward ?? 0), 0);
    const expected = expectedMultiplier(odds);
    const distribution = odds.map((o) => {
      const r = rows.find((x) => dec(x.multiplier) === dec(o.multiplier));
      const n = r?.n ?? 0;
      const expectedCount = draws ? Number(fmt(mul(dec(draws), dec(o.probability)), 2)) : 0;
      // Binomial z-score: how unusual the observed count is.
      const p = Number(o.probability);
      const sd = Math.sqrt(draws * p * (1 - p));
      const z = sd > 0 ? (n - draws * p) / sd : 0;
      return { multiplier: o.multiplier, probability: o.probability, count: n, expected_count: expectedCount, z: Math.round(z * 100) / 100, unusual: Math.abs(z) >= 3 };
    });
    const totalReward = db.value<number>('SELECT COALESCE(SUM(reward_coins),0) FROM lucky_gift_results WHERE config_version_id = ?', v.id) ?? 0;
    return {
      code: v.code,
      name: v.name,
      version: v.version,
      status: v.status,
      gift_cost_coins: v.gift_cost_coins,
      draws,
      spent_coins: spent,
      reward_coins: reward,
      realised_multiplier: spent ? fmt(dec(reward) * 10n ** 12n / dec(spent), 6) : null,
      expected_multiplier: fmt(expected, 6),
      expected_reward_coins: fmt(mul(dec(spent), expected), 0),
      difference_coins: spent ? reward - Number(fmt(mul(dec(spent), expected), 0)) : 0,
      house_edge_coins: spent - reward,
      distribution,
      budget: v.total_budget_coins,
      reserve_coins: v.reserve_coins,
      reserve_left: v.total_budget_coins === null ? null : v.total_budget_coins - totalReward,
      reserve_warning: v.total_budget_coins !== null && v.total_budget_coins - totalReward < v.reserve_coins,
    };
  });
}
