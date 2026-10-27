// Commission engine. Rules are data (commission_rule_versions.config), never code.
//
// Transaction-scope rules run once per ledger transaction, in stages:
//   - rules in the same stage share one base ("parallel"),
//   - `remaining` = distributable − allocations of earlier stages ("sequential"),
//   - `r_<code>` exposes an earlier rule's result to later formulas.
// All amounts for one transaction are computed in its base currency B
// (financial: tx currency; wallet: the frozen valuation currency). Fixed amounts, caps and
// unit prices written in the rule currency are converted into B at the transaction date.
// Results are stored as commission_allocations with the exact rule version and a trace;
// refunds add reversal rows. Nothing is ever recomputed in place.

import type { Db, Row } from '../db.ts';
import { audit, currency, type Ctx } from '../context.ts';
import { bad } from '../lib/http.ts';
import { FormulaError, evaluate, validateFormula } from '../lib/formula.ts';
import { HUNDRED, MoneyError, ROUNDING_MODES, ZERO, dec, divRound, fmt, fromMinor, isDecString, mul, pctOf, toMinor, type Dec, type RoundingMode } from '../lib/money.ts';
import { MissingRateError, fxRate } from './rates.ts';

export type Method =
  | { type: 'percent'; percent: string }
  | { type: 'fixed'; amount: string }
  | { type: 'per_unit'; measure: 'quantity' | 'units'; price: string }
  | { type: 'tiered'; mode: 'whole' | 'marginal'; tiers: { from: string; percent: string }[] }
  | { type: 'formula'; expr: string };

export type BeneficiaryType = 'agency' | 'bd' | 'publisher' | 'provider' | 'other';

export type RuleConfig = {
  scope: 'transaction' | 'period';
  currency: string;
  method: Method;
  min?: string | null;
  max?: string | null;
  rounding: RoundingMode;
  condition?: string | null;
  // transaction scope
  tx_kind?: 'financial' | 'wallet';
  tx_types?: string[];
  filters?: { product_refs?: string[]; item_refs?: string[]; channel_codes?: string[]; agency_ids?: number[]; publisher_ids?: number[] };
  beneficiary?: { type: BeneficiaryType; from?: 'tx_agency' | 'tx_publisher' | 'agency_bd'; id?: number; name?: string };
  base?: string;
  stage?: number;
  refund?: 'reverse_proportional' | 'none';
  // period scope
  party_type?: 'agency' | 'bd' | 'publisher';
  party_ids?: number[];
  measure?: string;
  line_kind?: 'bonus' | 'deduction';
};

export const FINANCIAL_TX_TYPES = ['purchase', 'refund', 'chargeback', 'payout', 'expense_payment', 'channel_settlement', 'adjustment'] as const;
export const WALLET_TX_TYPES = [
  'coin_credit',
  'bonus_grant',
  'promotion',
  'coin_spend',
  'gift_send',
  'gift_receive',
  'call_charge',
  'call_earning',
  'game_entry',
  'game_result',
  'lucky_spend',
  'lucky_reward',
  'publisher_earning',
  'admin_adjustment',
  'reversal',
] as const;

export const TX_VARIABLES = {
  financial: ['gross_amount', 'tax_amount', 'channel_fee', 'net_of_tax', 'net_collected', 'coins', 'distributable', 'remaining'],
  wallet: ['units', 'quantity', 'coin_value', 'distributable', 'remaining'],
};
export const PERIOD_VARIABLES: Record<string, string[]> = {
  agency: ['commission_total', 'eligible_revenue', 'gift_coins', 'active_publishers', 'publisher_count'],
  bd: ['commission_total', 'eligible_revenue', 'agency_count', 'new_agencies', 'active_publishers'],
  publisher: ['commission_total', 'eligible_revenue', 'gift_coins', 'call_minutes', 'active_days'],
};

// ---- validation ----------------------------------------------------------------------
function decField(errors: string[], v: unknown, field: string, opts: { required?: boolean; nonNegative?: boolean } = {}) {
  if (v === undefined || v === null || v === '') {
    if (opts.required) errors.push(`${field} zorunlu`);
    return;
  }
  if (!isDecString(v)) errors.push(`${field} geçerli bir ondalık sayı olmalı`);
  else if (opts.nonNegative && dec(v as string) < ZERO) errors.push(`${field} negatif olamaz`);
}

