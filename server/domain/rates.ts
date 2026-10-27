// Point-in-time lookups: exchange rates, unit valuations, channel fees, taxes, periods.
// Every lookup takes the transaction date, so a later rate change never alters past results.

import type { Db } from '../db.ts';
import { currency } from '../context.ts';
import { HttpError } from '../lib/http.ts';
import { ONE, dec, div, fromMinor, mul, toMinor, type Dec, type RoundingMode } from '../lib/money.ts';

export class MissingRateError extends HttpError {
  constructor(from: string, to: string, at: string) {
    super(422, `${from}→${to} kuru ${at.slice(0, 10)} tarihi için tanımlı değil`, 'missing_rate', { from, to, at });
  }
}

/** Rate to multiply `from` amounts by to get `to` amounts, valid at `at`. */
export function fxRate(db: Db, from: string, to: string, at: string): { rate: Dec; id: number | null } {
  if (from === to) return { rate: ONE, id: null };
  const day = at.slice(0, 10);
  const direct = db.get('SELECT id, rate FROM exchange_rates WHERE base = ? AND quote = ? AND valid_from <= ? ORDER BY valid_from DESC, id DESC LIMIT 1', from, to, day);
  if (direct) return { rate: dec(direct.rate), id: direct.id };
  const inverse = db.get('SELECT id, rate FROM exchange_rates WHERE base = ? AND quote = ? AND valid_from <= ? ORDER BY valid_from DESC, id DESC LIMIT 1', to, from, day);
  if (inverse) return { rate: div(ONE, dec(inverse.rate)), id: inverse.id };
  throw new MissingRateError(from, to, at);
}

export function convertMinor(db: Db, minor: bigint | number, from: string, to: string, at: string, mode: RoundingMode = 'half_even'): bigint {
  if (from === to) return BigInt(minor);
  const f = currency(db, from);
  const t = currency(db, to);
  const { rate } = fxRate(db, from, to, at);
  return toMinor(mul(fromMinor(minor, f.decimals), rate), t.decimals, mode);
}

/** Like convertMinor but returns null instead of throwing, so reports can flag gaps instead of showing 0. */
export function tryConvert(db: Db, minor: bigint | number, from: string, to: string, at: string): bigint | null {
  try {
    return convertMinor(db, minor, from, to, at);
  } catch (e) {
    if (e instanceof MissingRateError) return null;
    throw e;
  }
}

export function unitValuation(db: Db, unit: string, purpose: 'revenue' | 'payout', at: string) {
  const r = db.get(
    'SELECT id, currency, value_per_unit FROM unit_valuations WHERE unit = ? AND purpose = ? AND valid_from <= ? ORDER BY valid_from DESC, id DESC LIMIT 1',
    unit,
    purpose,
    at.slice(0, 10),
  );
  return r ? { id: r.id as number, currency: r.currency as string, value: dec(r.value_per_unit) } : null;
}

export function channelFeeVersion(db: Db, channelId: number, at: string) {
  return db.get(
    `SELECT * FROM channel_fee_versions WHERE channel_id = ? AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)
      ORDER BY valid_from DESC, id DESC LIMIT 1`,
    channelId,
    at.slice(0, 10),
    at.slice(0, 10),
  );
}

/** Most specific tax config: "purchase:<channel>" beats "purchase". */
export function taxConfig(db: Db, appliesTo: string[], at: string) {
  for (const a of appliesTo) {
    const r = db.get(
      `SELECT * FROM tax_configurations WHERE applies_to = ? AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)
        ORDER BY valid_from DESC, id DESC LIMIT 1`,
      a,
      at.slice(0, 10),
      at.slice(0, 10),
    );
    if (r) return r;
  }
  return null;
}

/** Accounting date: the event date, or the first day of the next open period if its period is closed. */
export function bookingDate(db: Db, occurredAt: string): string {
  const day = occurredAt.slice(0, 10);
  const closed = db.get("SELECT ends_on FROM periods WHERE status = 'closed' AND starts_on <= ? AND ends_on >= ?", day, day);
  if (!closed) return day;
  const lastClosed = db.value<string>("SELECT MAX(ends_on) FROM periods WHERE status = 'closed'")!;
  const next = new Date(lastClosed + 'T00:00:00Z');
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

export function isClosed(db: Db, day: string): boolean {
  return !!db.get("SELECT 1 FROM periods WHERE status = 'closed' AND starts_on <= ? AND ends_on >= ?", day, day);
}
