// Hakediş (payout statements) for agencies, BDs and publishers.
// A statement is calculated → approved → paid. Approved statements are frozen (DB triggers);
// later corrections are payout_adjustments booked into an open period.

import type { Db, Row } from '../db.ts';
import { actorId, audit, currency, setting, today, type Ctx } from '../context.ts';
import { bad, conflict, forbidden, notFound } from '../lib/http.ts';
import { evaluate } from '../lib/formula.ts';
import { ZERO, dec, divRound, fmt, fromMinor, mul, toMinor, type Dec } from '../lib/money.ts';
import { applyMethod, type RuleConfig } from './commission.ts';
import { convertMinor, fxRate } from './rates.ts';

export type PartyType = 'agency' | 'bd' | 'publisher';
const PARTY_TABLE: Record<PartyType, string> = { agency: 'agencies', bd: 'business_developers', publisher: 'publishers' };
const EARNING_TYPES = "('gift_receive','call_earning','lucky_spend')";

export function party(db: Db, type: PartyType, id: number): Row {
  const p = db.get(`SELECT * FROM ${PARTY_TABLE[type]} WHERE id = ?`, id);
  if (!p) throw notFound(type === 'agency' ? 'Ajans' : type === 'bd' ? 'BD' : 'Yayıncı');
  return p;
}

export function activeContract(db: Db, type: PartyType, id: number, start: string, end: string): Row | undefined {
  return db.get(
    "SELECT * FROM contracts WHERE party_type = ? AND party_id = ? AND status = 'active' AND starts_on <= ? AND (ends_on IS NULL OR ends_on >= ?) ORDER BY starts_on DESC, id DESC LIMIT 1",
    type,
    id,
    end,
    start,
  );
}

const nextDay = (d: string) => {
  const x = new Date(d + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
};
const days = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000) + 1;

/** Where-clause selecting the wallet earnings attributable to a party. */
function earningScope(type: PartyType): string {
  if (type === 'publisher') return 'publisher_id = ?';
  if (type === 'agency') return 'agency_id = ?';
  return 'agency_id IN (SELECT id FROM agencies WHERE bd_id = ?)';
}

/** Sums minor amounts grouped by currency and converts them into `cur` at `at`. */
function sumConverted(db: Db, rows: Row[], cur: string, at: string): bigint {
  return rows.reduce((s, r) => s + (r.currency ? convertMinor(db, r.total ?? 0, r.currency, cur, at) : 0n), 0n);
}

