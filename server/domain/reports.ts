// Reporting. Every figure is in the reporting currency, converted at the booking date of its rows.
// A figure that cannot be converted (missing rate) is reported in `gaps`, never silently as 0.
// Each revenue/cost source is counted in exactly one line (see docs/HESAPLAMA.md).

import type { Db, Row } from '../db.ts';
import { setting } from '../context.ts';
import { ZERO, dec, fmt, fromMinor, mul, toMinor, type Dec } from '../lib/money.ts';
import { monthEnd, monthStart, monthsBetween, serviceCosts } from './costs.ts';
import { tryConvert, unitValuation } from './rates.ts';

export type Gap = { metric: string; currency: string; date: string; amount_minor: string };

class Acc {
  db: Db;
  cur: string;
  gaps: Gap[] = [];
  constructor(db: Db, cur: string) {
    this.db = db;
    this.cur = cur;
  }
  /** Converts rows of {currency, d (date), total} and sums them. */
  sum(metric: string, rows: { currency: string; d: string; total: number }[] | Row[]): bigint {
    let s = 0n;
    for (const r of rows) {
      if (!r.total) continue;
      const v = tryConvert(this.db, r.total, r.currency, this.cur, r.d);
      if (v === null) this.gaps.push({ metric, currency: r.currency, date: r.d, amount_minor: String(r.total) });
      else s += v;
    }
    return s;
  }
}

const overlapDays = (aStart: string, aEnd: string, bStart: string, bEnd: string) => {
  const s = aStart > bStart ? aStart : bStart;
  const e = aEnd < bEnd ? aEnd : bEnd;
  return e < s ? 0 : Math.round((Date.parse(e) - Date.parse(s)) / 86_400_000) + 1;
};
const daysIn = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;
const prorate = (amount: bigint, part: number, whole: number) => (part >= whole ? amount : (amount * BigInt(part)) / BigInt(whole));

export function revenue(db: Db, acc: Acc, from: string, to: string) {
  const q = (col: string, types: string) =>
    db.all(`SELECT currency, booked_on AS d, SUM(${col}) AS total FROM financial_transactions WHERE type IN (${types}) AND booked_on BETWEEN ? AND ? GROUP BY currency, booked_on`, from, to);
  const sales = "'purchase'";
  const back = "'refund','chargeback'";
  const gross = acc.sum('gross_sales', q('amount_minor', sales));
  const refunds = acc.sum('refunds', q('amount_minor', back));
  const tax = acc.sum('taxes', q('tax_minor', `${sales},${back}`));
  const fees = acc.sum('channel_fees', q('fee_minor', `${sales},${back}`));
  const net = acc.sum('net_collected', q('net_minor', `${sales},${back}`));
  return { gross_sales: gross, refunds, taxes: tax, channel_fees: fees, net_collected: net };
}

export function commissionTotals(db: Db, acc: Acc, from: string, to: string) {
  const rows = db.all(
    'SELECT beneficiary_type AS bt, currency, booked_on AS d, SUM(amount_minor) AS total FROM commission_allocations WHERE booked_on BETWEEN ? AND ? GROUP BY bt, currency, booked_on',
    from,
    to,
  );
  const by: Record<string, bigint> = {};
  for (const t of new Set(rows.map((r) => r.bt))) by[t] = acc.sum(`commission:${t}`, rows.filter((r) => r.bt === t));
  return { total: Object.values(by).reduce((s, x) => s + x, 0n), by_beneficiary: by };
}

