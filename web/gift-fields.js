// Uygulama › Hediyeler's Global hediye and Profil izi fields (web/pages/app-gifts.js), apart from the page so the
// panel's tests read them: no imports, no browser. The app's server has the last word on both (its global-gifts.mjs
// globalSave, custom-gifts.mjs checkMarkPrices and profile-mark-rules.mjs markInput); the page shows its sentence as it
// comes.
//
// Global hediye: a gift announced in every room of the sender's country, from Canlı ayarlar' minimum price on
// (`globalMinPrice` in the gift list). Never a bond gift (bag-…), Koruma Kartı, nor a gift that leaves or cleans a
// profile mark. A gift left under a minimum raised later keeps its mark but isn't announced.
// Profil izi (Muzip hediyeler): a gift may leave a mark on its receiver's profile photo (Kaka Şakası: role 'leave', a
// kind from Hediyeler › İz türleri, its time in minutes or none: the kind's, else the Canlı ayar's) or clean one of a
// kind (Temizlik Suyu: 'clean'); a cleaning gift must cost more than every gift leaving its kind. The list's rule is
// { role, kind, hours, minutes } (hours rounded up from minutes, for older APKs); an app server before kinds answers
// { role, kind, hours } and takes hours only: the page then writes the kind and hours as before (`legacy`).

/**
 * The gift panel's shelves in the phones' order, by id (the app's custom-gifts.mjs CATS) and the name the app shows.
 * gameplay was Kutlama until Muzip hediyeler (20 Nov 2026), couple İkili before Çift: older APKs still show the old
 * names (compiled), the id is the same.
 */
export const SHELVES = Object.freeze([
  ['hot', 'Popüler'],
  ['couple', 'Çift'],
  ['family', 'Aile ve Dost'],
  ['gameplay', 'Muzip'],
  ['privilege', 'Özel'],
]);

export const KIND = /^[a-z][a-z0-9-]{0,23}$/;
export const HOURS = Object.freeze({ min: 1, max: 168 });
/** A mark's time in minutes, on a gift or a kind (the app's profile-mark-rules.mjs MINUTES): 5 minutes to 7 days. */
export const MINUTES = Object.freeze({ min: 5, max: 10_080 });
export const GUARD_CARD = 'koruma';
export const isBondGift = (id) => typeof id === 'string' && id.startsWith('bag-');
/** A gift that can be neither global nor leave or clean a mark: a bond gift, Koruma Kartı. */
export const plainOnly = (id) => isBondGift(id) || id === GUARD_CARD;
const marks = (m) => m?.role === 'leave' || m?.role === 'clean';
const fmt = (n) => Number(n).toLocaleString('tr-TR');