/** Period variables for period-scope rules and for the agency/BD/publisher finance screens. */
export function periodVariables(db: Db, type: PartyType, id: number, start: string, end: string, cur: string): Record<string, Dec> {
  const c = currency(db, cur);
  const at = end;
  const commission = sumConverted(
    db,
    db.all('SELECT currency, SUM(amount_minor) AS total FROM commission_allocations WHERE beneficiary_type = ? AND beneficiary_id = ? AND booked_on BETWEEN ? AND ? GROUP BY currency', type, id, start, end),
    cur,
    at,
  );
  const revenue = sumConverted(
    db,
    db.all(`SELECT value_currency AS currency, SUM(value_minor) AS total FROM wallet_transactions WHERE type IN ${EARNING_TYPES} AND ${earningScope(type)} AND booked_on BETWEEN ? AND ? GROUP BY value_currency`, id, start, end),
    cur,
    at,
  );
  const v: Record<string, Dec> = { commission_total: fromMinor(commission, c.decimals), eligible_revenue: fromMinor(revenue, c.decimals) };
  const n = (sql: string, ...p: any[]) => dec(db.value<number>(sql, ...p) ?? 0);
  if (type === 'agency' || type === 'bd') {
    v.active_publishers = n(`SELECT COUNT(DISTINCT publisher_id) FROM wallet_transactions WHERE type IN ${EARNING_TYPES} AND ${earningScope(type)} AND booked_on BETWEEN ? AND ?`, id, start, end);
  }
  if (type === 'agency') {
    v.publisher_count = n("SELECT COUNT(*) FROM publishers WHERE agency_id = ? AND status = 'active'", id);
    v.gift_coins = n("SELECT COALESCE(SUM(units),0) FROM wallet_transactions WHERE type = 'gift_receive' AND agency_id = ? AND booked_on BETWEEN ? AND ?", id, start, end);
  }
  if (type === 'bd') {
    v.agency_count = n("SELECT COUNT(*) FROM agencies WHERE bd_id = ? AND status = 'active'", id);
    v.new_agencies = n('SELECT COUNT(*) FROM agencies WHERE bd_id = ? AND substr(created_at,1,10) BETWEEN ? AND ?', id, start, end);
  }
  if (type === 'publisher') {
    v.gift_coins = n("SELECT COALESCE(SUM(units),0) FROM wallet_transactions WHERE type = 'gift_receive' AND publisher_id = ? AND booked_on BETWEEN ? AND ?", id, start, end);
    const mins = db.all("SELECT quantity FROM wallet_transactions WHERE type = 'call_earning' AND publisher_id = ? AND booked_on BETWEEN ? AND ?", id, start, end);
    v.call_minutes = mins.reduce((s, r) => s + (r.quantity ? dec(r.quantity) : ZERO), ZERO);
    v.active_days = n(`SELECT COUNT(DISTINCT booked_on) FROM wallet_transactions WHERE type IN ${EARNING_TYPES} AND publisher_id = ? AND booked_on BETWEEN ? AND ?`, id, start, end);
  }
  return v;
}

type Line = { kind: string; description: string; amount_minor: bigint; ref: string | null };