/** Validates and normalises a rule config. Throws 400 with every problem listed. */
export function validateRuleConfig(db: Db, raw: any, ruleCodes: string[] = []): RuleConfig {
  const e: string[] = [];
  if (!raw || typeof raw !== 'object') throw bad('Kural yapılandırması eksik');
  const scope = raw.scope ?? 'transaction';
  if (!['transaction', 'period'].includes(scope)) e.push('scope transaction veya period olmalı');
  if (typeof raw.currency !== 'string' || !db.get('SELECT 1 FROM currencies WHERE code = ?', raw.currency)) e.push('currency tanımlı bir para birimi olmalı');
  const rounding = raw.rounding ?? 'half_even';
  if (!ROUNDING_MODES.includes(rounding)) e.push(`rounding şunlardan biri olmalı: ${ROUNDING_MODES.join(', ')}`);
  decField(e, raw.min, 'min', { nonNegative: true });
  decField(e, raw.max, 'max', { nonNegative: true });
  if (isDecString(raw.min) && isDecString(raw.max) && dec(raw.min) > dec(raw.max)) e.push('min, max değerinden büyük olamaz');

  const vars: string[] =
    scope === 'transaction'
      ? [...(TX_VARIABLES[raw.tx_kind as 'financial' | 'wallet'] ?? []), ...ruleCodes.map((c) => `r_${c.toLowerCase()}`)]
      : (PERIOD_VARIABLES[raw.party_type] ?? []);

  const m = raw.method ?? {};
  switch (m.type) {
    case 'percent':
      decField(e, m.percent, 'method.percent', { required: true, nonNegative: true });
      if (isDecString(m.percent) && dec(m.percent) > HUNDRED * 10n) e.push('method.percent çok büyük');
      break;
    case 'fixed':
      decField(e, m.amount, 'method.amount', { required: true });
      break;
    case 'per_unit':
      if (!['quantity', 'units'].includes(m.measure)) e.push('method.measure quantity veya units olmalı');
      decField(e, m.price, 'method.price', { required: true, nonNegative: true });
      break;
    case 'tiered': {
      if (!['whole', 'marginal'].includes(m.mode)) e.push('method.mode whole (tüm tutara kademe oranı) veya marginal (dilimli) olmalı');
      if (!Array.isArray(m.tiers) || m.tiers.length === 0) e.push('method.tiers en az bir kademe içermeli');
      else {
        m.tiers.forEach((t: any, i: number) => {
          decField(e, t?.from, `tiers[${i}].from`, { required: true, nonNegative: true });
          decField(e, t?.percent, `tiers[${i}].percent`, { required: true, nonNegative: true });
        });
        const froms = m.tiers.filter((t: any) => isDecString(t?.from)).map((t: any) => dec(t.from));
        if (froms.some((f: Dec, i: number) => i > 0 && f <= froms[i - 1])) e.push('Kademe eşikleri artan sırada olmalı');
      }
      break;
    }
    case 'formula': {
      if (typeof m.expr !== 'string' || !m.expr.trim()) e.push('method.expr zorunlu');
      else {
        const v = validateFormula(m.expr, [...vars, 'base']);
        v.errors.forEach((x) => e.push(`Formül: ${x.message}${x.pos >= 0 ? ` (konum ${x.pos})` : ''}`));
      }
      break;
    }
    default:
      e.push('method.type percent, fixed, per_unit, tiered veya formula olmalı');
  }
  if (raw.condition) {
    const v = validateFormula(String(raw.condition), vars);
    v.errors.forEach((x) => e.push(`Koşul: ${x.message}`));
  }

  if (scope === 'transaction') {
    if (!['financial', 'wallet'].includes(raw.tx_kind)) e.push('tx_kind financial veya wallet olmalı');
    const allowedTypes: readonly string[] = raw.tx_kind === 'wallet' ? WALLET_TX_TYPES : FINANCIAL_TX_TYPES;
    if (!Array.isArray(raw.tx_types) || raw.tx_types.length === 0) e.push('tx_types en az bir işlem türü içermeli');
    else raw.tx_types.filter((t: string) => !allowedTypes.includes(t)).forEach((t: string) => e.push(`Bilinmeyen işlem türü: ${t}`));
    const b = raw.beneficiary ?? {};
    if (!['agency', 'bd', 'publisher', 'provider', 'other'].includes(b.type)) e.push('beneficiary.type agency, bd, publisher, provider veya other olmalı');
    if (b.from && !['tx_agency', 'tx_publisher', 'agency_bd'].includes(b.from)) e.push('beneficiary.from tx_agency, tx_publisher veya agency_bd olmalı');
    if (b.from === 'tx_agency' && b.type !== 'agency') e.push('tx_agency yalnız ajans alıcı için');
    if (b.from === 'tx_publisher' && b.type !== 'publisher') e.push('tx_publisher yalnız yayıncı alıcı için');
    if (b.from === 'agency_bd' && b.type !== 'bd') e.push('agency_bd yalnız BD alıcı için');
    if (!b.from && b.id === undefined && !b.name) e.push('beneficiary için from, id veya name verilmeli');
    if (typeof raw.base !== 'string' || !raw.base.trim()) e.push('base (matrah) zorunlu');
    else if (m.type !== 'fixed' && m.type !== 'per_unit') {
      const v = validateFormula(raw.base, vars);
      v.errors.forEach((x) => e.push(`Matrah: ${x.message}`));
    }
    const stage = raw.stage ?? 1;
    if (!Number.isInteger(stage) || stage < 1 || stage > 20) e.push('stage 1–20 arası tam sayı olmalı');
    if (raw.refund && !['reverse_proportional', 'none'].includes(raw.refund)) e.push('refund reverse_proportional veya none olmalı');
  } else {
    if (!['agency', 'bd', 'publisher'].includes(raw.party_type)) e.push('party_type agency, bd veya publisher olmalı');
    if (typeof raw.measure !== 'string' || !raw.measure.trim()) e.push('measure (ölçü) zorunlu');
    else if (m.type !== 'fixed') validateFormula(raw.measure, vars).errors.forEach((x) => e.push(`Ölçü: ${x.message}`));
    if (raw.line_kind && !['bonus', 'deduction'].includes(raw.line_kind)) e.push('line_kind bonus veya deduction olmalı');
  }
  if (e.length) throw bad('Kural yapılandırması geçersiz', e);

  const out: RuleConfig = {
    scope,
    currency: raw.currency,
    method: m,
    min: raw.min ?? null,
    max: raw.max ?? null,
    rounding,
    condition: raw.condition || null,
  };
  if (scope === 'transaction') {
    Object.assign(out, {
      tx_kind: raw.tx_kind,
      tx_types: raw.tx_types,
      filters: raw.filters ?? {},
      beneficiary: raw.beneficiary,
      base: raw.base,
      stage: raw.stage ?? 1,
      refund: raw.refund ?? 'reverse_proportional',
    });
  } else {
    Object.assign(out, { party_type: raw.party_type, party_ids: raw.party_ids ?? [], measure: raw.measure, line_kind: raw.line_kind ?? 'bonus' });
  }
  return out;
}

