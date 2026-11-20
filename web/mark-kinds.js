// Uygulama › Hediyeler › İz türleri (web/pages/app-mark-kinds.js)'s rules, apart from the page so the panel's tests
// read them: no browser, only gift-fields.js. A kind (kaka, kirik-cam, …) is what a gift that leaves a profile mark and
// the gifts that clean it share; the app's mark-kinds.mjs keeps them (GET /api/admin/mark-kinds → { kinds, limits, on,
// hours }) and checks every save itself: the page checks the same first, in the same words, so a save it lets through
// isn't refused there for a reason it could have said, and the body is what the app reads.
//
// The overlay picture (upload kind markart) is checked by the app's server pixel by pixel when the kind is saved
// (tools/mark-art-check.py, profile-mark-rules.mjs markArtProblem); artInfo / artStats / artProblem do the same in the
// browser before the upload, with the limits it answers. The server's sentence still wins.
import { KIND, MINUTES, amountForm, amountMinutes, durationText } from './gift-fields.js';

export { durationText };
/** What the same kind again does to a showing mark (the app's STACKS). */
export const STACKS = ['refresh', 'replace'];
export const STACK_TEXT = { refresh: 'Süre yeniden başlar', replace: 'Eskisi kalkar, yenisi konur' };
export const STACK_HELP = {
  refresh: 'Aynı iz yeniden gelirse profildeki iz kalır, süresi baştan başlar (kayıtta tek iz).',
  replace: 'Aynı iz yeniden gelirse eskisi "yerine geçti" diye kapanır, yenisi baştan konur (kayıtta iki iz).',
};
/** The kinds the app draws with a picture of its own when none is uploaded (lib/profile-marks COMPILED_MARKS). */
export const COMPILED = Object.freeze({ kaka: 'Kaka İzi', 'kirik-cam': 'Kırık Cam' });
/** The upload's rules when the app's server gives none (its mark-kinds.mjs limits, profile-mark-rules.mjs MARK_ART). */
export const LIMITS = Object.freeze({
  nameMax: 24,
  minutes: MINUTES,
  bytes: 2 * 1024 * 1024,
  types: ['image/png', 'image/webp'],
  minPx: 256,
  maxPx: 2048,
  servePx: 512,
  serveBytes: 300 * 1024,
  clearMin: 0.3,
  faceMax: 0.2,
  faceRadius: 0.3,
  stacks: STACKS,
});
const fmt = (n) => Number(n).toLocaleString('tr-TR');
const pct = (x) => `%${Math.round(x * 100)}`;
const mbText = (n) => (n / 1024 / 1024).toLocaleString('tr-TR', { maximumFractionDigits: 1 });

/**
 * Whether the app's server has no İz türleri: one from before them answers its route with 403 ("Bu işlem finans
 * panelinden yapılamaz": not in its PANEL_ROUTES) or 404. The page then says so and the gift form writes the kind by hand.
 * (Only Hediyeler's users read it, and they have its permission here: a 403 is the app's.)
 */
export const kindsMissing = (e) => e?.status === 404 || e?.status === 403;

/** A key from a kind's name, while the key field is left alone: "Kırık Cam" → kirik-cam, "Çamur" → camur. */
const ASCII = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };
export function keyFromName(name) {
  return String(name ?? '')
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşüâîû]/g, (c) => ASCII[c])
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .slice(0, 24)
    .replace(/-+$/, '');
}

/** The editor's fields from a kind (none: a new one, on). */
export const kindForm = (k) => ({
  kind: k?.kind ?? '',
  name: k?.name ?? '',
  ...amountForm(k?.minutes ?? null),
  stack: k?.stack === 'replace' ? 'replace' : 'refresh',
  enabled: k ? k.enabled !== false : true,
});

/**
 * What a save sends, the picture apart: a new kind's whole body (`k` none), or `kind` and only what changed of `k`
 * (`changed`: whether anything did). { error } in the app's words. `taken`: the kinds there are (a new key mustn't be one).
 */