/** Builds statement lines without writing anything (also used for previews). */
export function buildStatement(db: Db, type: PartyType, id: number, start: string, end: string) {
  if (end < start) throw bad('Dönem bitişi başlangıçtan önce olamaz');
  party(db, type, id);
  const contract = activeContract(db, type, id, start, end);
  const cur = contract?.currency ?? setting(db, 'reporting_currency');
  const c = currency(db, cur);
  const lines: Line[] = [];
  const notes: string[] = [];

  // 1) transaction commissions, per rule, converted at period end
  const allocs = db.all(
    `SELECT r.code, r.name, a.currency, SUM(a.amount_minor) AS total, COUNT(*) AS n FROM commission_allocations a
       JOIN commission_rule_versions v ON v.id = a.rule_version_id JOIN commission_rules r ON r.id = v.rule_id
      WHERE a.beneficiary_type = ? AND a.beneficiary_id = ? AND a.booked_on BETWEEN ? AND ? GROUP BY r.code, a.currency ORDER BY r.code`,
    type,
    id,
    start,
    end,
  );
  for (const a of allocs) {
    const amt = convertMinor(db, a.total, a.currency, cur, end);
    const fx = a.currency === cur ? '' : ` · ${a.currency}→${cur} ${fmt(fxRate(db, a.currency, cur, end).rate, 6)}`;
    lines.push({ kind: 'commission', description: `${a.name} (${a.n} kayıt${fx})`, amount_minor: amt, ref: `rule:${a.code}` });
  }

  // 2) period-scope rules (targets, tiers, bonuses, deductions) valid at period end
  const vars = periodVariables(db, type, id, start, end, cur);
  const periodRules = db.all(
    `SELECT v.id, v.version, v.config, r.code, r.name FROM commission_rule_versions v JOIN commission_rules r ON r.id = v.rule_id
      WHERE v.status IN ('active','retired') AND v.valid_from <= ? AND (v.valid_to IS NULL OR v.valid_to > ?)`,
    end + 'T23:59:59.999Z',
    end + 'T23:59:59.999Z',
  );
  for (const r of periodRules) {
    const cfg = JSON.parse(r.config) as RuleConfig;
    if (cfg.scope !== 'period' || cfg.party_type !== type) continue;
    if (cfg.party_ids?.length && !cfg.party_ids.includes(id)) continue;
    if (cfg.condition && evaluate(cfg.condition, vars) === ZERO) continue;
    const rate = cfg.currency === cur ? null : fxRate(db, cfg.currency, cur, end).rate;
    const toB = (d: Dec) => (rate === null ? d : mul(d, rate));
    const base = cfg.method.type === 'fixed' ? ZERO : evaluate(cfg.measure!, vars);
    const amount = toMinor(applyMethod(cfg, base, vars, toB, {}), c.decimals, cfg.rounding);
    if (amount === 0n) continue;
    lines.push({ kind: cfg.line_kind === 'deduction' ? 'deduction' : 'bonus', description: `${r.name} v${r.version}`, amount_minor: cfg.line_kind === 'deduction' ? -amount : amount, ref: `rule:${r.code}` });
  }

  // 3) contract: fixed salary (pro-rated by active days) and minimum guarantee
  if (contract) {
    const from = contract.starts_on > start ? contract.starts_on : start;
    const to = contract.ends_on && contract.ends_on < end ? contract.ends_on : end;
    const share = days(from, to) / days(start, end);
    if (contract.fixed_salary_minor) {
      const sal = share >= 1 ? BigInt(contract.fixed_salary_minor) : divRound(BigInt(contract.fixed_salary_minor) * BigInt(days(from, to)), BigInt(days(start, end)));
      lines.push({ kind: 'salary', description: `Sabit maaş${share < 1 ? ` (${days(from, to)}/${days(start, end)} gün)` : ''}`, amount_minor: sal, ref: `contract:${contract.id}` });
    }
    if (contract.min_guarantee_minor) {
      const earned = lines.filter((l) => ['commission', 'bonus'].includes(l.kind)).reduce((s, l) => s + l.amount_minor, 0n);
      const g = BigInt(contract.min_guarantee_minor);
      if (earned < g) lines.push({ kind: 'min_guarantee_topup', description: `Minimum garanti tamamlaması (garanti ${fmt(fromMinor(g, c.decimals), c.decimals)})`, amount_minor: g - earned, ref: `contract:${contract.id}` });
    }
  } else notes.push('Dönemde aktif sözleşme yok: maaş ve garanti uygulanmadı, rapor para birimi kullanıldı');

  // 4) manual adjustments booked in the period
  for (const a of db.all('SELECT * FROM payout_adjustments WHERE party_type = ? AND party_id = ? AND booked_on BETWEEN ? AND ? ORDER BY id', type, id, start, end))
    lines.push({ kind: a.kind === 'deduction' ? 'deduction' : 'adjustment', description: a.reason, amount_minor: convertMinor(db, a.amount_minor, a.currency, cur, end), ref: `adjustment:${a.id}` });

  // 5) negative balance of the previous statement is carried forward once
  const prev = db.get(
    "SELECT * FROM payout_statements WHERE party_type = ? AND party_id = ? AND period_end < ? AND status IN ('approved','paid') ORDER BY period_end DESC LIMIT 1",
    type,
    id,
    start,
  );
  if (prev && prev.total_minor < 0 && !db.get("SELECT 1 FROM statement_lines l JOIN payout_statements s ON s.id = l.statement_id WHERE l.ref = ? AND s.status <> 'cancelled'", `carry:${prev.id}`))
    lines.push({ kind: 'carryover', description: `Önceki dönemden devreden negatif bakiye (#${prev.id})`, amount_minor: convertMinor(db, prev.total_minor, prev.currency, cur, end), ref: `carry:${prev.id}` });

  const total = lines.reduce((s, l) => s + l.amount_minor, 0n);
  return { party_type: type, party_id: id, period_start: start, period_end: end, currency: cur, decimals: c.decimals, lines, total_minor: total, variables: Object.fromEntries(Object.entries(vars).map(([k, x]) => [k, fmt(x)])), notes };
}