// ---- method evaluation (shared with period rules) ------------------------------------
/** Applies a method to `base` (Dec in currency B). `toB` converts rule-currency Decs into B. */
export function applyMethod(cfg: RuleConfig, base: Dec, vars: Record<string, Dec>, toB: (d: Dec) => Dec, trace: Record<string, unknown>): Dec {
  const m = cfg.method;
  let raw: Dec;
  switch (m.type) {
    case 'percent':
      raw = pctOf(base, dec(m.percent));
      break;
    case 'fixed':
      raw = toB(dec(m.amount));
      break;
    case 'per_unit': {
      const q = vars[m.measure] ?? ZERO;
      raw = mul(q, toB(dec(m.price)));
      trace.measure = fmt(q);
      break;
    }
    case 'tiered': {
      const tiers = m.tiers.map((t) => ({ from: toB(dec(t.from)), percent: dec(t.percent) }));
      if (m.mode === 'whole') {
        const t = [...tiers].reverse().find((t) => base >= t.from);
        raw = t ? pctOf(base, t.percent) : ZERO;
        trace.tier = t ? fmt(t.percent) + '%' : 'yok';
      } else {
        raw = ZERO;
        for (let i = 0; i < tiers.length; i++) {
          const top = i + 1 < tiers.length ? tiers[i + 1].from : null;
          if (base <= tiers[i].from) break;
          const upto = top === null || base < top ? base : top;
          raw += pctOf(upto - tiers[i].from, tiers[i].percent);
        }
      }
      break;
    }
    case 'formula':
      raw = evaluate(m.expr, { ...vars, base });
      break;
  }
  trace.raw = fmt(raw);
  let out = raw;
  if (cfg.min) {
    const lo = toB(dec(cfg.min));
    if (out < lo) {
      out = lo;
      trace.capped = 'min';
    }
  }
  if (cfg.max) {
    const hi = toB(dec(cfg.max));
    if (out > hi) {
      out = hi;
      trace.capped = 'max';
    }
  }
  if (out < ZERO) {
    trace.negative_clamped = fmt(out);
    out = ZERO;
  }
  return out;
}