/** Salary, guarantees, bonuses, deductions, adjustments from non-cancelled statements ending in range. */
export function payrollExtras(db: Db, acc: Acc, from: string, to: string) {
  const rows = db.all(
    `SELECT l.kind, s.currency, s.period_end AS d, SUM(l.amount_minor) AS total FROM statement_lines l JOIN payout_statements s ON s.id = l.statement_id
      WHERE s.status <> 'cancelled' AND s.period_end BETWEEN ? AND ? AND l.kind NOT IN ('commission','carryover') GROUP BY l.kind, s.currency, s.period_end`,
    from,
    to,
  );
  const by: Record<string, bigint> = {};
  for (const k of new Set(rows.map((r) => r.kind))) by[k] = acc.sum(`payroll:${k}`, rows.filter((r) => r.kind === k));
  return { total: Object.values(by).reduce((s, x) => s + x, 0n), by_kind: by };
}

export function serviceCostTotals(db: Db, acc: Acc, from: string, to: string) {
  let total = 0n;
  let estimated = 0n;
  const missing: { provider: string; service: string; period: string }[] = [];
  const byProvider: Record<string, bigint> = {};
  const byCategory: Record<string, bigint> = {};
  for (const p of monthsBetween(from, to)) {
    const part = overlapDays(monthStart(p), monthEnd(p), from, to);
    const whole = daysIn(monthStart(p), monthEnd(p));
    for (const l of serviceCosts(db, p)) {
      if (l.amount_minor === null) {
        missing.push({ provider: l.provider, service: l.service, period: p });
        continue;
      }
      const v = acc.sum(`service:${l.provider}`, [{ currency: l.currency, d: monthEnd(p), total: Number(prorate(l.amount_minor, part, whole)) }]);
      total += v;
      if (l.status === 'estimated') estimated += v;
      byProvider[l.provider] = (byProvider[l.provider] ?? 0n) + v;
      byCategory[l.category] = (byCategory[l.category] ?? 0n) + v;
    }
  }
  return { total, estimated, invoiced: total - estimated, missing, by_provider: byProvider, by_category: byCategory };
}

/** Games, gifts, emoji, animations: one-off costs on acquisition date, monthly fees prorated, per-use × uses. */
export function catalogCosts(db: Db, acc: Acc, from: string, to: string) {
  const items = db.all('SELECT * FROM catalog_items');
  const rows: { kind: string; code: string; name: string; uses: number; revenue_coins: number; one_off: bigint; monthly: bigint; per_use: bigint; total: bigint }[] = [];
  for (const it of items) {
    const usesQuery =
      it.kind === 'game'
        ? "SELECT COUNT(*) AS n, COALESCE(-SUM(units),0) AS coins FROM wallet_transactions WHERE type = 'game_entry' AND item_ref = ? AND booked_on BETWEEN ? AND ?"
        : "SELECT COUNT(*) AS n, COALESCE(-SUM(units),0) AS coins FROM wallet_transactions WHERE type IN ('gift_send','coin_spend') AND item_ref = ? AND booked_on BETWEEN ? AND ?";
    const u = db.get(usesQuery, it.code, from, to)!;
    const oneOff = it.acquired_on && it.acquired_on >= from && it.acquired_on <= to ? BigInt(it.license_cost_minor) + BigInt(it.production_cost_minor) : 0n;
    let monthly = 0n;
    for (const p of monthsBetween(from, to)) monthly += prorate(BigInt(it.monthly_fee_minor), overlapDays(monthStart(p), monthEnd(p), from, to), daysIn(monthStart(p), monthEnd(p)));
    const cur = acc.db.get('SELECT decimals FROM currencies WHERE code = ?', it.currency)!;
    const perUse = toMinor(mul(dec(u.n), dec(it.per_use_cost) + dec(it.per_tx_fee)), cur.decimals);
    const native = oneOff + monthly + perUse;
    const total = acc.sum(`catalog:${it.code}`, [{ currency: it.currency, d: to, total: Number(native) }]);
    if (total || u.n) rows.push({ kind: it.kind, code: it.code, name: it.name, uses: u.n, revenue_coins: u.coins, one_off: oneOff, monthly, per_use: perUse, total });
  }
  const pk = db.all('SELECT currency, ends_at AS d, SUM(reward_cost_minor) AS total FROM pk_events WHERE substr(ends_at,1,10) BETWEEN ? AND ? GROUP BY currency, substr(ends_at,1,10)', from, to);
  const pkTotal = acc.sum('pk_rewards', pk.map((r) => ({ ...r, d: String(r.d).slice(0, 10) })));
  return { total: rows.reduce((s, r) => s + r.total, 0n) + pkTotal, items: rows, pk_rewards: pkTotal };
}