export function kindBody(f, k, { nameMax = LIMITS.nameMax, taken = [] } = {}) {
  const name = String(f.name ?? '').replace(/\s+/g, ' ').trim();
  // eslint-disable-next-line no-control-regex
  if (!name || name.length > nameMax || /[\u0000-\u001f\u007f<>]/.test(name)) return { error: `İzin adı 1–${nameMax} harf olmalı (ör. Kırık Cam)` };
  const t = amountMinutes(f.amount, f.unit, { blank: 'Canlı ayarlardaki süre' });
  if (t.error) return { error: t.error };
  const stack = f.stack === 'replace' ? 'replace' : 'refresh';
  const enabled = f.enabled !== false;
  if (!k) {
    const kind = String(f.kind ?? '').trim().toLowerCase();
    if (!KIND.test(kind)) return { error: 'Tür anahtarı küçük harf, rakam ve tireyle kısa bir kelime olmalı (ör. kirik-cam, camur); boşluk ve alt çizgi olmaz' };
    const had = taken.find((x) => x.kind === kind);
    if (had) return { error: `"${kind}" türü zaten var (${had.name}); onu düzenleyin` };
    return { body: { kind, name, ...(t.minutes ? { minutes: t.minutes } : {}), stack, enabled }, changed: true };
  }
  const body = { kind: k.kind };
  if (name !== k.name) body.name = name;
  if ((t.minutes ?? null) !== (k.minutes ?? null)) body.minutes = t.minutes ?? null;
  if (stack !== (k.stack ?? 'refresh')) body.stack = stack;
  if (enabled !== (k.enabled !== false)) body.enabled = enabled;
  return { body, changed: Object.keys(body).length > 1 };
}

/** A kind's own time in words, else the Canlı ayar's (`hours`: 0 is Profil izleri turned off). */
export const kindTime = (k, hours) => (k?.minutes ? durationText(k.minutes) : `Canlı ayar: ${hours > 0 ? durationText(hours * 60) : 'kapalı'}`);

/**
 * A kind's gifts and what is wrong with it, for its row: the gifts that leave it and clean it (each { id, name, role,
 * minutes?, enabled }), the warnings (a leave with nothing to clean it, a turned-off kind still on gifts, a picture the
 * server couldn't check), and whether it can be deleted (no gift uses it: the app refuses otherwise).
 */
export function kindSummary(k) {
  const gifts = Array.isArray(k?.gifts) ? k.gifts : [];
  const leave = gifts.filter((g) => g.role === 'leave');
  const clean = gifts.filter((g) => g.role === 'clean');
  const warn = [];
  if (leave.length && !clean.length) warn.push('Temizleyen hediye yok: iz yalnız süresi bitince ya da yönetim kaldırınca kalkar');
  else if (leave.length && !clean.some((g) => g.enabled)) warn.push('Temizleyen hediye rafta değil: kimse temizleyemez');
  if (k?.enabled === false && gifts.length) warn.push('Kapalı: hediyeleri düz hediye gibi gider');
  if (k?.art && k.art.checked === false) warn.push('Resim denetlenmedi: telefonlara gitmez');
  return { leave, clean, warn, deletable: gifts.length === 0 };
}

/**
 * What phones draw for a kind (the app's lib/profile-marks markLayerOf): its uploaded overlay once the server checked it,
 * else the app's own picture (Kaka İzi, Kırık Cam), else the leaving gift's small picture alone. `badge`: the gift's
 * picture on the photo too (the badge alone, and the app's own Kaka İzi; never over an uploaded overlay).
 */
export function layerOf(k) {
  if (k?.art?.url && k.art.checked !== false) return { art: k.art.url, compiled: null, badge: false, text: 'Yüklenen resim' };
  if (k?.kind && Object.hasOwn(COMPILED, k.kind)) return { art: null, compiled: k.kind, badge: k.kind === 'kaka', text: 'Uygulamanın kendi resmi' };
  return { art: null, compiled: null, badge: true, text: 'Resim yok: hediyenin rozeti' };
}

