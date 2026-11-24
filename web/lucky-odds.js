// Uygulama › Şanslı hediye ayarı's rules (web/pages/app-lucky.js), apart from the page so the panel's tests read them:
// no imports, no browser. A package's odds are whole numbers out of 100,000 (1 = %0,001); the multipliers are fixed;
// "Ödül yok" (mult 0) takes whatever the others leave, so a table the editor saves always adds up to %100. The app's
// server checks the same (its lucky-rules.mjs checkConfig) and its sentence is the one that counts.

export const TOTAL = 100_000;
/** The multipliers besides "Ödül yok" (0), as the app's server knows them. */
export const MULTS = [2, 5, 10, 20, 50, 100, 200, 500, 1000];
export const LUCKY_ID = /^lk[a-z0-9]{1,20}$/;
export const PRICE = Object.freeze({ min: 5, max: 100_000 });
export const NAME_MAX = 30;
export const EMOJI_MAX = 8;
export const PACKAGES_MAX = 20;
export const LIMIT_MAX = 1_000_000_000_000;

const fmt = (n) => Number(n).toLocaleString('tr-TR');

/** A weight as a percentage the way people write it: 12500 → "12,5", 1 → "0,001", 0 → "0". */
export function pctOf(w) {
  const whole = Math.floor(Math.abs(w) / 1000);
  const frac = String(Math.abs(w) % 1000).padStart(3, '0').replace(/0+$/, '');
  return `${w < 0 ? '-' : ''}${whole}${frac ? `,${frac}` : ''}`;
}

/**
 * A typed percentage ("12,5", "0.125", "%3", "") as a weight out of TOTAL: '' is 0; null when it isn't one (more
 * than three decimals, a letter, over %100).
 */
export function weightOf(text) {
  const t = String(text ?? '').replace(/[\s%]/g, '').replace(',', '.');
  if (t === '') return 0;
  const m = /^(\d{1,3})(?:\.(\d{0,3}))?$/.exec(t);
  if (!m) return null;
  const w = Number(m[1]) * 1000 + Number((m[2] ?? '').padEnd(3, '0'));
  return w <= TOTAL ? w : null;
}

/** The editor's fields for a package's tiers: the typed text per multiplier (0 left out: it is what is left). */
export const draftOf = (tiers = []) => Object.fromEntries(MULTS.map((m) => [m, ((w) => (w ? pctOf(w) : ''))(tiers.find((t) => t.mult === m)?.weight ?? 0)]));

/**
 * The tiers from the editor's fields: each multiplier typed above 0, and "Ödül yok" with what is left. `none` is
 * what "Ödül yok" gets (below 0: the others pass %100), `total` the sum the badge shows, `ok` whether it can be
 * saved, `bad` the multipliers whose text isn't a percentage.
 */
export function oddsOf(draft) {
  const bad = MULTS.filter((m) => weightOf(draft?.[m]) === null);
  const listed = MULTS.map((m) => ({ mult: m, weight: weightOf(draft?.[m]) ?? 0 })).filter((t) => t.weight > 0);
  const sum = listed.reduce((n, t) => n + t.weight, 0);
  const none = TOTAL - sum;
  return { tiers: [{ mult: 0, weight: Math.max(0, none) }, ...listed], none, total: sum + Math.max(0, none), ok: !bad.length && none >= 0, bad };
}

/** The expected return of a table, as a share of the price (0.65: 65 %). */
export const rtpOf = (tiers) => tiers.reduce((s, t) => s + t.mult * t.weight, 0) / TOTAL;
/** The largest multiplier that can come out. */
export const topOf = (tiers) => Math.max(0, ...tiers.filter((t) => t.weight > 0).map((t) => t.mult));

/** The next free id: lk and one above the largest number in use (lk1–lk4 are the app's: the first new one is lk5). */
export function nextId(gifts) {
  const used = new Set(gifts.map((g) => g.id));
  let n = Math.max(0, ...gifts.map((g) => Number(/^lk(\d{1,9})$/.exec(g.id)?.[1] ?? 0))) + 1;
  while (used.has(`lk${n}`)) n += 1;
  return `lk${n}`;
}

/**
 * What is wrong with package `p` ({ id, name, emoji, price, draft }) beside the `others` saved with it, in Turkish;
 * [] when it can be saved. The same rules as the app's server, so Kaydet stays off rather than coming back refused.
 */
export function packageProblems(p, others = [], sharePct = 10) {
  const out = [];
  const id = String(p.id ?? '').trim();
  if (!LUCKY_ID.test(id)) out.push('Kimlik "lk" ile başlamalı, ardından en çok 20 küçük harf ya da rakam gelmeli (ör. lk5)');
  else if (others.some((g) => g.id === id)) out.push(`“${id}” kimliği başka bir pakette var`);
  const name = String(p.name ?? '').trim();
  if (name.length < 1 || name.length > NAME_MAX) out.push(`Ad 1–${NAME_MAX} karakter olmalı`);
  else if (others.some((g) => g.name.trim().toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr'))) out.push(`“${name}” adında başka bir paket var; her paketin adı ayrı olmalı`);
  const emoji = String(p.emoji ?? '').trim();
  if (emoji.length < 1 || emoji.length > EMOJI_MAX) out.push(`Simge 1–${EMOJI_MAX} karakter olmalı (ör. 🍀)`);
  const price = Number(p.price);
  if (!Number.isSafeInteger(price) || price < PRICE.min || price > PRICE.max) out.push(`Fiyat ${fmt(PRICE.min)} ile ${fmt(PRICE.max)} jeton arası bir tam sayı olmalı`);
  // The recipient's share (Alıcı payı, `sharePct` %) must be at least one whole diamond, as the app checks.
  else if (Math.floor((price * sharePct) / 100) < 1) out.push(`%${sharePct} alıcı payıyla alıcıya en az 1 elmas düşmesi için fiyat en az ${fmt(Math.ceil(100 / sharePct))} jeton olmalı`);
  const odds = oddsOf(p.draft);
  for (const m of odds.bad) out.push(`${m}x: yüzde en çok 3 ondalıklı bir sayı olmalı (ör. 0,125)`);
  if (!odds.bad.length && odds.none < 0) out.push(`Olasılıkların toplamı %${pctOf(odds.total)}; %100 olmalı`);
  return out;
}

/** The package to save from the editor (the app's server sets `since` itself). */
export const packageOf = (p) => ({
  id: String(p.id).trim(),
  name: String(p.name).replace(/\s+/g, ' ').trim(),
  emoji: String(p.emoji).trim(),
  price: Number(p.price),
  enabled: !!p.enabled,
  tiers: oddsOf(p.draft).tiers,
});

/** The settings as they are saved: each package without `since` (the app's server works it out again). */
export const savable = (config) => ({ ...config, gifts: config.gifts.map(({ since, ...g }) => g) });
/** The settings to save with package `p` added (no `was`) or put in the place of the one with id `was`. */
export const withPackage = (config, p, was = null) => savable({ ...config, gifts: was ? config.gifts.map((g) => (g.id === was ? p : g)) : [...config.gifts, p] });