export function expenseTotals(db: Db, acc: Acc, from: string, to: string) {
  const rows = db.all(
    `SELECT c.name AS cat, e.currency, e.accrual_date AS d, SUM(e.amount_minor + e.tax_minor) AS total FROM expense_records e JOIN expense_categories c ON c.id = e.category_id
      WHERE e.status <> 'cancelled' AND e.accrual_date BETWEEN ? AND ? GROUP BY c.name, e.currency, e.accrual_date`,
    from,
    to,
  );
  const by: Record<string, bigint> = {};
  for (const c of new Set(rows.map((r) => r.cat))) by[c] = acc.sum(`expense:${c}`, rows.filter((r) => r.cat === c));
  return { total: Object.values(by).reduce((s, x) => s + x, 0n), by_category: by };
}

/** Lucky reward coins: memo only — not an expense; valued at the payout valuation when one exists. */
export function luckyMemo(db: Db, acc: Acc, from: string, to: string) {
  const r = db.get(
    "SELECT COALESCE(SUM(spent_coins),0) AS spent, COALESCE(SUM(reward_coins),0) AS reward FROM lucky_gift_results WHERE reverses_id IS NULL AND occurred_at >= ? AND occurred_at < ?",
    from,
    to + 'T23:59:59.999Z',
  )!;
  const val = unitValuation(db, setting(db, 'coin_unit'), 'payout', to);
  let value: bigint | null = null;
  if (val) {
    const c = db.get('SELECT decimals FROM currencies WHERE code = ?', val.currency)!;
    value = acc.sum('lucky_memo', [{ currency: val.currency, d: to, total: Number(toMinor(mul(dec(r.reward), val.value), c.decimals)) }]);
  }
  return { spent_coins: r.spent, reward_coins: r.reward, net_coins: r.spent - r.reward, reward_value: value, valuation: val ? fmt(val.value) : null };
}

export function cashPosition(db: Db, acc: Acc, asOf: string) {
  const accounts = db.all(
    `SELECT a.id, a.name, a.currency, s.balance_minor, s.as_of FROM cash_accounts a
       LEFT JOIN cash_snapshots s ON s.id = (SELECT id FROM cash_snapshots WHERE account_id = a.id AND as_of <= ? ORDER BY as_of DESC, id DESC LIMIT 1)
      WHERE a.active = 1`,
    asOf,
  );
  let total = 0n;
  const missing: string[] = [];
  for (const a of accounts) {
    if (a.balance_minor === null) {
      missing.push(a.name);
      continue;
    }
    total += acc.sum('cash', [{ currency: a.currency, d: a.as_of, total: a.balance_minor }]);
  }
  return { total, accounts, missing, has_data: accounts.some((a) => a.balance_minor !== null) };
}