export function calculateStatement(ctx: Ctx, type: PartyType, id: number, start: string, end: string) {
  const { db } = ctx;
  const b = buildStatement(db, type, id, start, end);
  return db.tx(() => {
    const existing = db.get("SELECT * FROM payout_statements WHERE party_type = ? AND party_id = ? AND period_start = ? AND period_end = ? AND status <> 'cancelled'", type, id, start, end);
    let sid: number;
    if (existing) {
      if (existing.status !== 'calculated') throw conflict('Bu dönemin hakedişi onaylanmış; değişiklik için düzeltme kaydı girin');
      const before = { total_minor: existing.total_minor, lines: db.all('SELECT kind, description, amount_minor FROM statement_lines WHERE statement_id = ?', existing.id) };
      db.run('DELETE FROM statement_lines WHERE statement_id = ?', existing.id);
      db.run('UPDATE payout_statements SET currency = ?, total_minor = ?, calculated_at = ?, calculated_by = ? WHERE id = ?', b.currency, b.total_minor, ctx.now().toISOString(), actorId(ctx), existing.id);
      sid = existing.id;
      audit(ctx, 'statement.recalculate', 'payout_statements', sid, before, { total_minor: b.total_minor, lines: b.lines });
    } else {
      sid = db.run(
        "INSERT INTO payout_statements (party_type, party_id, period_start, period_end, currency, status, total_minor, calculated_at, calculated_by, note) VALUES (?,?,?,?,?, 'calculated', ?,?,?,?)",
        type,
        id,
        start,
        end,
        b.currency,
        b.total_minor,
        ctx.now().toISOString(),
        actorId(ctx),
        b.notes.join(' · ') || null,
      ).id;
      audit(ctx, 'statement.calculate', 'payout_statements', sid, null, { total_minor: b.total_minor, lines: b.lines });
    }
    for (const l of b.lines) db.run('INSERT INTO statement_lines (statement_id, kind, description, amount_minor, ref) VALUES (?,?,?,?,?)', sid, l.kind, l.description, l.amount_minor, l.ref);
    return { id: sid, ...b };
  });
}

/** Calculates every active party of a type for the period; returns per-party outcome. */
export function calculateAll(ctx: Ctx, type: PartyType, start: string, end: string) {
  const ids = ctx.db.all<{ id: number }>(`SELECT id FROM ${PARTY_TABLE[type]} WHERE status = 'active'`).map((r) => r.id);
  return ids.map((id) => {
    try {
      const s = calculateStatement(ctx, type, id, start, end);
      return { party_id: id, ok: true, statement_id: s.id, total_minor: s.total_minor };
    } catch (e: any) {
      return { party_id: id, ok: false, error: e.message };
    }
  });
}

/** Approval of a calculated statement. With dual control the calculator cannot approve their own. */
export function approveStatement(ctx: Ctx, id: number, note?: string | null) {
  const { db } = ctx;
  const s = db.get('SELECT * FROM payout_statements WHERE id = ?', id);
  if (!s) throw notFound('Hakediş');
  if (s.status !== 'calculated') throw conflict('Yalnız hesaplanmış hakediş onaylanabilir');
  if (setting(db, 'dual_control') === '1' && s.calculated_by === actorId(ctx)) throw forbidden('Görevler ayrılığı: hakedişi hesaplayan kişi onaylayamaz');
  db.run("UPDATE payout_statements SET status = 'approved', approved_by = ?, approved_at = ?, note = COALESCE(?, note) WHERE id = ?", actorId(ctx), ctx.now().toISOString(), note ?? null, id);
  audit(ctx, 'statement.approve', 'payout_statements', id, { status: 'calculated' }, { status: 'approved' }, note);
}