// ---- transaction scope ---------------------------------------------------------------
type Tx = Row & { id: number; type: string; occurred_at: string; booked_on: string };
type Ver = { id: number; rule_id: number; code: string; version: number; config: RuleConfig };

export function applicableVersions(db: Db, txKind: 'financial' | 'wallet', txType: string, at: string): Ver[] {
  const rows = db.all(
    `SELECT v.id, v.rule_id, v.version, v.config, r.code FROM commission_rule_versions v JOIN commission_rules r ON r.id = v.rule_id
      WHERE v.status IN ('active','retired') AND v.valid_from <= ? AND (v.valid_to IS NULL OR v.valid_to > ?)`,
    at,
    at,
  );
  return rows
    .map((r) => ({ id: r.id, rule_id: r.rule_id, code: r.code, version: r.version, config: JSON.parse(r.config) as RuleConfig }))
    .filter((v) => v.config.scope === 'transaction' && v.config.tx_kind === txKind && v.config.tx_types!.includes(txType))
    .sort((a, b) => a.config.stage! - b.config.stage! || a.rule_id - b.rule_id);
}

/** Money context of a transaction: base currency and the variables in that currency. */
export function txVariables(db: Db, kind: 'financial' | 'wallet', tx: Tx): { cur: string; decimals: number; vars: Record<string, Dec>; distributable: Dec } {
  if (kind === 'financial') {
    const c = currency(db, tx.currency);
    const m = (v: number | bigint) => fromMinor(BigInt(v ?? 0), c.decimals);
    const vars = {
      gross_amount: m(tx.amount_minor),
      tax_amount: m(tx.tax_minor),
      channel_fee: m(tx.fee_minor),
      net_of_tax: m(BigInt(tx.amount_minor) - BigInt(tx.tax_minor ?? 0)),
      net_collected: m(tx.net_minor),
      coins: dec(tx.units ?? 0),
    };
    return { cur: c.code, decimals: c.decimals, vars, distributable: vars.net_collected };
  }
  if (!tx.value_currency || tx.value_minor === null) throw new MissingRateError(tx.unit, 'para', tx.occurred_at);
  const c = currency(db, tx.value_currency);
  const vm = BigInt(tx.value_minor);
  const coinValue = fromMinor(vm < 0n ? -vm : vm, c.decimals);
  const vars = { units: dec(Math.abs(Number(tx.units))), quantity: tx.quantity ? dec(tx.quantity) : ZERO, coin_value: coinValue };
  return { cur: c.code, decimals: c.decimals, vars, distributable: coinValue };
}

function passesFilters(db: Db, cfg: RuleConfig, kind: 'financial' | 'wallet', tx: Tx): boolean {
  const f = cfg.filters ?? {};
  if (f.product_refs?.length && !f.product_refs.includes(tx.product_ref)) return false;
  if (f.item_refs?.length && !f.item_refs.includes(tx.item_ref)) return false;
  if (f.agency_ids?.length && !f.agency_ids.includes(tx.agency_id)) return false;
  if (f.publisher_ids?.length && !f.publisher_ids.includes(tx.publisher_id)) return false;
  if (f.channel_codes?.length) {
    if (kind !== 'financial' || !tx.channel_id) return false;
    const code = db.value<string>('SELECT code FROM payment_channels WHERE id = ?', tx.channel_id);
    if (!code || !f.channel_codes.includes(code)) return false;
  }
  return true;
}