/** Liabilities: statements not yet paid, plus accrued-but-unstated commissions, unpaid expenses and invoices. */
export function obligations(db: Db, acc: Acc, asOf: string, horizon: string) {
  const st = db.all("SELECT party_type, status, currency, period_end AS d, SUM(total_minor - paid_minor) AS total FROM payout_statements WHERE status IN ('calculated','approved') GROUP BY party_type, status, currency, period_end");
  const byParty: Record<string, { approved: bigint; calculated: bigint }> = {};
  for (const r of st) {
    byParty[r.party_type] ??= { approved: 0n, calculated: 0n };
    byParty[r.party_type][r.status as 'approved' | 'calculated'] += acc.sum(`obligation:${r.party_type}`, [r]);
  }
  const lastStated = (t: string) => db.value<string>("SELECT MAX(period_end) FROM payout_statements WHERE party_type = ? AND status <> 'cancelled'", t) ?? '0000-00-00';
  const unstated: Record<string, bigint> = {};
  for (const t of ['agency', 'bd', 'publisher']) {
    unstated[t] = acc.sum(
      `unstated:${t}`,
      db.all('SELECT currency, booked_on AS d, SUM(amount_minor) AS total FROM commission_allocations WHERE beneficiary_type = ? AND booked_on > ? AND booked_on <= ? GROUP BY currency, booked_on', t, lastStated(t), asOf),
    );
  }
  const exp = acc.sum('expenses_due', db.all("SELECT currency, COALESCE(due_date, accrual_date) AS d, SUM(amount_minor + tax_minor) AS total FROM expense_records WHERE status = 'unpaid' AND COALESCE(due_date, accrual_date) <= ? GROUP BY currency, d", horizon));
  const inv = acc.sum('invoices_due', db.all('SELECT currency, COALESCE(due_on, created_at) AS d, SUM(amount_minor + tax_minor) AS total FROM service_invoices WHERE paid_on IS NULL AND COALESCE(due_on, ?) <= ? GROUP BY currency, d', horizon, horizon).map((r) => ({ ...r, d: String(r.d).slice(0, 10) })));
  const approved = Object.values(byParty).reduce((s, x) => s + x.approved, 0n);
  return { by_party: byParty, unstated_commissions: unstated, expenses_due: exp, invoices_due: inv, approved_unpaid: approved, total_due: approved + exp + inv };
}

/** Purchases whose store settlement is still pending (channel delay) — expected inflow. */
export function pendingCollections(db: Db, acc: Acc, asOf: string) {
  const rows = db.all(
    `SELECT t.currency, t.booked_on AS d, SUM(t.net_minor) AS total FROM financial_transactions t JOIN payment_channels c ON c.id = t.channel_id
      WHERE t.type IN ('purchase','refund','chargeback') AND c.settlement_delay_days > 0 AND date(t.booked_on, '+' || c.settlement_delay_days || ' days') > ? AND t.booked_on <= ?
      GROUP BY t.currency, t.booked_on`,
    asOf,
    asOf,
  );
  return acc.sum('pending_collections', rows);
}