// ---- The overlay picture ------------------------------------------------------------------------------------------
const ascii = (b, from, to) => String.fromCharCode(...b.subarray(from, to));
const u32be = (b, p) => b[p] * 0x1000000 + ((b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]);
const u32le = (b, p) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16)) + b[p + 3] * 0x1000000;
const u24le = (b, p) => b[p] | (b[p + 1] << 8) | (b[p + 2] << 16);
const u16le = (b, p) => b[p] | (b[p + 1] << 8);

/**
 * A PNG's or WebP's header, as the app's server reads it (custom-gifts.mjs imageInfo): { type, width, height, alpha,
 * animated }, or null for anything else (the first bytes decide, not the name). `b`: the file's bytes (Uint8Array).
 */
export function artInfo(b) {
  if (b.length >= 33 && u32be(b, 0) === 0x89504e47 && u32be(b, 4) === 0x0d0a1a0a && ascii(b, 12, 16) === 'IHDR') {
    const type = b[25];
    let alpha = type === 4 || type === 6;
    let animated = false;
    for (let p = 8; p + 8 <= b.length; ) {
      const len = u32be(b, p);
      const name = ascii(b, p + 4, p + 8);
      if (name === 'tRNS') alpha = true;
      if (name === 'acTL') animated = true;
      if (name === 'IDAT' || name === 'IEND') break;
      p += 12 + len;
    }
    return { type: 'png', width: u32be(b, 16), height: u32be(b, 20), alpha, animated };
  }
  if (b.length >= 30 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') {
    const chunk = ascii(b, 12, 16);
    if (chunk === 'VP8X') return { type: 'webp', width: 1 + u24le(b, 24), height: 1 + u24le(b, 27), alpha: (b[20] & 0x10) !== 0, animated: (b[20] & 0x02) !== 0 };
    if (chunk === 'VP8L' && b[20] === 0x2f) {
      const bits = u32le(b, 21);
      return { type: 'webp', width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff), alpha: ((bits >>> 28) & 1) === 1, animated: false };
    }
    if (chunk === 'VP8 ' && ((b[23] << 16) | (b[24] << 8) | b[25]) === 0x9d012a) return { type: 'webp', width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff, alpha: false, animated: false };
  }
  return null;
}

/**
 * How the picture covers the photo under it (the app's tools/mark-art-check.py): `clear` the share of its pixels fully
 * transparent (alpha 0), `face` the share of the face circle (centred, `faceRadius` of the side) more than half opaque
 * (alpha ≥ 128). `rgba`: its pixels as a canvas gives them (4 bytes each).
 */
export function artStats(rgba, w, h, faceRadius = LIMITS.faceRadius) {
  let clear = 0;
  let inFace = 0;
  let face = 0;
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const r2 = (faceRadius * Math.min(w, h)) ** 2;
  for (let y = 0; y < h; y++) {
    const dy2 = (y - cy) ** 2;
    for (let x = 0; x < w; x++) {
      const a = rgba[(y * w + x) * 4 + 3];
      if (a === 0) clear++;
      if ((x - cx) ** 2 + dy2 <= r2) {
        inFace++;
        if (a >= 128) face++;
      }
    }
  }
  return { clear: w * h ? clear / (w * h) : 0, face: inFace ? face / inFace : 0 };
}

/**
 * Why a picked overlay can't be used, in the app's words (profile-mark-rules.mjs markArtProblem), from its size in bytes,
 * its header (`info`, artInfo's) and what artStats measured (`stats`; none yet: the header only). Null when it can.
 */
