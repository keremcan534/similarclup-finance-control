// Uygulama › Hediyeler › Bağ işaretleri (web/pages/app-bond-looks.js)'s rules, apart from the page so the panel's tests
// read them. The app's bond-looks.mjs keeps, for each bond kind (Çift, Kardeş, …), the levels staff designed: a still
// picture and/or a moving one, and how big it is drawn (GET /api/admin/bond-looks → { kinds, levels, looks, limits,
// storage, svga }). A level without its own design shows the nearest lower one's; below the kind's first design the
// app draws its own mark (the kind's picture in a ring that changes every five levels).

/** How big a design may be drawn next to the app's own mark (the app takes 1–3). */
export const SIZES = [
  [1, 'Normal (1×)'],
  [1.25, '1,25×'],
  [1.5, '1,5×'],
  [1.75, '1,75×'],
  [2, '2×'],
  [2.5, '2,5×'],
  [3, '3× (en büyük)'],
];
/** The upload's rules when the app's server gives none (its bond-looks.mjs BOND_LOOK_LIMITS). */
export const LIMITS = { artBytes: 4 * 1024 * 1024, artPxMin: 64, artPxMax: 1024, servePx: 512, motionBytes: 3 * 1024 * 1024, motionPxMin: 64, motionPxMax: 512, sizeMin: 1, sizeMax: 3 };

/** The app's own ring for a level (bond-rules.mjs tierOf: every five levels). */
export const OWN_RINGS = ['İnce halka', 'Renkli parlayan halka', 'Altın halka', 'Elmas halka ve yıldız'];
export const ownRing = (level) => OWN_RINGS[Math.min(3, Math.max(0, Math.ceil(level / 5) - 1))];

/** `looks` of one kind by level: level → design. */
export function byLevel(looks, kind) {
  const out = new Map();
  for (const x of looks ?? []) if (x.kind === kind && (x.art || x.motion)) out.set(x.level, x);
  return out;
}

/**
 * What each of `levels` levels shows: { level, own (the level's own design or null), shows (the design shown: its own,
 * else the nearest lower one's; null: the app's own mark), from (the level that design is from) }.
 */
export function levelRows(looks, kind, levels = 20) {
  const mine = byLevel(looks, kind);
  const rows = [];
  let last = null;
  for (let level = 1; level <= levels; level++) {
    const own = mine.get(level) ?? null;
    if (own) last = own;
    rows.push({ id: level, level, own, shows: last, from: last?.level ?? null });
  }
  return rows;
}

/** A row's "what shows" in words. */
export function showsText(r) {
  if (r.own) return 'Bu seviyenin kendi tasarımı';
  if (r.shows) return `Lv${r.from} tasarımı devam ediyor`;
  return `Uygulamanın kendi işareti (${ownRing(r.level)})`;
}

/** How many levels of each kind have a design of their own: kind → n. */
export function designedCount(looks) {
  const out = {};
  for (const x of looks ?? []) if (x.art || x.motion) out[x.kind] = (out[x.kind] ?? 0) + 1;
  return out;
}

/** The size in words. */
export const sizeText = (n) => SIZES.find(([v]) => v === n)?.[1] ?? `${String(n).replace('.', ',')}×`;

/**
 * What the editor saves: only what changed from `was` (the level's own design, or null). `art` / `motion`: the upload
 * address (or null: none). Null when nothing changed; an Error's message when the design would have no picture.
 */
export function saveBody(kind, level, was, { art, motion, size }) {
  if (!art && !motion) return { error: 'Bir durağan resim ya da hareketli hal yükleyin (ikisi birden de olur)' };
  const body = { kind, level };
  if ((was?.art?.url ?? null) !== (art ?? null)) body.art = art ?? null;
  if ((was?.motion?.url ?? null) !== (motion ?? null)) body.motion = motion ?? null;
  if ((was?.size ?? 1) !== size || !was) body.size = size;
  return Object.keys(body).length > 2 ? body : null;
}