export function summary(db: Db, from: string, to: string, asOf: string) {
  const cur = setting(db, 'reporting_currency');
  const acc = new Acc(db, cur);
  const rev = revenue(db, acc, from, to);
  const com = commissionTotals(db, acc, from, to);
  const pay = payrollExtras(db, acc, from, to);
  const svc = serviceCostTotals(db, acc, from, to);
  const cat = catalogCosts(db, acc, from, to);
  const exp = expenseTotals(db, acc, from, to);
  const lucky = luckyMemo(db, acc, from, to);
  const cash = cashPosition(db, acc, asOf);
  const monthEndDay = monthEnd(asOf.slice(0, 7));
  const obl = obligations(db, acc, asOf, monthEndDay);
  const inflow = pendingCollections(db, acc, asOf);
  const paidOut = acc.sum('paid_out', db.all("SELECT currency, booked_on AS d, SUM(-amount_minor) AS total FROM financial_transactions WHERE type IN ('payout','expense_payment') AND booked_on BETWEEN ? AND ? GROUP BY currency, booked_on", from, to));
  const paidCommissions = acc.sum('paid_commissions', db.all("SELECT currency, booked_on AS d, SUM(-amount_minor) AS total FROM financial_transactions WHERE type = 'payout' AND booked_on BETWEEN ? AND ? GROUP BY currency, booked_on", from, to));
  const totalExpense = com.total + pay.total + svc.total + cat.total + exp.total;
  const operating = rev.net_collected - totalExpense;
  const issues = db.value<number>("SELECT COUNT(*) FROM calculation_issues WHERE status = 'open'") ?? 0;
  const integrations = db.all("SELECT name, status, last_sync_at, last_error FROM integration_connections WHERE status <> 'disabled'");
  return {
    currency: cur,
    from,
    to,
    as_of: asOf,
    revenue: rev,
    commissions: com,
    payroll: pay,
    services: svc,
    catalog: cat,
    expenses: exp,
    lucky,
    totals: {
      gross_sales: rev.gross_sales,
      collected: rev.gross_sales + rev.refunds,
      net_revenue: rev.net_collected,
      expense_total: totalExpense,
      expense_paid: paidOut,
      expense_accrued: totalExpense,
      commissions_paid: paidCommissions,
      pending_agency: (obl.by_party.agency?.approved ?? 0n) + (obl.by_party.agency?.calculated ?? 0n) + obl.unstated_commissions.agency,
      pending_bd: (obl.by_party.bd?.approved ?? 0n) + (obl.by_party.bd?.calculated ?? 0n) + obl.unstated_commissions.bd,
      pending_publisher: (obl.by_party.publisher?.approved ?? 0n) + (obl.by_party.publisher?.calculated ?? 0n) + obl.unstated_commissions.publisher,
      technical_services: svc.total,
      operating_result: operating,
      cash: cash.has_data ? cash.total : null,
      upcoming_obligations: obl.total_due,
      month_end_cash_forecast: cash.has_data ? cash.total + inflow - obl.total_due : null,
    },
    cash,
    obligations: obl,
    pending_collections: inflow,
    data_quality: {
      fx_gaps: acc.gaps,
      open_calculation_issues: issues,
      missing_usage: svc.missing,
      cash_accounts_without_balance: cash.missing,
      integrations,
      estimated_service_costs: svc.estimated,
    },
  };
}

/** Rows behind a dashboard number. */
export function drill(db: Db, metric: string, from: string, to: string, limit = 500) {
  const lim = Math.min(Math.max(limit, 1), 5000);
  switch (metric) {
    case 'gross_sales':
    case 'collected':
    case 'net_revenue':
      return db.all(
        `SELECT t.id, t.idempotency_key, t.type, t.occurred_at, t.booked_on, t.user_ref, c.name AS channel, t.currency, t.amount_minor, t.tax_minor, t.fee_minor, t.net_minor
           FROM financial_transactions t LEFT JOIN payment_channels c ON c.id = t.channel_id
          WHERE t.type IN (${metric === 'gross_sales' ? "'purchase'" : "'purchase','refund','chargeback'"}) AND t.booked_on BETWEEN ? AND ? ORDER BY t.occurred_at DESC LIMIT ${lim}`,
        from,
        to,
      );
    case 'commissions':
    case 'pending_agency':
    case 'pending_bd':
    case 'pending_publisher': {
      const bt = metric === 'commissions' ? null : metric.replace('pending_', '');
      return db.all(
        `SELECT a.id, a.tx_kind, a.tx_id, a.direction, r.code AS rule, v.version, a.beneficiary_type, a.beneficiary_id,
                COALESCE(ag.name, bd.name, p.name, a.beneficiary_name) AS beneficiary, a.currency, a.base_minor, a.amount_minor, a.booked_on
           FROM commission_allocations a JOIN commission_rule_versions v ON v.id = a.rule_version_id JOIN commission_rules r ON r.id = v.rule_id
           LEFT JOIN agencies ag ON a.beneficiary_type = 'agency' AND ag.id = a.beneficiary_id
           LEFT JOIN business_developers bd ON a.beneficiary_type = 'bd' AND bd.id = a.beneficiary_id
           LEFT JOIN publishers p ON a.beneficiary_type = 'publisher' AND p.id = a.beneficiary_id
          WHERE a.booked_on BETWEEN ? AND ? ${bt ? 'AND a.beneficiary_type = ?' : ''} ORDER BY a.id DESC LIMIT ${lim}`,
        ...(bt ? [from, to, bt] : [from, to]),
      );
    }
    case 'expense_paid':
    case 'commissions_paid':
      return db.all(
        `SELECT id, idempotency_key, type, booked_on, currency, amount_minor, source_ref, meta FROM financial_transactions
          WHERE type IN (${metric === 'commissions_paid' ? "'payout'" : "'payout','expense_payment'"}) AND booked_on BETWEEN ? AND ? ORDER BY booked_on DESC LIMIT ${lim}`,
        from,
        to,
      );
    case 'expense_total':
    case 'expense_accrued':
      return db.all(
        `SELECT e.id, c.name AS category, e.vendor, e.description, e.currency, e.amount_minor, e.tax_minor, e.accrual_date, e.due_date, e.status
           FROM expense_records e JOIN expense_categories c ON c.id = e.category_id WHERE e.status <> 'cancelled' AND e.accrual_date BETWEEN ? AND ? ORDER BY e.accrual_date DESC LIMIT ${lim}`,
        from,
        to,
      );
    case 'technical_services':
      return monthsBetween(from, to).flatMap((p) => serviceCosts(db, p));
    case 'upcoming_obligations':
      return db.all("SELECT id, party_type, party_id, period_start, period_end, status, currency, total_minor, paid_minor FROM payout_statements WHERE status IN ('calculated','approved') ORDER BY period_end");
    case 'cash':
      return db.all('SELECT s.*, a.name, a.currency FROM cash_snapshots s JOIN cash_accounts a ON a.id = s.account_id ORDER BY s.as_of DESC LIMIT 100');
    default:
      return [];
  }
}

