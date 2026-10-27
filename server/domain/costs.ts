// Technical service costs (tariff × usage), invoice reconciliation, and general expenses.

import type { Db, Row } from '../db.ts';
import { actorId, audit, currency, type Ctx } from '../context.ts';
import { bad, conflict, notFound } from '../lib/http.ts';
import { ZERO, dec, fmt, fromMinor, mul, pctOf, toMinor, type Dec } from '../lib/money.ts';

export const monthStart = (p: string) => `${p}-01`;
export function monthEnd(p: string): string {
  const [y, m] = p.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split('-').map(Number);
  const [ty, tm] = to.slice(0, 7).split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export type CostLine = {
  provider_id: number;
  provider: string;
  category: string;
  service: string;
  unit: string;
  period: string;
  currency: string;
  quantity: string | null;
  estimated_minor: bigint | null;
  invoiced_minor: bigint | null;
  amount_minor: bigint | null; // invoice if present, else estimate
  status: 'invoiced' | 'estimated' | 'missing_data';
  last_usage_at: string | null;
  note: string | null;
};

/** Cost of one tariff for one month: fixed + (usage above quota) × price (or marginal tiers) + tax. */
export function tariffCost(t: Row, quantity: Dec, decimals: number): bigint {
  let variable = ZERO;
  const billable = quantity - dec(t.included_quantity) > ZERO ? quantity - dec(t.included_quantity) : ZERO;
  const tiers: { from: string; unit_price: string }[] | null = t.tiers ? JSON.parse(t.tiers) : null;
  if (tiers?.length) {
    for (let i = 0; i < tiers.length; i++) {
      const from = dec(tiers[i].from);
      const to = i + 1 < tiers.length ? dec(tiers[i + 1].from) : null;
      if (billable <= from) break;
      const top = to === null || billable < to ? billable : to;
      variable += mul(top - from, dec(tiers[i].unit_price));
    }
  } else variable = mul(billable, dec(t.unit_price));
  const net = fromMinor(t.fixed_monthly_minor, decimals) + variable;
  return toMinor(net + pctOf(net, dec(t.tax_percent)), decimals);
}

export function serviceCosts(db: Db, period: string): CostLine[] {
  const start = monthStart(period);
  const end = monthEnd(period);
  const tariffs = db.all(
    `SELECT t.*, p.name AS provider, p.category, p.id AS pid FROM cost_tariffs t JOIN service_providers p ON p.id = t.provider_id
      WHERE p.active = 1 AND t.valid_from <= ? AND (t.valid_to IS NULL OR t.valid_to > ?) ORDER BY p.name, t.service`,
    end,
    start,
  );
  const invoices = db.all('SELECT provider_id, currency, SUM(amount_minor + tax_minor) AS total FROM service_invoices WHERE period = ? GROUP BY provider_id, currency', period);
  const lines: CostLine[] = [];
  const seenProviders = new Set<number>();
  for (const t of tariffs) {
    const c = currency(db, t.currency);
    const usage = db.get(
      'SELECT COUNT(*) AS n, MAX(recorded_at) AS last FROM service_usage_records WHERE provider_id = ? AND service = ? AND period = ?',
      t.pid,
      t.service,
      period,
    )!;
    const qty = db.all('SELECT quantity FROM service_usage_records WHERE provider_id = ? AND service = ? AND period = ?', t.pid, t.service, period).reduce((s, r) => s + dec(r.quantity), ZERO);
    const usageBased = dec(t.unit_price) > ZERO || !!t.tiers;
    const missing = usageBased && usage.n === 0;
    const estimated = missing ? null : tariffCost(t, qty, c.decimals);
    lines.push({
      provider_id: t.pid,
      provider: t.provider,
      category: t.category,
      service: t.service,
      unit: t.unit,
      period,
      currency: t.currency,
      quantity: usage.n ? fmt(qty) : null,
      estimated_minor: estimated,
      invoiced_minor: null,
      amount_minor: estimated,
      status: missing ? 'missing_data' : 'estimated',
      last_usage_at: usage.last,
      note: missing ? 'Kullanım verisi yok — maliyet sıfır kabul edilmedi' : null,
    });
    seenProviders.add(t.pid);
  }
  // Invoices replace estimates at provider level (an invoice covers all of a provider's services).
  for (const inv of invoices) {
    const ls = lines.filter((l) => l.provider_id === inv.provider_id);
    if (!ls.length) {
      const p = db.get('SELECT * FROM service_providers WHERE id = ?', inv.provider_id)!;
      lines.push({ provider_id: p.id, provider: p.name, category: p.category, service: '(fatura)', unit: '', period, currency: inv.currency, quantity: null, estimated_minor: null, invoiced_minor: BigInt(inv.total), amount_minor: BigInt(inv.total), status: 'invoiced', last_usage_at: null, note: 'Tarifesiz fatura' });
      continue;
    }
    ls.forEach((l, i) => {
      l.status = 'invoiced';
      l.invoiced_minor = i === 0 ? BigInt(inv.total) : 0n;
      l.amount_minor = l.invoiced_minor;
      if (i === 0 && ls.length > 1) l.note = `Fatura ${ls.length} servisi kapsıyor`;
    });
  }
  return lines;
}

/** Compares the system estimate with the invoice and stores the outcome. */
export function reconcileInvoice(ctx: Ctx, invoiceId: number, note?: string | null) {
  const { db } = ctx;
  const inv = db.get('SELECT * FROM service_invoices WHERE id = ?', invoiceId);
  if (!inv) throw notFound('Fatura');
  const c = currency(db, inv.currency);
  const tariffs = db.all(
    'SELECT * FROM cost_tariffs WHERE provider_id = ? AND currency = ? AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)',
    inv.provider_id,
    inv.currency,
    monthEnd(inv.period),
    monthStart(inv.period),
  );
  let system = 0n;
  for (const t of tariffs) {
    const qty = db.all('SELECT quantity FROM service_usage_records WHERE provider_id = ? AND service = ? AND period = ?', inv.provider_id, t.service, inv.period).reduce((s, r) => s + dec(r.quantity), ZERO);
    system += tariffCost(t, qty, c.decimals);
  }
  const external = BigInt(inv.amount_minor) + BigInt(inv.tax_minor);
  const diff = external - system;
  const id = db.run(
    'INSERT INTO reconciliations (kind, ref, period, currency, system_minor, external_minor, difference_minor, status, note, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)',
    'service_invoice',
    `invoice:${inv.id}`,
    inv.period,
    inv.currency,
    system,
    external,
    diff,
    diff === 0n ? 'matched' : 'difference',
    note ?? null,
    actorId(ctx),
  ).id;
  audit(ctx, 'reconcile.invoice', 'reconciliations', id, null, { invoice: inv.id, system_minor: system, external_minor: external, difference_minor: diff });
  return { id, system_minor: system, external_minor: external, difference_minor: diff, status: diff === 0n ? 'matched' : 'difference' };
}

// ---- general expenses ------------------------------------------------------------------
const addMonths = (d: string, n: number) => {
  const x = new Date(d + 'T00:00:00Z');
  const day = x.getUTCDate();
  x.setUTCDate(1);
  x.setUTCMonth(x.getUTCMonth() + n);
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(day, last));
  return x.toISOString().slice(0, 10);
};
const addDays = (d: string, n: number) => {
  const x = new Date(d + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

/** Creates the instances of recurring expenses due up to `until`. Idempotent (unique parent+date). */
export function generateRecurring(ctx: Ctx, until: string): number {
  const { db } = ctx;
  let created = 0;
  const templates = db.all("SELECT * FROM expense_records WHERE recurrence <> 'none' AND parent_id IS NULL AND status <> 'cancelled'");
  db.tx(() => {
    for (const t of templates) {
      const step = (d: string) => (t.recurrence === 'monthly' ? addMonths(d, 1) : t.recurrence === 'yearly' ? addMonths(d, 12) : addDays(d, t.recurrence_days || 30));
      const stop = t.recurrence_until && t.recurrence_until < until ? t.recurrence_until : until;
      const dueOffset = t.due_date ? Math.round((Date.parse(t.due_date) - Date.parse(t.accrual_date)) / 86_400_000) : null;
      for (let d = step(t.accrual_date), guard = 0; d <= stop && guard < 500; d = step(d), guard++) {
        if (db.get('SELECT 1 FROM expense_records WHERE parent_id = ? AND accrual_date = ?', t.id, d)) continue;
        db.run(
          `INSERT INTO expense_records (category_id, vendor, description, nature, currency, amount_minor, tax_minor, tx_date, accrual_date, due_date, status, recurrence, parent_id, module, created_by)
           VALUES (?,?,?,?,?,?,?,?,?,?, 'unpaid', 'none', ?,?,?)`,
          t.category_id,
          t.vendor,
          t.description,
          t.nature,
          t.currency,
          t.amount_minor,
          t.tax_minor,
          d,
          d,
          dueOffset === null ? null : addDays(d, dueOffset),
          t.id,
          t.module,
          actorId(ctx),
        );
        created++;
      }
    }
  });
  if (created) audit(ctx, 'expense.generate_recurring', 'expense_records', null, null, { until, created });
  return created;
}

export function payExpense(ctx: Ctx, id: number, paidOn: string) {
  const { db } = ctx;
  const e = db.get('SELECT * FROM expense_records WHERE id = ?', id);
  if (!e) throw notFound('Gider');
  if (e.status !== 'unpaid') throw conflict('Yalnız ödenmemiş gider ödenebilir');
  db.tx(() => {
    db.run("UPDATE expense_records SET status = 'paid', paid_on = ? WHERE id = ?", paidOn, id);
    const total = BigInt(e.amount_minor) + BigInt(e.tax_minor);
    db.run(
      `INSERT INTO financial_transactions (idempotency_key, type, occurred_at, booked_on, currency, amount_minor, net_minor, source, source_ref, meta, created_by)
       VALUES (?, 'expense_payment', ?, ?, ?, ?, ?, 'manual', ?, ?, ?)`,
      `expense:${id}`,
      paidOn + 'T00:00:00.000Z',
      paidOn,
      e.currency,
      -total,
      -total,
      `expense:${id}`,
      JSON.stringify({ description: e.description }),
      actorId(ctx),
    );
  });
  audit(ctx, 'expense.pay', 'expense_records', id, { status: 'unpaid' }, { status: 'paid', paid_on: paidOn });
}

export function cancelExpense(ctx: Ctx, id: number, reason: string) {
  const { db } = ctx;
  const e = db.get('SELECT * FROM expense_records WHERE id = ?', id);
  if (!e) throw notFound('Gider');
  if (e.status === 'paid') throw conflict('Ödenmiş gider iptal edilemez; ters kayıt girin');
  if (!reason) throw bad('İptal gerekçesi zorunlu');
  db.run("UPDATE expense_records SET status = 'cancelled' WHERE id = ?", id);
  audit(ctx, 'expense.cancel', 'expense_records', id, { status: e.status }, { status: 'cancelled' }, reason);
}