export function cancelStatement(ctx: Ctx, id: number, reason: string) {
  const { db } = ctx;
  const s = db.get('SELECT * FROM payout_statements WHERE id = ?', id);
  if (!s) throw notFound('Hakediş');
  if (s.paid_minor > 0) throw conflict('Ödeme yapılmış hakediş iptal edilemez');
  if (s.status === 'cancelled') return;
  db.run("UPDATE payout_statements SET status = 'cancelled', note = ? WHERE id = ?", reason, id);
  audit(ctx, 'statement.cancel', 'payout_statements', id, { status: s.status }, { status: 'cancelled' }, reason);
}

export function setDispute(ctx: Ctx, id: number, amountMinor: bigint, note: string) {
  const { db } = ctx;
  const s = db.get('SELECT * FROM payout_statements WHERE id = ?', id);
  if (!s) throw notFound('Hakediş');
  if (amountMinor < 0n || amountMinor > BigInt(Math.max(0, s.total_minor))) throw bad('İtiraz tutarı 0 ile hakediş toplamı arasında olmalı');
  db.run('UPDATE payout_statements SET disputed_minor = ? WHERE id = ?', amountMinor, id);
  audit(ctx, 'statement.dispute', 'payout_statements', id, { disputed_minor: s.disputed_minor }, { disputed_minor: amountMinor }, note);
}

export function recordPayout(ctx: Ctx, id: number, p: { amount_minor: bigint; paid_on: string; method: string; reference: string | null; idempotency_key: string }) {
  const { db } = ctx;
  const dup = db.get('SELECT * FROM payouts WHERE idempotency_key = ?', p.idempotency_key);
  if (dup) {
    if (dup.statement_id !== id || BigInt(dup.amount_minor) !== p.amount_minor) throw conflict('Bu ödeme anahtarı farklı bir ödeme için kullanılmış');
    return { id: dup.id, duplicate: true };
  }
  const s = db.get('SELECT * FROM payout_statements WHERE id = ?', id);
  if (!s) throw notFound('Hakediş');
  if (s.status !== 'approved') throw conflict('Yalnız onaylı ve ödenmemiş hakedişe ödeme girilebilir');
  if (setting(db, 'dual_control') === '1' && s.approved_by === actorId(ctx) && s.calculated_by === actorId(ctx)) throw forbidden('Görevler ayrılığı');
  const open = BigInt(s.total_minor) - BigInt(s.paid_minor) - BigInt(s.disputed_minor);
  if (p.amount_minor <= 0n) throw bad('Ödeme tutarı pozitif olmalı');
  if (p.amount_minor > open) throw bad(`Ödeme açık tutarı aşıyor (itiraz hariç açık: ${fmt(fromMinor(open, currency(db, s.currency).decimals))} ${s.currency})`);
  return db.tx(() => {
    const ftId = db.run(
      `INSERT INTO financial_transactions (idempotency_key, type, occurred_at, booked_on, currency, amount_minor, net_minor, source, source_ref, meta, created_by)
       VALUES (?, 'payout', ?, ?, ?, ?, ?, 'manual', ?, ?, ?)`,
      `payout:${p.idempotency_key}`,
      p.paid_on + 'T00:00:00.000Z',
      p.paid_on,
      s.currency,
      -p.amount_minor,
      -p.amount_minor,
      `statement:${id}`,
      JSON.stringify({ party_type: s.party_type, party_id: s.party_id, method: p.method }),
      actorId(ctx),
    ).id;
    const pid = db.run(
      'INSERT INTO payouts (idempotency_key, statement_id, amount_minor, currency, paid_on, method, reference, financial_tx_id, created_by) VALUES (?,?,?,?,?,?,?,?,?)',
      p.idempotency_key,
      id,
      p.amount_minor,
      s.currency,
      p.paid_on,
      p.method,
      p.reference,
      ftId,
      actorId(ctx),
    ).id;
    const paid = BigInt(s.paid_minor) + p.amount_minor;
    db.run('UPDATE payout_statements SET paid_minor = ?, status = ? WHERE id = ?', paid, paid >= BigInt(s.total_minor) ? 'paid' : 'approved', id);
    audit(ctx, 'payout.record', 'payout_statements', id, { paid_minor: s.paid_minor }, { paid_minor: paid, payout_id: pid, amount_minor: p.amount_minor });
    return { id: pid, duplicate: false };
  });
}