function resolveBeneficiary(db: Db, cfg: RuleConfig, tx: Tx): { type: string; id: number | null; name: string | null } | null {
  const b = cfg.beneficiary!;
  if (b.from === 'tx_publisher') return tx.publisher_id ? { type: 'publisher', id: tx.publisher_id, name: null } : null;
  if (b.from === 'tx_agency') return tx.agency_id ? { type: 'agency', id: tx.agency_id, name: null } : null;
  if (b.from === 'agency_bd') {
    if (!tx.agency_id) return null;
    const bd = db.value<number>('SELECT bd_id FROM agencies WHERE id = ?', tx.agency_id);
    return bd ? { type: 'bd', id: bd, name: null } : null;
  }
  return { type: b.type, id: b.id ?? null, name: b.name ?? null };
}

export type AllocationDraft = {
  rule_version_id: number;
  code: string;
  beneficiary_type: string;
  beneficiary_id: number | null;
  beneficiary_name: string | null;
  stage: number;
  currency: string;
  base_minor: bigint;
  amount_minor: bigint;
  trace: Record<string, unknown>;
};
export type CalcResult = { allocations: AllocationDraft[]; issues: { kind: string; message: string; detail?: unknown }[]; currency: string; distributable_minor: bigint };

/** Pure calculation for one transaction against the given rule versions. */
export function calculate(db: Db, kind: 'financial' | 'wallet', tx: Tx, versions?: Ver[]): CalcResult {
  const issues: CalcResult['issues'] = [];
  let ctx: ReturnType<typeof txVariables>;
  try {
    ctx = txVariables(db, kind, tx);
  } catch (e) {
    if (e instanceof MissingRateError) return { allocations: [], issues: [{ kind: 'missing_rate', message: e.message }], currency: '', distributable_minor: 0n };
    throw e;
  }
  const vers = versions ?? applicableVersions(db, kind, tx.type, tx.occurred_at);
  const results: Record<string, Dec> = {};
  const allocations: AllocationDraft[] = [];
  let allocatedBefore = ZERO; // sum of earlier stages
  let stageSum = ZERO;
  let stage = vers[0]?.config.stage ?? 1;

  for (const v of vers) {
    const cfg = v.config;
    if (cfg.stage! !== stage) {
      allocatedBefore += stageSum;
      stageSum = ZERO;
      stage = cfg.stage!;
    }
    if (!passesFilters(db, cfg, kind, tx)) continue;
    const vars: Record<string, Dec> = { ...ctx.vars, distributable: ctx.distributable, remaining: ctx.distributable - allocatedBefore };
    for (const [code, val] of Object.entries(results)) vars[`r_${code.toLowerCase()}`] = val;
    const trace: Record<string, unknown> = { rule: v.code, version: v.version, currency: ctx.cur, method: cfg.method.type };
    try {
      if (cfg.condition && evaluate(cfg.condition, vars) === ZERO) continue;
      const ben = resolveBeneficiary(db, cfg, tx);
      if (!ben) {
        trace.skipped = 'alıcı bulunamadı';
        continue;
      }
      const rate = cfg.currency === ctx.cur ? null : fxRate(db, cfg.currency, ctx.cur, tx.occurred_at).rate;
      const toB = (d: Dec) => (rate === null ? d : mul(d, rate));
      const base = cfg.method.type === 'fixed' || cfg.method.type === 'per_unit' ? ZERO : evaluate(cfg.base!, vars);
      trace.base = fmt(base);
      if (rate !== null) trace.fx = fmt(rate);
      const amount = applyMethod(cfg, base, vars, toB, trace);
      const amountMinor = toMinor(amount, ctx.decimals, cfg.rounding);
      trace.rounding = cfg.rounding;
      trace.vars = Object.fromEntries(Object.entries(vars).map(([k, x]) => [k, fmt(x)]));
      results[v.code] = fromMinor(amountMinor, ctx.decimals);
      stageSum += results[v.code];
      if (amountMinor === 0n) continue;
      allocations.push({
        rule_version_id: v.id,
        code: v.code,
        beneficiary_type: ben.type,
        beneficiary_id: ben.id,
        beneficiary_name: ben.name,
        stage: cfg.stage!,
        currency: ctx.cur,
        base_minor: toMinor(base, ctx.decimals, 'half_even'),
        amount_minor: amountMinor,
        trace,
      });
    } catch (e) {
      if (e instanceof FormulaError || e instanceof MoneyError || e instanceof MissingRateError) {
        issues.push({ kind: e instanceof MissingRateError ? 'missing_rate' : 'formula_error', message: `${v.code} v${v.version}: ${e.message}` });
        continue;
      }
      throw e;
    }
  }
  const total = allocations.reduce((s, a) => s + a.amount_minor, 0n);
  const distributableMinor = toMinor(ctx.distributable, ctx.decimals);
  if (total > distributableMinor)
    issues.push({
      kind: 'over_distribution',
      message: `Komisyon toplamı (${fmt(fromMinor(total, ctx.decimals))} ${ctx.cur}) dağıtılabilir tutarı (${fmt(ctx.distributable)} ${ctx.cur}) aşıyor`,
      detail: allocations.map((a) => ({ rule: a.code, amount: fmt(fromMinor(a.amount_minor, ctx.decimals)) })),
    });
  return { allocations, issues, currency: ctx.cur, distributable_minor: distributableMinor };
}