/** Daily series for charts: gross sales, net revenue, commissions, expenses. */
export function dailySeries(db: Db, from: string, to: string) {
  const cur = setting(db, 'reporting_currency');
  const acc = new Acc(db, cur);
  const out: { date: string; gross: bigint; net: bigint; commissions: bigint; expenses: bigint }[] = [];
  const fin = db.all("SELECT booked_on AS d, currency, SUM(CASE WHEN type='purchase' THEN amount_minor ELSE 0 END) AS gross, SUM(net_minor) AS net FROM financial_transactions WHERE type IN ('purchase','refund','chargeback') AND booked_on BETWEEN ? AND ? GROUP BY d, currency", from, to);
  const com = db.all('SELECT booked_on AS d, currency, SUM(amount_minor) AS total FROM commission_allocations WHERE booked_on BETWEEN ? AND ? GROUP BY d, currency', from, to);
  const exp = db.all("SELECT accrual_date AS d, currency, SUM(amount_minor + tax_minor) AS total FROM expense_records WHERE status <> 'cancelled' AND accrual_date BETWEEN ? AND ? GROUP BY d, currency", from, to);
  for (let d = from; d <= to; d = new Date(Date.parse(d) + 86_400_000).toISOString().slice(0, 10)) {
    out.push({
      date: d,
      gross: acc.sum('gross', fin.filter((r) => r.d === d).map((r) => ({ currency: r.currency, d, total: r.gross }))),
      net: acc.sum('net', fin.filter((r) => r.d === d).map((r) => ({ currency: r.currency, d, total: r.net }))),
      commissions: acc.sum('com', com.filter((r) => r.d === d)),
      expenses: acc.sum('exp', exp.filter((r) => r.d === d)),
    });
    if (out.length > 400) break;
  }
  return { currency: cur, series: out };
}