// ---- Süre (minutes or hours) ------------------------------------------------------------------------------------
/** "45 dakika", "1 saat 30 dakika", "24 saat", "2 gün": how long a mark of `minutes` stays (the app's durationText). */
export function durationText(minutes) {
  const m = Math.max(1, Math.round(minutes));
  if (m < 60) return `${m} dakika`;
  if (m % 1440 === 0 && m > 1440) return `${m / 1440} gün`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} saat ${m % 60} dakika` : `${h} saat`;
}
/** A time's fields: whole hours in hours, anything else in minutes; none: '' (the kind's or the Canlı ayar's). */
export const amountForm = (minutes) =>
  Number.isSafeInteger(minutes) && minutes > 0 ? (minutes % 60 === 0 ? { amount: String(minutes / 60), unit: 'hours' } : { amount: String(minutes), unit: 'minutes' }) : { amount: '', unit: 'hours' };
/**
 * A time typed in the form: { minutes } (null when left empty) or { error } in Turkish. `unit` 'hours' (1–168) or
 * 'minutes' (5–10.080); `what` starts the sentence, `blank` (what an empty field means) ends it.
 */
export function amountMinutes(amount, unit, { what = 'Süre', blank }) {
  const t = String(amount ?? '').trim();
  if (!t) return { minutes: null };
  const n = /^\d{1,5}$/.test(t) ? Number(t) : NaN;
  if (unit === 'minutes') {
    if (!(n >= MINUTES.min && n <= MINUTES.max)) return { error: `${what} ${MINUTES.min}–${fmt(MINUTES.max)} dakika arasında bir tam sayı olmalı (boş: ${blank})` };
    return { minutes: n };
  }
  if (!(n >= HOURS.min && n <= HOURS.max)) return { error: `${what} ${HOURS.min}–${HOURS.max} saat arasında bir tam sayı olmalı (boş: ${blank})` };
  return { minutes: n * 60 };
}

// ---- Profil izi ---------------------------------------------------------------------------------------
/** A leave rule's own time in minutes (an older server's whole hours too); null: the kind's, else the Canlı ayar's. */
export function minutesOf(m) {
  if (m?.role !== 'leave') return null;
  if (Number.isSafeInteger(m.minutes) && m.minutes > 0) return m.minutes;
  return Number.isSafeInteger(m.hours) && m.hours > 0 ? m.hours * 60 : null;
}

/** The form's fields from a gift's rule ({ role, kind, hours, minutes } or null): { role, kind, amount, unit }. */
export const markForm = (m) => ({ role: marks(m) ? m.role : 'none', kind: m?.kind ?? '', ...amountForm(minutesOf(m)) });

/**
 * The rule to send from the form: { mark: null | { role, kind, minutes? } }, or { error } in Turkish. `legacy`: İz
 * türleri not read (an app server before kinds, or the list failed): a time in hours goes as `hours` (1–168), which
 * every app server takes; one in minutes (only a server with minutes gave one) as `minutes`.
 */
export function markOf(f, { legacy = false } = {}) {
  if (!f || f.role === 'none') return { mark: null };
  if (f.role !== 'leave' && f.role !== 'clean') return { error: 'Profil izi seçimi geçersiz' };
  const kind = String(f.kind ?? '').trim().toLowerCase();
  if (!kind) return { error: legacy ? 'İz türünü yazın (ör. kaka)' : 'İz türünü seçin (yoksa önce Hediyeler › İz türleri’nden ekleyin)' };
  if (!KIND.test(kind)) return { error: 'İz türü küçük harf, rakam ve tireyle kısa bir kelime olmalı (ör. kaka, kirik-cam): en çok 24 karakter; Türkçe harf, boşluk ve alt çizgi olmaz' };
  if (f.role === 'clean') return { mark: { role: 'clean', kind } };
  const unit = f.unit === 'minutes' ? 'minutes' : 'hours';
  const t = amountMinutes(f.amount, unit, { what: 'İzin süresi', blank: legacy ? 'Canlı ayarlardaki süre' : 'türün ya da Canlı ayarlardaki süre' });
  if (t.error) return { error: t.error };
  if (t.minutes === null) return { mark: { role: 'leave', kind } };
  return { mark: legacy && unit === 'hours' ? { role: 'leave', kind, hours: t.minutes / 60 } : { role: 'leave', kind, minutes: t.minutes } };
}

const markKey = (m) => (marks(m) ? JSON.stringify([m.role, m.kind, minutesOf(m)]) : 'none');
/** Whether two rules are the same (none, null and undefined alike; a leave's time compared in minutes, none: the kind's or the Canlı ayar's). */
export const sameMark = (a, b) => markKey(a) === markKey(b);

const kindIn = (kinds, key) => (Array.isArray(kinds) ? kinds.find((k) => k.kind === key) : undefined);
/**
 * A rule in words, for the list and under the field: "İz bırakır (Kırık Cam, 24 saat)". `kinds`: İz türleri (the kind's
 * name and own time); without it the kind's key.
 */
export function markText(m, kinds) {
  if (!marks(m)) return null;
  const k = kindIn(kinds, m.kind);
  const name = k?.name ?? m.kind;
  if (m.role === 'clean') return `İz temizler (${name})`;
  const own = minutesOf(m);
  if (own) return `İz bırakır (${name}, ${durationText(own)})`;
  if (k?.minutes) return `İz bırakır (${name}, türün süresi: ${durationText(k.minutes)})`;
  return `İz bırakır (${name}, Canlı ayardaki süre)`;
}

/** The kind select's choices: "Kırık Cam (kirik-cam)", a turned-off one said so; the rule's kind first when the list lacks it. */
export function kindOptions(kinds, current) {
  const out = (kinds ?? []).map((k) => ({ value: k.kind, label: `${k.name} (${k.kind})${k.enabled === false ? ' · kapalı' : ''}` }));
  if (current && !out.some((o) => o.value === current)) out.unshift({ value: current, label: `${current} (İz türlerinde yok)` });
  return out;
}

/** The sentence the app's server answers for a rule naming a kind İz türleri doesn't have (null: it has it, or no rule). */
export const unknownKind = (mark, kinds) => (marks(mark) && Array.isArray(kinds) && !kindIn(kinds, mark.kind) ? `"${mark.kind}" diye bir iz türü yok: önce Hediyeler › İz türleri'nden bu türü ekleyin` : null);