const TX_TABLE = { financial: 'financial_transactions', wallet: 'wallet_transactions' } as const;

/**
 * Calculates and stores allocations for a transaction. Idempotent: a (tx, version) pair is stored once.
 * If any blocking issue occurs (over-distribution, formula or rate error) nothing is stored for the tx
 * and an open calculation issue is recorded — so a broken rule never silently pays part of a chain.
 */
export function applyCommissions(db: Db, kind: 'financial' | 'wallet', txId: number): CalcResult {
  const tx = db.get<Tx>(`SELECT * FROM ${TX_TABLE[kind]} WHERE id = ?`, txId);
  if (!tx) throw bad('İşlem bulunamadı');
  const res = calculate(db, kind, tx);
  db.tx(() => {
    if (res.issues.length) {
      for (const i of res.issues)
        if (!db.get("SELECT 1 FROM calculation_issues WHERE tx_kind = ? AND tx_id = ? AND kind = ? AND status = 'open'", kind, txId, i.kind))
          db.run('INSERT INTO calculation_issues (tx_kind, tx_id, kind, message, detail) VALUES (?,?,?,?,?)', kind, txId, i.kind, i.message, JSON.stringify(i.detail ?? null));
      return;
    }
    for (const a of res.allocations) insertAllocation(db, kind, txId, a, 'original', null, tx.booked_on);
  });
  return res;
}