export function artProblem({ bytes, info, stats }, L = LIMITS) {
  if (Number.isFinite(bytes) && bytes > L.bytes) return `İz resmi en çok ${mbText(L.bytes)} MB olabilir (bu ${mbText(bytes)} MB)`;
  if (!info) return 'İz resmi PNG ya da WebP olmalı';
  if (info.animated) return 'İz resmi hareketsiz olmalı: hareketli PNG ya da WebP değil, tek kare bir resim yükleyin';
  const { width: w, height: h } = info;
  if (Math.abs(w - h) > Math.max(2, w * 0.02)) return `İz resmi kare olmalı (bu ${w} × ${h}); 512 × 512 önerilir`;
  if (w < L.minPx || w > L.maxPx) return `İz resmi ${L.minPx}–${L.maxPx} piksel olmalı (bu ${w} × ${h}); 512 × 512 önerilir`;
  if (!info.alpha) return 'İz resminde saydamlık yok: arka planı tam saydam (alfa 0) bir PNG ya da WebP yükleyin';
  if (!stats) return null;
  if (stats.clear < L.clearMin) {
    return `İz resminin en az ${pct(L.clearMin)}'i tam saydam (alfa 0) olmalı, bunda ${pct(stats.clear)}: fotoğraf görünmez kalır. Arka planı silinmiş, kenarlarda çizim olan bir resim yükleyin`;
  }
  if (stats.face > L.faceMax) {
    return `İz resmi yüzü kapatıyor: ortadaki dairenin en çok ${pct(L.faceMax)}'i dolu olabilir, bunda ${pct(stats.face)}. Çizimi kenarlara alın, ortayı boş bırakın`;
  }
  return null;
}

/** A checked picture's numbers in words: "512 px · 68 KB · %78 saydam · yüz %0 dolu". */
export function artLine(a) {
  if (!a) return '';
  const parts = [];
  if (a.px) parts.push(`${a.px} px`);
  if (a.bytes) parts.push(a.bytes < 1024 * 1024 ? `${Math.max(1, Math.round(a.bytes / 1024))} KB` : `${mbText(a.bytes)} MB`);
  if (a.stats) parts.push(`${pct(a.stats.clear)} saydam`, `yüz ${pct(a.stats.face)} dolu`);
  return parts.join(' · ');
}

/** The upload's rules in a sentence, under the picture field (`L`: the app's limits). */
export const artRules = (L = LIMITS) =>
  `Saydam PNG ya da WebP, kare, ${L.minPx}–${fmt(L.maxPx)} piksel (512 × 512 önerilir), en çok ${mbText(L.bytes)} MB, hareketsiz. Tam saydam (alfa 0) pay en az ${pct(L.clearMin)}; ortadaki yüz dairesinin dolu payı en çok ${pct(L.faceMax)}: çizim kenarlarda, orta boş. Büyüğü telefonlar için ${L.servePx} piksele küçültülür. Arka plan silme yapılmaz.`;

// ---- The preview (the app's iz-onizleme.tsx) ----------------------------------------------------------------------
/** The faces a mark is drawn on in the app, in dp (a CSS px here): a mic seat at its smallest, the standard one, the person card, the largest seat and a profile, the host's seat. */
export const FACES = Object.freeze([
  { size: 30, label: 'Koltuk (kalabalık sıra)' },
  { size: 52, label: 'Koltuk' },
  { size: 78, label: 'Kişi kartı' },
  { size: 96, label: 'Büyük koltuk · profil' },
  { size: 112, label: 'Oda sahibi' },
]);
/** The preview's grounds (the app's: a light room and a dark one) and the ink written on each. */
export const GROUNDS = Object.freeze([
  { key: 'dark', label: 'Koyu zemin', bg: '#160F28', ink: '#FFFFFF' },
  { key: 'light', label: 'Açık zemin', bg: '#F4F1EA', ink: '#1B1530' },
]);
/** The VIP ring the preview draws (the app's VIP 6, Safir: its colours and badge). */
export const VIP_RING = Object.freeze({ level: 6, name: 'Safir', colors: ['#2563EB', '#60A5FA'], emoji: '🔷' });
/** Where the gift's badge sits on a photo of `size` (the app's components/profile-mark): low, right of the middle. */
export function badgeBox(size) {
  const b = Math.max(14, Math.round(size * 0.32));
  return { size: b, left: 60 - (b / size) * 50, top: 63 - (b / size) * 50 };
}
/** A shop frame's box for a photo of `size` (its picture's hole is `hole` of its side, as a radius). */
export const frameBox = (size, hole) => Math.round(size / (2 * (hole > 0 ? hole : 0.35)));