/**
 * The warnings under the rule (none: []): its kind is turned off (the gift goes as a plain gift), or a leave's kind has
 * nothing to clean it now (no gift cleans it, or none of those is on the shelves). `gifts`: every gift as the list has
 * them; `self`: this gift's id (its own rule now doesn't count).
 */
export function markWarnings(mark, { kinds, gifts = [], self } = {}) {
  if (!marks(mark)) return [];
  const out = [];
  if (kindIn(kinds, mark.kind)?.enabled === false) out.push('Bu tür kapalı: hediye düz hediye gibi gider, iz bırakmaz ve temizlemez (Hediyeler › İz türleri’nden açılır).');
  if (mark.role === 'leave') {
    const cleaners = gifts.filter((g) => g.id !== self && g.mark?.role === 'clean' && g.mark.kind === mark.kind);
    if (!cleaners.length) out.push('Bu türü temizleyen hediye yok: iz yalnız süresi bitince ya da yönetim kaldırınca kalkar. Temizleyen bir hediye ekleyin (Profil izi: Temizler, aynı tür, bundan pahalı).');
    else if (!cleaners.some((g) => g.enabled)) out.push(`Bu türü temizleyen hediye rafta değil (${cleaners.map((g) => g.name).join(', ')}): kimse gönderemez.`);
  }
  return out;
}

/**
 * Whether saving gift `changed` keeps its kind's price rule (the app's profile-mark-rules.mjs markPriceProblem, the same
 * sentence): each gift that cleans the kind costs more than each gift that leaves it. `gifts`: every gift as it will be
 * ({ id, name, price, mark }). Null when it does or the gift has no rule.
 */
export function markPriceProblem(gifts, changed) {
  const self = gifts.find((g) => g.id === changed);
  if (!marks(self?.mark)) return null;
  const kind = self.mark.kind;
  const same = gifts.filter((g) => marks(g.mark) && g.mark.kind === kind);
  const leave = same.filter((g) => g.mark.role === 'leave');
  const clean = same.filter((g) => g.mark.role === 'clean');
  if (!leave.length || !clean.length) return null;
  const top = leave.reduce((a, b) => (b.price > a.price ? b : a));
  const low = clean.reduce((a, b) => (b.price < a.price ? b : a));
  if (low.price > top.price) return null;
  if (self.mark.role === 'clean') return `${self.name} izi temizlediği için onu bırakan hediyelerden pahalı olmalı: ${top.name} ${fmt(top.price)} jeton, bu ${fmt(self.price)} jeton.`;
  return `${self.name} iz bıraktığı için onu temizleyen hediyelerden ucuz olmalı: ${low.name} ${fmt(low.price)} jeton, bu ${fmt(self.price)} jeton.`;
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