/** Per-agency net contribution (screen 14 "Ajans bazında net katkı"). */
export function agencyContribution(db: Db, from: string, to: string, onlyAgency: number | null = null) {
  const cur = setting(db, 'reporting_currency');
  const acc = new Acc(db, cur);
  const agencies = db.all(`SELECT id, code, name, bd_id FROM agencies ${onlyAgency ? 'WHERE id = ?' : ''} ORDER BY name`, ...(onlyAgency ? [onlyAgency] : []));
  return {
    currency: cur,
    rows: agencies.map((a) => {
      const revenue = acc.sum(
        'agency_revenue',
        db.all("SELECT value_currency AS currency, booked_on AS d, SUM(value_minor) AS total FROM wallet_transactions WHERE type IN ('gift_receive','call_earning','lucky_spend') AND agency_id = ? AND booked_on BETWEEN ? AND ? GROUP BY value_currency, booked_on", a.id, from, to),
      );
      const allocs = db.all(
        `SELECT a.beneficiary_type AS bt, a.currency, a.booked_on AS d, SUM(a.amount_minor) AS total FROM commission_allocations a JOIN wallet_transactions w ON a.tx_kind = 'wallet' AND w.id = a.tx_id
          WHERE w.agency_id = ? AND a.booked_on BETWEEN ? AND ? GROUP BY a.beneficiary_type, a.currency, a.booked_on`,
        a.id,
        from,
        to,
      );
      const share = (t: string) => acc.sum(`agency_${t}`, allocs.filter((r) => r.bt === t));
      const agency = share('agency');
      const publisher = share('publisher');
      const bd = share('bd');
      const other = acc.sum('agency_other', allocs.filter((r) => !['agency', 'publisher', 'bd'].includes(r.bt)));
      const publishers = db.value<number>("SELECT COUNT(*) FROM publishers WHERE agency_id = ? AND status = 'active'", a.id);
      const active = db.value<number>("SELECT COUNT(DISTINCT publisher_id) FROM wallet_transactions WHERE agency_id = ? AND type IN ('gift_receive','call_earning') AND booked_on BETWEEN ? AND ?", a.id, from, to);
      return { ...a, revenue, agency_commission: agency, publisher_share: publisher, bd_share: bd, other_share: other, net_contribution: revenue - agency - publisher - bd - other, publishers, active_publishers: active };
    }),
    gaps: acc.gaps,
  };
}

/** Unit economics: per active user, per paying user, per voice/video hour. */
export function unitEconomics(db: Db, from: string, to: string) {
  const s = summary(db, from, to, to);
  const users = db.value<number>(
    "SELECT COUNT(DISTINCT user_ref) FROM wallet_transactions WHERE user_ref IS NOT NULL AND booked_on BETWEEN ? AND ?",
    from,
    to,
  ) ?? 0;
  const payers = db.value<number>("SELECT COUNT(DISTINCT user_ref) FROM financial_transactions WHERE type = 'purchase' AND booked_on BETWEEN ? AND ?", from, to) ?? 0;
  const minutes = (kind: string) =>
    db.all("SELECT quantity FROM wallet_transactions WHERE type = 'call_earning' AND item_ref = ? AND booked_on BETWEEN ? AND ?", kind, from, to).reduce((x, r) => x + dec(r.quantity ?? '0'), ZERO);
  const voiceSvc = db.all("SELECT quantity FROM service_usage_records WHERE service IN ('voice_minutes','voice_room_minutes') AND period BETWEEN ? AND ?", from.slice(0, 7), to.slice(0, 7)).reduce((x, r) => x + dec(r.quantity), ZERO);
  const videoSvc = db.all("SELECT quantity FROM service_usage_records WHERE service = 'video_minutes' AND period BETWEEN ? AND ?", from.slice(0, 7), to.slice(0, 7)).reduce((x, r) => x + dec(r.quantity), ZERO);
  const costOf = (cat: string) => s.services.by_category[cat] ?? 0n;
  const dec2 = db.get('SELECT decimals FROM currencies WHERE code = ?', s.currency)!.decimals as number;
  const per = (amount: bigint, n: Dec | number) => {
    const d = typeof n === 'number' ? dec(n) : n;
    if (d === ZERO) return null;
    return fmt(fromMinor(amount, dec2) * 10n ** 12n / d, dec2);
  };
  const hours = (m: Dec) => m / 60n;
  return {
    currency: s.currency,
    active_users: users,
    paying_users: payers,
    paying_ratio: users ? Math.round((payers / users) * 10000) / 100 : null,
    net_revenue_per_active_user: per(s.revenue.net_collected, users),
    arppu: per(s.revenue.net_collected, payers),
    cost_per_active_user: per(s.totals.expense_total, users),
    service_cost_per_active_user: per(s.services.total, users),
    voice_minutes: fmt(voiceSvc || minutes('voice')),
    video_minutes: fmt(videoSvc || minutes('video')),
    voice_cost_per_hour: per(costOf('Sesli oda altyapısı') + costOf('Bire bir sesli görüşme'), hours(voiceSvc || minutes('voice'))),
    video_cost_per_hour: per(costOf('Görüntülü görüşme'), hours(videoSvc || minutes('video'))),
    acquisition_cost: s.expenses.by_category['Kullanıcı kazanımı'] ?? 0n,
    acquisition_cost_per_new_payer: per(s.expenses.by_category['Kullanıcı kazanımı'] ?? 0n, payers),
    gaps: s.data_quality.fx_gaps,
  };
}