export function addAdjustment(ctx: Ctx, a: { party_type: PartyType; party_id: number; amount_minor: bigint; currency: string; kind: string; reason: string; booked_on?: string | null }) {
  const { db } = ctx;
  party(db, a.party_type, a.party_id);
  const booked = a.booked_on ?? today(ctx);
  if (db.get("SELECT 1 FROM periods WHERE status = 'closed' AND starts_on <= ? AND ends_on >= ?", booked, booked)) throw conflict('Kapalı döneme düzeltme girilemez; açık bir tarih seçin');
  const id = db.run(
    'INSERT INTO payout_adjustments (party_type, party_id, booked_on, currency, amount_minor, kind, reason, created_by) VALUES (?,?,?,?,?,?,?,?)',
    a.party_type,
    a.party_id,
    booked,
    a.currency,
    a.amount_minor,
    a.kind,
    a.reason,
    actorId(ctx),
  ).id;
  audit(ctx, 'adjustment.create', 'payout_adjustments', id, null, a, a.reason);
  return { id };
}

/** Agency / BD / publisher finance summary for one period (screen 5.2). */
export function partyFinance(db: Db, type: PartyType, id: number, start: string, end: string) {
  const b = buildStatement(db, type, id, start, end);
  const statements = db.all('SELECT * FROM payout_statements WHERE party_type = ? AND party_id = ? ORDER BY period_end DESC LIMIT 24', type, id);
  const liveStatements = statements.filter((s) => s.status !== 'cancelled');
  const sumBy = (f: (s: Row) => number) => liveStatements.reduce((s, x) => s + BigInt(f(x)), 0n);
  const extra: Record<string, unknown> = {};
  if (type === 'agency') {
    // Commissions to the agency's publishers and its BD, from transactions of this agency.
    const pubShare = db.all(
      `SELECT a.currency, SUM(a.amount_minor) AS total FROM commission_allocations a JOIN wallet_transactions w ON a.tx_kind = 'wallet' AND w.id = a.tx_id
        WHERE w.agency_id = ? AND a.beneficiary_type = 'publisher' AND a.booked_on BETWEEN ? AND ? GROUP BY a.currency`,
      id,
      start,
      end,
    );
    const bdShare = db.all(
      `SELECT a.currency, SUM(a.amount_minor) AS total FROM commission_allocations a JOIN wallet_transactions w ON a.tx_kind = 'wallet' AND w.id = a.tx_id
        WHERE w.agency_id = ? AND a.beneficiary_type = 'bd' AND a.booked_on BETWEEN ? AND ? GROUP BY a.currency`,
      id,
      start,
      end,
    );
    const pub = sumConverted(db, pubShare, b.currency, end);
    const bd = sumConverted(db, bdShare, b.currency, end);
    const revenue = toMinor(dec(b.variables.eligible_revenue), b.decimals);
    extra.publisher_share_minor = pub;
    extra.bd_share_minor = bd;
    extra.users_paying = db.value<number>(
      `SELECT COUNT(DISTINCT s.user_ref) FROM wallet_transactions s JOIN wallet_transactions r ON r.idempotency_key = replace(s.idempotency_key, ':send', ':recv')
        WHERE s.type = 'gift_send' AND r.agency_id = ? AND s.booked_on BETWEEN ? AND ?`,
      id,
      start,
      end,
    );
    extra.net_contribution_minor = revenue - b.total_minor - pub - bd;
  }
  return {
    ...b,
    party: party(db, type, id),
    statements,
    paid_minor: sumBy((s) => s.paid_minor),
    pending_minor: sumBy((s) => (s.status === 'approved' ? s.total_minor - s.paid_minor : 0)),
    disputed_minor: sumBy((s) => s.disputed_minor),
    ...extra,
  };
}

export { nextDay };
