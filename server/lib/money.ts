// Fixed-point decimal arithmetic for money. Floats never touch an amount.
// A Dec is a bigint holding value × 10^12. Stored amounts are integer minor units
// (kuruş, cent, or whole coins) per currency; every conversion names its rounding mode.

export type Dec = bigint;
export type RoundingMode = 'half_even' | 'half_up' | 'half_down' | 'down' | 'up' | 'floor' | 'ceil';

export const PLACES = 12;
export const SCALE = 10n ** BigInt(PLACES);
export const ZERO: Dec = 0n;
export const ONE: Dec = SCALE;
export const HUNDRED: Dec = 100n * SCALE;
export const ROUNDING_MODES: RoundingMode[] = ['half_even', 'half_up', 'half_down', 'down', 'up', 'floor', 'ceil'];

export class MoneyError extends Error {}

/** Integer division n / d rounded with the given mode. */
export function divRound(n: bigint, d: bigint, mode: RoundingMode = 'half_even'): bigint {
  if (d === 0n) throw new MoneyError('Sıfıra bölme');
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const q = n / d; // truncated toward zero
  const r = n - q * d;
  if (r === 0n) return q;
  const neg = n < 0n;
  const away = neg ? q - 1n : q + 1n;
  const twice = (r < 0n ? -r : r) * 2n;
  switch (mode) {
    case 'down':
      return q;
    case 'up':
      return away;
    case 'floor':
      return neg ? q - 1n : q;
    case 'ceil':
      return neg ? q : q + 1n;
    case 'half_up':
      return twice >= d ? away : q;
    case 'half_down':
      return twice > d ? away : q;
    case 'half_even':
      if (twice > d) return away;
      if (twice < d) return q;
      return q % 2n === 0n ? q : away;
  }
}

const DEC_RE = /^([+-])?(\d+)(?:\.(\d+))?$/;

/** Parses "12.5", "-3", 7 into a Dec. Rejects exponents, NaN and more than 12 fraction digits. */
export function dec(v: string | number | bigint | null | undefined): Dec {
  if (v === null || v === undefined || v === '') throw new MoneyError('Boş sayı');
  if (typeof v === 'bigint') return v * SCALE;
  let s: string;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new MoneyError(`Geçersiz sayı: ${v}`);
    if (Number.isInteger(v)) return BigInt(v) * SCALE;
    s = String(v);
  } else {
    s = v.trim().replace(/_/g, '');
  }
  const m = DEC_RE.exec(s);
  if (!m) throw new MoneyError(`Geçersiz ondalık sayı: "${s}"`);
  const frac = m[3] ?? '';
  if (frac.length > PLACES) throw new MoneyError(`En fazla ${PLACES} ondalık basamak: "${s}"`);
  const abs = BigInt(m[2]) * SCALE + BigInt((frac + '0'.repeat(PLACES)).slice(0, PLACES));
  return m[1] === '-' ? -abs : abs;
}

export function isDecString(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v !== 'string') return false;
  try {
    dec(v);
    return true;
  } catch {
    return false;
  }
}

/** Plain decimal string; trailing zeros trimmed unless `places` is given (then rounded). */
export function fmt(d: Dec, places?: number, mode: RoundingMode = 'half_even'): string {
  if (places !== undefined) {
    const q = divRound(d, 10n ** BigInt(PLACES - places), mode);
    const neg = q < 0n;
    const digits = (neg ? -q : q).toString().padStart(places + 1, '0');
    const int = digits.slice(0, digits.length - places);
    const frac = digits.slice(digits.length - places);
    return (neg ? '-' : '') + int + (places > 0 ? '.' + frac : '');
  }
  const neg = d < 0n;
  const a = neg ? -d : d;
  const int = a / SCALE;
  const frac = (a % SCALE).toString().padStart(PLACES, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + int.toString() + (frac ? '.' + frac : '');
}

export const add = (...xs: Dec[]): Dec => xs.reduce((s, x) => s + x, 0n);
export const sub = (a: Dec, b: Dec): Dec => a - b;
export const neg = (a: Dec): Dec => -a;
export const abs = (a: Dec): Dec => (a < 0n ? -a : a);
export const cmp = (a: Dec, b: Dec): number => (a < b ? -1 : a > b ? 1 : 0);
export const min = (...xs: Dec[]): Dec => xs.reduce((m, x) => (x < m ? x : m));
export const max = (...xs: Dec[]): Dec => xs.reduce((m, x) => (x > m ? x : m));
export const mul = (a: Dec, b: Dec, mode: RoundingMode = 'half_even'): Dec => divRound(a * b, SCALE, mode);
export const div = (a: Dec, b: Dec, mode: RoundingMode = 'half_even'): Dec => divRound(a * SCALE, b, mode);
/** a × percent / 100 */
export const pctOf = (a: Dec, percent: Dec, mode: RoundingMode = 'half_even'): Dec => divRound(a * percent, SCALE * 100n, mode);

/** Rounds to `places` decimal places, staying a Dec. */
export function round(d: Dec, places: number, mode: RoundingMode = 'half_even'): Dec {
  const f = 10n ** BigInt(PLACES - places);
  return divRound(d, f, mode) * f;
}

/** Dec → integer minor units of a currency with `decimals` fraction digits. */
export function toMinor(d: Dec, decimals: number, mode: RoundingMode = 'half_even'): bigint {
  return divRound(d, 10n ** BigInt(PLACES - decimals), mode);
}

export function fromMinor(m: bigint | number, decimals: number): Dec {
  return BigInt(m) * 10n ** BigInt(PLACES - decimals);
}

/** Minor units → display string with exactly `decimals` digits. */
export function minorToString(m: bigint | number, decimals: number): string {
  return fmt(fromMinor(m, decimals), decimals);
}

/** Display/input string → minor units; rejects more precision than the currency allows. */
export function parseMinor(v: string | number, decimals: number): bigint {
  const d = dec(v);
  const m = toMinor(d, decimals, 'down');
  if (fromMinor(m, decimals) !== d) throw new MoneyError(`Tutar en fazla ${decimals} ondalık basamak içerebilir: ${v}`);
  return m;
}

/**
 * Splits `total` minor units across `weights` so the parts sum exactly to `total`
 * (largest-remainder method). Used for proportional refunds and reversals.
 */
export function allocate(total: bigint, weights: bigint[]): bigint[] {
  const sum = weights.reduce((s, w) => s + w, 0n);
  if (sum === 0n) return weights.map(() => 0n);
  const sign = total < 0n ? -1n : 1n;
  const t = total * sign;
  const parts = weights.map((w) => (t * w) / sum);
  let rest = t - parts.reduce((s, p) => s + p, 0n);
  const order = weights
    .map((w, i) => ({ i, rem: (t * w) % sum }))
    .sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1));
  for (const o of order) {
    if (rest === 0n) break;
    parts[o.i] += 1n;
    rest -= 1n;
  }
  return parts.map((p) => p * sign);
}