/** Gift / emoji economy and game profitability in coins and money. */
export function catalogReport(db: Db, from: string, to: string) {
  const cur = setting(db, 'reporting_currency');
  const acc = new Acc(db, cur);
  const cat = catalogCosts(db, acc, from, to);
  const items = cat.items.map((i) => {
    const rev = acc.sum(
      `catalog_rev:${i.code}`,
      db.all(
        `SELECT value_currency AS currency, booked_on AS d, SUM(${i.kind === 'game' ? '-value_minor' : 'value_minor'}) AS total FROM wallet_transactions
          WHERE item_ref = ? AND type IN (${i.kind === 'game' ? "'game_entry'" : "'gift_receive'"}) AND value_minor IS NOT NULL AND booked_on BETWEEN ? AND ? GROUP BY value_currency, booked_on`,
        i.code,
        from,
        to,
      ),
    );
    const payouts = i.kind === 'game' ? Number(db.value<number>("SELECT COALESCE(SUM(units),0) FROM wallet_transactions WHERE type = 'game_result' AND item_ref = ? AND booked_on BETWEEN ? AND ?", i.code, from, to) ?? 0) : 0;
    const share = acc.sum(
      `catalog_share:${i.code}`,
      db.all(
        `SELECT a.currency, a.booked_on AS d, SUM(a.amount_minor) AS total FROM commission_allocations a JOIN wallet_transactions w ON a.tx_kind = 'wallet' AND w.id = a.tx_id
          WHERE w.item_ref = ? AND a.booked_on BETWEEN ? AND ? GROUP BY a.currency, a.booked_on`,
        i.code,
        from,
        to,
      ),
    );
    return { ...i, revenue: rev, payout_coins: payouts, commissions: share, net_contribution: rev - share - i.total };
  });
  const pk = db.all('SELECT * FROM pk_events WHERE substr(ends_at,1,10) BETWEEN ? AND ? ORDER BY starts_at', from, to).map((e) => {
    const gifts = acc.sum(
      `pk:${e.code}`,
      db.all("SELECT value_currency AS currency, booked_on AS d, SUM(value_minor) AS total FROM wallet_transactions WHERE type = 'gift_receive' AND event_ref = ? AND value_minor IS NOT NULL GROUP BY value_currency, booked_on", e.code),
    );
    const cost = acc.sum(`pk_cost:${e.code}`, [{ currency: e.currency, d: String(e.ends_at).slice(0, 10), total: e.reward_cost_minor }]);
    return { ...e, gift_revenue: gifts, reward_cost: cost, result: gifts - cost };
  });
  return { currency: cur, items, pk, gaps: acc.gaps };
}
