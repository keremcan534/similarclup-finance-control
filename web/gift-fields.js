// Uygulama › Hediyeler's Global hediye and Profil izi fields (web/pages/app-gifts.js), apart from the page so the
// panel's tests read them: no imports, no browser. The app's server has the last word on both (its global-gifts.mjs
// globalSave and custom-gifts.mjs checkMarkPrices); the page shows its sentence as it comes.
//
// Global hediye: a gift announced in every room of the sender's country, from Canlı ayarlar' minimum price on
// (`globalMinPrice` in the gift list). Never a bond gift (bag-…), Koruma Kartı, nor a gift that leaves or cleans a
// profile mark. A gift left under a minimum raised later keeps its mark but isn't announced.
// Profil izi: a gift may leave a mark on its receiver's profile photo (Kaka: role 'leave', its kind, hours or the
// Canlı ayar's) or clean one of a kind (Su: 'clean'); a cleaning gift must cost more than every gift leaving its kind.

export const KIND = /^[a-z][a-z0-9-]{0,23}$/;
export const HOURS = Object.freeze({ min: 1, max: 168 });
export const GUARD_CARD = 'koruma';
export const isBondGift = (id) => typeof id === 'string' && id.startsWith('bag-');
/** A gift that can be neither global nor leave or clean a mark: a bond gift, Koruma Kartı. */
export const plainOnly = (id) => isBondGift(id) || id === GUARD_CARD;
const marks = (m) => m?.role === 'leave' || m?.role === 'clean';
const fmt = (n) => Number(n).toLocaleString('tr-TR');

// ---- Profil izi ---------------------------------------------------------------------------------------
/** The form's fields from a gift's rule ({ role, kind, hours } or null). */
export const markForm = (m) => ({ role: marks(m) ? m.role : 'none', kind: m?.kind ?? '', hours: m?.role === 'leave' && m.hours ? String(m.hours) : '' });

/** The rule to send from the form: { mark: null | { role, kind, hours? } }, or { error } in Turkish. */
export function markOf(f) {
  if (!f || f.role === 'none') return { mark: null };
  if (f.role !== 'leave' && f.role !== 'clean') return { error: 'Profil izi seçimi geçersiz' };
  const kind = String(f.kind ?? '').trim().toLowerCase();
  if (!KIND.test(kind)) return { error: 'İz türü küçük harfle kısa bir kelime olmalı (ör. kaka): harf, rakam ve tire, en çok 24 karakter, Türkçe harf olmadan' };
  if (f.role === 'clean') return { mark: { role: 'clean', kind } };
  const h = String(f.hours ?? '').trim();
  if (!h) return { mark: { role: 'leave', kind } };
  if (!/^\d{1,3}$/.test(h) || Number(h) < HOURS.min || Number(h) > HOURS.max) return { error: `İzin süresi ${HOURS.min}–${HOURS.max} saat arasında bir tam sayı olmalı (boş: Canlı ayarlardaki süre)` };
  return { mark: { role: 'leave', kind, hours: Number(h) } };
}

const markKey = (m) => (marks(m) ? JSON.stringify([m.role, m.kind, m.role === 'leave' ? (m.hours ?? null) : null]) : 'none');
/** Whether two rules are the same (none, null and undefined alike; a leave's hours null: the Canlı ayar's). */
export const sameMark = (a, b) => markKey(a) === markKey(b);

/** A rule in words, for the list and under the field: "İz bırakır (kaka, 24 saat)". */
export function markText(m) {
  if (!marks(m)) return null;
  return m.role === 'leave' ? `İz bırakır (${m.kind}${m.hours ? `, ${m.hours} saat` : ', Canlı ayardaki süre'})` : `İz temizler (${m.kind})`;
}

// ---- Global hediye ------------------------------------------------------------------------------------
/**
 * What the Global box shows for the form now: hidden for a bond gift and Koruma Kartı; disabled (it can't be ticked)
 * under the minimum price or with a profile mark, unless it is ticked already (it can always come off). `hint`: the
 * line under it.
 */
export function globalBox({ id, price, global, mark, min }) {
  if (plainOnly(id)) return { hidden: true, disabled: true, hint: null };
  const low = !(Number(price) >= min);
  if (marks(mark)) return { hidden: false, disabled: !global, hint: 'Profil izi bırakan ya da temizleyen hediye global olamaz' };
  if (low) return { hidden: false, disabled: !global, hint: `En az ${fmt(min)} jeton${global ? ': bu fiyatla duyurulmaz' : ''}` };
  return { hidden: false, disabled: false, hint: `En az ${fmt(min)} jeton` };
}

/**
 * The refusal before a save, as the app's server would answer it (null: none). As there, the price is checked only
 * when the box is ticked now or the price changes; a mark with the box ticked always.
 */
export function globalProblem({ id, price, global, was = false, priceChanged = false, mark, min }) {
  if (!global) return null;
  if (isBondGift(id)) return 'Bağ hediyesi global olamaz: bağ isteği olarak gider';
  if (id === GUARD_CARD) return 'Koruma Kartı global olamaz';
  if (marks(mark)) return 'Profil izi bırakan ya da temizleyen hediye global olamaz; Global seçimini ya da iz kuralını kaldırın';
  if ((global !== was || priceChanged) && !(Number(price) >= min)) return `Global hediye en az ${fmt(min)} jeton olmalı (bu ${fmt(price)} jeton)`;
  return null;
}

/** The list's note on a global gift under today's minimum: it isn't announced. */
export const globalNote = (g, min) => (g.global && typeof min === 'number' && !(Number(g.price) >= min) ? 'duyurulmuyor: fiyat sınırın altında' : null);

/**
 * The global and mark part of a save: for a new gift (no `gift`) both; for one that exists only what changed (an
 * app's own gift's rule compares with its rule now, so leaving it as it is sends nothing).
 */
export function extraFields(gift, { global, mark }) {
  if (!gift) return { global: !!global, mark: mark ?? null };
  const out = {};
  if (!!global !== (gift.global === true)) out.global = !!global;
  if (!sameMark(mark, gift.mark)) out.mark = mark ?? null;
  return out;
}