function insertAllocation(db: Db, kind: string, txId: number, a: AllocationDraft, direction: 'original' | 'reversal', reversalOf: number | null, bookedOn: string) {
  // reversal_of_tx_id is NULL for originals; COALESCE makes the uniqueness check null-safe.
  const exists = db.get(
    'SELECT 1 FROM commission_allocations WHERE tx_kind = ? AND tx_id = ? AND rule_version_id = ? AND direction = ? AND COALESCE(reversal_of_tx_id, 0) = ?',
    kind,
    txId,
    a.rule_version_id,
    direction,
    reversalOf ?? 0,
  );
  if (exists) return;
  db.run(
    `INSERT INTO commission_allocations (tx_kind, tx_id, rule_version_id, direction, reversal_of_tx_id, beneficiary_type, beneficiary_id, beneficiary_name,
       stage, currency, base_minor, amount_minor, booked_on, trace) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    kind,
    txId,
    a.rule_version_id,
    direction,
    reversalOf,
    a.beneficiary_type,
    a.beneficiary_id,
    a.beneficiary_name,
    a.stage,
    a.currency,
    a.base_minor,
    a.amount_minor,
    bookedOn,
    JSON.stringify(a.trace),
  );
}

/**
 * Reverses allocations of `originalId` proportionally to `portion/whole` (e.g. refund amount / purchase amount).
 * Never reverses more than what is still outstanding on each allocation.
 */
export function reverseCommissions(db: Db, kind: 'financial' | 'wallet', originalId: number, reversalTx: Tx, portion: bigint, whole: bigint) {
  if (whole === 0n) return;
  const originals = db.all('SELECT * FROM commission_allocations WHERE tx_kind = ? AND tx_id = ? AND direction = ?', kind, originalId, 'original');
  db.tx(() => {
    for (const o of originals) {
      const v = db.get('SELECT config FROM commission_rule_versions WHERE id = ?', o.rule_version_id)!;
      const cfg = JSON.parse(v.config) as RuleConfig;
      if (cfg.refund === 'none') continue;
      const already = BigInt(
        db.value<number>("SELECT COALESCE(SUM(amount_minor),0) FROM commission_allocations WHERE tx_kind = ? AND tx_id = ? AND rule_version_id = ? AND direction = 'reversal'", kind, originalId, o.rule_version_id) ?? 0,
      );
      const outstanding = BigInt(o.amount_minor) + already; // reversal rows are negative
      let amt = divRound(BigInt(o.amount_minor) * (portion < 0n ? -portion : portion), whole < 0n ? -whole : whole, 'half_even');
      if (amt > outstanding) amt = outstanding;
      if (amt <= 0n) continue;
      insertAllocation(
        db,
        kind,
        originalId,
        {
          rule_version_id: o.rule_version_id,
          code: '',
          beneficiary_type: o.beneficiary_type,
          beneficiary_id: o.beneficiary_id,
          beneficiary_name: o.beneficiary_name,
          stage: o.stage,
          currency: o.currency,
          base_minor: -divRound(BigInt(o.base_minor) * (portion < 0n ? -portion : portion), whole < 0n ? -whole : whole),
          amount_minor: -amt,
          trace: { reversal_of_allocation: o.id, by_tx: reversalTx.id, portion: portion.toString(), whole: whole.toString() },
        },
        'reversal',
        reversalTx.id,
        reversalTx.booked_on,
      );
    }
  });
}

/** Re-runs calculation for transactions that have open issues (after the rule or rate was fixed). */
export function retryIssues(ctx: Ctx): { retried: number; resolved: number } {
  const { db } = ctx;
  const open = db.all("SELECT DISTINCT tx_kind, tx_id FROM calculation_issues WHERE status = 'open'");
  let resolved = 0;
  for (const o of open) {
    const res = applyCommissions(db, o.tx_kind, o.tx_id);
    if (!res.issues.length) {
      db.run("UPDATE calculation_issues SET status = 'resolved', resolved_by = ?, resolved_at = ? WHERE tx_kind = ? AND tx_id = ? AND status = 'open'", ctx.user?.id ?? null, ctx.now().toISOString(), o.tx_kind, o.tx_id);
      resolved++;
    }
  }
  if (open.length) audit(ctx, 'commission.retry_issues', 'calculation_issues', null, null, { retried: open.length, resolved });
  return { retried: open.length, resolved };
}

/** Possible double-commission: another live rule with the same tx kind/type, beneficiary type and stage. */
export function findConflicts(db: Db, cfg: RuleConfig, ruleId: number | null): { rule: string; version: number; reason: string }[] {
  if (cfg.scope !== 'transaction') return [];
  const out: { rule: string; version: number; reason: string }[] = [];
  const rows = db.all(
    "SELECT v.version, v.config, r.code, r.id AS rid FROM commission_rule_versions v JOIN commission_rules r ON r.id = v.rule_id WHERE v.status = 'active' AND v.valid_to IS NULL",
  );
  for (const r of rows) {
    if (r.rid === ruleId) continue;
    const c = JSON.parse(r.config) as RuleConfig;
    if (c.scope !== 'transaction' || c.tx_kind !== cfg.tx_kind) continue;
    const shared = c.tx_types!.filter((t) => cfg.tx_types!.includes(t));
    if (!shared.length) continue;
    if (c.beneficiary?.type === cfg.beneficiary?.type && (c.beneficiary?.from ?? c.beneficiary?.id) === (cfg.beneficiary?.from ?? cfg.beneficiary?.id))
      out.push({ rule: r.code, version: r.version, reason: `Aynı alıcıya (${cfg.beneficiary?.type}) aynı işlem türünde (${shared.join(', ')}) ikinci komisyon` });
  }
  return out;
}

/** "Örnek işlemle simülasyon": evaluates a draft config against a sample transaction without storing anything. */
export function previewRule(db: Db, cfg: RuleConfig, sample: Row, code = 'TASLAK') {
  const tx = { id: 0, type: cfg.tx_types?.[0] ?? 'purchase', occurred_at: new Date().toISOString(), booked_on: new Date().toISOString().slice(0, 10), ...sample } as Tx;
  return calculate(db, cfg.tx_kind ?? 'financial', tx, [{ id: 0, rule_id: 0, code, version: 0, config: cfg }]);
}
