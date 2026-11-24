// Uygulama › finance pages: the Similar Club app's own money work, through its admin API (server/app-admin.ts passes
// each call on as the signed-in panel user; the app checks and records every one). Para çekme and Ajans ödemeleri
// never send money: the money goes from the bank, the page records it. İadeler takes back a store purchase's coins;
// Canlı ayarlar changes what the app does at once, for everyone (Şanslı hediyeler is app-lucky.js).
import { Badge, Button, Card, ID_HINT, Kpi, Loading, Modal, Page, Table, Tabs, act, dateTimeTr, html, num, personOf, post, showError, toast, useApi, useApp, usePrompt, useState } from '../lib.js';

const usd = (n) => `$${num(n, 2)}`;
const tlText = (n) => `${num(n, 2)} TL`;
/** What to send in TL: a paid one's own (rate written on it), else now at the payout rate (Canlı ayarlar › Ödeme kuru). */
const tlOf = (x, rate) => (x.payTl !== null && x.payTl !== undefined ? html`${tlText(x.payTl)}<br /><small class="muted">kur ${num(x.payUsdTry, 2)}</small>` : x.tlNow !== undefined ? html`${tlText(x.tlNow)}<br /><small class="muted">kur ${num(rate, 2)}</small>` : '—');
/** A row of filter chips: [value, label] pairs, one on. */
export const Chips = ({ value, options, onChange }) =>
  html`<div class="row gap wrap" style="margin-bottom:10px">${options.map(([k, l]) => html`<button class=${`chip ${value === k ? 'on' : ''}`} onClick=${() => onChange(k)}>${l}</button>`)}</div>`;
const STATUS_BADGE = { pending: 'pending', ready: 'approved', paid: 'paid', rejected: 'rejected', cancelled: 'cancelled', credited: 'active', refunded: 'cancelled' };
const PURCHASE = (p) => html`<${Badge} s=${STATUS_BADGE[p.status]} label=${p.status === 'refunded' ? 'İade edildi' : 'Yüklendi'} />`;
/** A change that went through: a toast, the list read again. */
const done = (list, text) => (ok) => ok && (toast(text), list.reload());

// ---- Para çekme -----------------------------------------------------------------------------------------
const W_STATUS = [
  ['pending', 'Bekleyen'],
  ['paid', 'Ödendi'],
  ['rejected', 'Reddedildi'],
  ['cancelled', 'İptal'],
  ['all', 'Tümü'],
];
export function AppWithdrawals() {
  const { can } = useApp();
  const [status, setStatus] = useState('pending');
  const list = useApi(`/api/app/withdrawals?status=${status}`);
  const [ask, prompt] = usePrompt();
  // The TL to send at the payout rate the list was read with; the decision sends that rate back, and a rate changed
  // meanwhile is refused (nothing marked) so the new amount is seen first.
  const paid = async (w) => {
    const to = w.method === 'iban' ? 'bu IBAN’a' : 'bu hesaba';
    const rate = list.data?.payUsdTry;
    if (!confirm(`Bu düğme para göndermez. Önce ${tlText(w.tlNow)} (${usd(w.usd)} × ödeme kuru ${num(rate, 2)}) tutarını bankanızdan ${w.holder} adına ${to} gönderin:\n\n${w.account}\n\nGönderdiyseniz devam edin; ${w.user.name} ödemenin yapıldığını görür.`)) return;
    done(list, 'Ödendi olarak işaretlendi')(await act(() => post('/api/app/withdrawals/decide', { id: w.id, approve: true, note: '', payUsdTry: rate })));
    list.reload();
  };
  const reject = async (w) => {
    const v = await ask('Talebi reddet', { text: `${num(w.diamonds)} elmas ${w.user.name} hesabına geri döner. Yazdığınız neden kişiye gösterilir.`, label: 'Neden', ok: 'Reddet' });
    if (v) done(list, 'Reddedildi; elmaslar geri döndü')(await act(() => post('/api/app/withdrawals/decide', { id: w.id, approve: false, note: v.reason })));
  };
  return html`<${Page} title="Para çekme" subtitle="Yayıncıların elmas → para talepleri. Para bu panelden gönderilmez: bankadan gönderilip burada işaretlenir. Reddedilen talebin elmasları kişiye geri döner. Kişi kendi talebine karar veremez.">
    ${prompt}
    <${Chips} value=${status} options=${W_STATUS} onChange=${setStatus} />
    <${Loading} state=${list}>${(d) => html`
      ${d.playMoney && html`<p class="note bad">Bu sunucuda test jetonu açık: test parasından gelen talepler ödenemez, yalnız reddedilebilir.</p>`}
      <${Table}
        empty=${status === 'pending' ? 'Bekleyen talep yok' : 'Bu listede talep yok'}
        columns=${[
          { key: 'createdAt', label: 'Tarih', render: (w) => dateTimeTr(w.createdAt) },
          { key: 'user', label: 'Kişi', render: (w) => html`${w.user.name}<br /><small class="muted num">${[w.user.publicNo && `ID ${w.user.publicNo}`, w.user.phone].filter(Boolean).join(' · ') || '—'}</small>` },
          { key: 'diamonds', label: 'Elmas', align: 'right', render: (w) => num(w.diamonds) },
          { key: 'usd', label: 'Tutar', align: 'right', render: (w) => usd(w.usd) },
          { key: 'tl', label: 'Gönderilecek TL', align: 'right', render: (w) => (w.status === 'pending' || w.status === 'paid' ? tlOf(w, d.payUsdTry) : '—') },
          { key: 'account', label: 'Hesap', render: (w) => html`${w.holder}<br /><small class="num">${w.method === 'iban' ? 'IBAN ' : ''}${w.account}</small>` },
          { key: 'status', label: 'Durum', render: (w) => html`<${Badge} s=${STATUS_BADGE[w.status]} label=${w.statusLabel} />${w.play ? html` <${Badge} s="warning" label="Test parası" />` : ''}` },
          { key: 'note', label: 'Not', render: (w) => w.note || '—' },
          {
            key: 'a',
            label: '',
            render: (w) =>
              w.status === 'pending' &&
              can('app.withdrawals') &&
              html`<span class="row gap">${w.payable && html`<${Button} kind="primary" onClick=${() => paid(w)}>Ödendi</${Button}>`}<${Button} kind="danger" onClick=${() => reject(w)}>Reddet</${Button}></span>`,
          },
        ]}
        rows=${d.rows}
      />`}</${Loading}>
  </${Page}>`;
}

// ---- Ajans ödemeleri ------------------------------------------------------------------------------------
const P_STATUS = [
  ['pending', 'Bekleyen'],
  ['ready', 'Onaylı'],
  ['paid', 'Ödendi'],
  ['rejected', 'Reddedildi'],
  ['cancelled', 'İptal'],
  ['', 'Tümü'],
];
export function AppPayouts() {
  const { can } = useApp();
  const [status, setStatus] = useState('pending');
  const list = useApi(`/api/app/agency/payouts${status ? `?status=${status}` : ''}`);
  const policy = useApi('/api/app/agency/settings');
  const twoPerson = !!policy.data?.values?.payout_policy?.two_person;
  const [ask, prompt] = usePrompt();
  // Commission is counted in diamonds (agency_payouts.currency 'diamond'); usd is what the bank sends.
  const money = (p) => (p.currency === 'diamond' ? `${num(p.amount)} elmas` : `${num(p.amount, 2)} ${p.currency}`);
  const decide = (p, action, extra, text) => act(() => post('/api/app/agency/payouts/decide', { payoutId: p.id, action, ...extra })).then(done(list, text));
  const approve = (p) => confirm(`${p.agency.name} için ${money(p)} · ${usd(p.usd)} ödemeye hazır olarak işaretlenir. Para bu adımda gönderilmez.`) && decide(p, 'approve', {}, 'Onaylandı');
  // The TL at the payout rate the list was read with; the decision sends that rate back (a changed rate is refused).
  const pay = async (p) => {
    const rate = list.data?.payUsdTry;
    const v = await ask('Ödendi olarak işaretle', {
      text: `Bu düğme para göndermez. Önce ${tlText(p.tlNow)} (${usd(p.usd)} × ödeme kuru ${num(rate, 2)}) tutarını ${p.agency.name} ajansına bankadan gönderin, sonra havale dekontundaki numarayı yazın. Ajans ödemenin yapıldığını görür.`,
      fields: [{ name: 'paymentRef', label: 'Dekont numarası', required: true, wide: true }],
      ok: 'Gönderdim, işaretle',
    });
    if (v) decide(p, 'pay', { paymentRef: v.paymentRef, payUsdTry: rate }, 'Ödendi olarak işaretlendi');
  };
  const stop = async (p, action) => {
    const v = await ask(action === 'reject' ? 'Ödemeyi reddet' : 'Ödemeyi iptal et', { text: 'Kazanç ajansın çekilebilir bakiyesine geri döner. Yazdığınız neden ajansa gösterilir.', label: 'Neden', ok: action === 'reject' ? 'Reddet' : 'İptal et' });
    if (v) decide(p, action, { note: v.reason }, action === 'reject' ? 'Reddedildi' : 'İptal edildi');
  };
  return html`<${Page} title="Ajans ödemeleri" subtitle="Ajansların komisyon ödeme talepleri: onay, banka havalesinden sonra ödendi işareti, ret ya da iptal. Kendi ajansının ya da kendi talebinin ödemesine kimse karar veremez.">
    ${prompt}
    ${twoPerson && html`<p class="note">İki kişili onay açık: onaylayan kişi ödendi işaretleyemez. Bu panelden yapılan bütün işlemler uygulamada aynı hesaptan (Finance Control) sayılır; panelden onaylanan bir ödemenin ödendi işaretini uygulamadaki Yönetim'den başka bir yönetici yapmalıdır.</p>`}
    <${Chips} value=${status} options=${P_STATUS} onChange=${setStatus} />
    <${Loading} state=${list}>${(d) => html`<${Table}
      empty="Bu listede ödeme yok"
      columns=${[
        { key: 'requestedAt', label: 'Talep', render: (p) => html`${dateTimeTr(p.requestedAt)}<br /><small class="muted">${p.requestedBy}</small>` },
        { key: 'agency', label: 'Ajans', render: (p) => html`${p.agency.name}<br /><small class="muted">${p.agency.code}</small>` },
        { key: 'amount', label: 'Tutar', align: 'right', render: (p) => html`${money(p)}<br /><small class="muted">${usd(p.usd)}</small>` },
        { key: 'tl', label: 'Gönderilecek TL', align: 'right', render: (p) => (['pending', 'ready', 'paid'].includes(p.status) ? tlOf(p, d.payUsdTry) : '—') },
        { key: 'status', label: 'Durum', render: (p) => html`<${Badge} s=${STATUS_BADGE[p.status]} label=${p.statusLabel} />${p.payable === false ? html` <${Badge} s="warning" label="Test parası" />` : ''}` },
        { key: 'approvedBy', label: 'Onaylayan', render: (p) => (p.approvedBy ? html`${p.approvedBy}<br /><small class="muted">${dateTimeTr(p.approvedAt)}</small>` : '—') },
        { key: 'paymentRef', label: 'Dekont', render: (p) => p.paymentRef ?? '—' },
        { key: 'note', label: 'Not', render: (p) => p.note || '—' },
        {
          key: 'a',
          label: '',
          render: (p) =>
            can('app.payouts') &&
            html`<span class="row gap">
              ${p.status === 'pending' && html`<${Button} kind="primary" disabled=${p.payable === false} onClick=${() => approve(p)}>Onayla</${Button}><${Button} kind="danger" onClick=${() => stop(p, 'reject')}>Reddet</${Button}>`}
              ${p.status === 'ready' && html`<${Button} kind="primary" disabled=${p.payable === false} onClick=${() => pay(p)}>Ödendi</${Button}><${Button} kind="danger" onClick=${() => stop(p, 'cancel')}>İptal</${Button}>`}
            </span>`,
        },
      ]}
      rows=${d.payouts}
    />`}</${Loading}>
  </${Page}>`;
}

// ---- İadeler ve cüzdan denetimi -------------------------------------------------------------------------
export function AppRefunds() {
  const { can } = useApp();
  const [tab, setTab] = useState('purchases');
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [who, setWho] = useState('');
  const [user, setUser] = useState('');
  const list = useApi(tab === 'purchases' ? `/api/app/purchases${search ? `?q=${encodeURIComponent(search)}` : ''}` : null);
  const audit = useApi(tab === 'wallet' && user ? `/api/app/wallet/audit?user=${encodeURIComponent(user)}` : null);
  const showWallet = async (e) => {
    e.preventDefault();
    const p = await act(() => personOf(who));
    if (p) setUser(p.id);
  };
  const refund = async (p) => {
    if (!confirm(`${p.user.name} · ${num(p.coins)}${p.bonus ? ` + ${num(p.bonus)}` : ''} jeton${p.priceTl ? ` · ${num(p.priceTl, 2)} TL` : ''}\n\nHarcanmamış jetonlar ve bunlardan gelen, kilidi açılmamış elmaslar geri alınır; ajans komisyonu da düşülür. Para iadesini mağaza yapar. Geri alınamaz.`)) return;
    try {
      const r = await post('/api/app/purchases/refund', { purchase: p.id });
      toast(`${num(r.coins)} jeton, ${num(r.diamonds)} elmas geri alındı${r.unrecoveredDiamonds ? ` (${num(r.unrecoveredDiamonds)} elmas çekildiği için alınamadı)` : ''}`);
      list.reload();
    } catch (e) {
      showError(e);
    }
  };
  const sync = async () => {
    if (!confirm('Google Play’de son 30 günde iade edilen alımlar okunur. Bulunanların jetonları ve kilitli elmasları hemen geri alınır.')) return;
    try {
      const r = await post('/api/app/purchases/voided-sync', {});
      toast(`${num(r.checked)} iade okundu, ${num(r.refunded)} alım geri alındı${r.unknown ? `, ${num(r.unknown)} tanınmadı` : ''}`);
      list.reload();
    } catch (e) {
      showError(e);
    }
  };
  return html`<${Page} title="İadeler ve cüzdan" subtitle="Mağaza alımlarının iadesi (jetonlar ve kilitli elmaslar geri alınır) ve bir hesabın cüzdan dökümü (itirazlar için).">
    <${Tabs} tabs=${[['purchases', 'Mağaza alımları'], ['wallet', 'Cüzdan denetimi']]} value=${tab} onChange=${setTab} />
    ${tab === 'purchases' && html`
      <form class="row gap" style="margin:10px 0" onSubmit=${(e) => (e.preventDefault(), setSearch(text.trim()))}>
        <input value=${text} onInput=${(e) => setText(e.target.value)} placeholder="Alım no, mağaza sipariş no ya da kişinin ID’si" title=${ID_HINT} style="min-width:320px" />
        <button class="btn" type="submit">Ara</button>
        ${search && html`<${Button} kind="ghost" onClick=${() => (setText(''), setSearch(''))}>Temizle</${Button}>`}
      </form>
      <${Loading} state=${list}>${(d) => html`
        <${Card} title="Google Play iadeleri" actions=${can('app.refunds') && d.googleSync.enabled && html`<${Button} onClick=${sync}>Şimdi kontrol et</${Button}>`}>
          <p class="muted">${d.googleSync.enabled ? `Her ${d.googleSync.everyMin} dakikada bir kendiliğinden okunur. Son başarılı okuma: ${d.googleSync.lastOkAt ? dateTimeTr(d.googleSync.lastOkAt) : 'yok'}.` : 'Google Play bağlantısı ayarlı değil.'}${d.googleSync.lastError ? html` <span class="badge bad">${d.googleSync.lastError}</span>` : ''}</p>
        </${Card}>
        <${Table}
          empty=${search ? 'Bu aramayla alım bulunamadı' : 'Henüz alım yok'}
          columns=${[
            { key: 'createdAt', label: 'Tarih', render: (p) => html`${dateTimeTr(p.createdAt)}<br /><small class="muted">#${p.id}</small>` },
            { key: 'user', label: 'Hesap', render: (p) => html`${p.user.name}<br /><small class="muted num">${p.user.publicNo ? `ID ${p.user.publicNo}` : '—'}</small>` },
            { key: 'productId', label: 'Ürün', render: (p) => html`${p.productId}<br /><small class="muted">${p.platform}${p.sandbox ? ' · test' : ''} · ${p.transactionId}</small>` },
            { key: 'coins', label: 'Jeton', align: 'right', render: (p) => `${num(p.coins)}${p.bonus ? ` + ${num(p.bonus)}` : ''}` },
            { key: 'priceTl', label: 'Fiyat', align: 'right', render: (p) => (p.priceTl === null ? '—' : `${num(p.priceTl, 2)} TL`) },
            { key: 'status', label: 'Durum', render: PURCHASE },
            { key: 'a', label: '', render: (p) => p.status === 'credited' && can('app.refunds') && html`<${Button} kind="danger" onClick=${() => refund(p)}>İade et</${Button}>` },
          ]}
          rows=${d.purchases}
        />`}</${Loading}>`}
    ${tab === 'wallet' && html`
      <form class="row gap" style="margin:10px 0" onSubmit=${showWallet}>
        <input value=${who} onInput=${(e) => setWho(e.target.value)} placeholder="Kişinin ID’si" title=${ID_HINT} style="min-width:360px" />
        <button class="btn" type="submit">Göster</button>
      </form>
      ${user && html`<${Loading} state=${audit}>${(a) => html`
        <div class="kpis">
          <${Kpi} label="Hesap" value=${a.user.name} sub=${a.user.publicNo ? `ID ${a.user.publicNo}` : '—'} />
          <${Kpi} label="Jeton" value=${num(a.user.coins)} sub=${`partilerde ${num(a.user.coinsInLots)}`} />
          <${Kpi} label="Elmas" value=${num(a.user.diamonds)} sub=${`çekilebilir ${num(a.user.withdrawable)} · kilitli ${num(a.user.locked)}`} />
        </div>
        <${Card} title="Mağaza alımları"><${Table} dense empty="Alım yok" columns=${[
          { key: 'created_at', label: 'Tarih', render: (p) => dateTimeTr(p.created_at) },
          { key: 'product_id', label: 'Ürün', render: (p) => `${p.product_id} (${p.platform})` },
          { key: 'coins', label: 'Jeton', align: 'right', render: (p) => `${num(p.coins)}${p.bonus ? ` + ${num(p.bonus)}` : ''}` },
          { key: 'status', label: 'Durum', render: PURCHASE },
        ]} rows=${a.purchases} /></${Card}>
        <${Card} title="Hareketler (son)"><${Table} dense empty="Hareket yok" columns=${[
          { key: 'created_at', label: 'Tarih', render: (l) => dateTimeTr(l.created_at) },
          { key: 'currency', label: 'Birim', render: (l) => ({ coin: 'Jeton', diamond: 'Elmas', game: 'Oyun jetonu' })[l.currency] ?? l.currency },
          { key: 'amount', label: 'Tutar', align: 'right', render: (l) => num(l.amount) },
          { key: 'balance', label: 'Bakiye', align: 'right', render: (l) => num(l.balance) },
          { key: 'reason', label: 'Neden' },
        ]} rows=${a.ledger} /></${Card}>`}</${Loading}>`}`}
  </${Page}>`;
}

// ---- Canlı ayarlar --------------------------------------------------------------------------------------
/** A setting's value as people read it. */
function shown(s, v) {
  // Text in effect that is empty or null: no notice, Yönetim in the app.
  if (s.type === 'text' && (v === null || v === undefined || v === '')) return 'Boş';
  if (v === null || v === undefined) return s.type === 'campaign' ? 'Kampanya yok' : 'Varsayılan';
  if (s.type === 'set') return v.length ? v.map((x) => s.bounds.labels?.[x] ?? x).join(', ') : 'Hiçbiri';
  if (s.type === 'campaign') return `%${v.percent} · ${v.label} · ${dateTimeTr(v.startsAt)} → ${dateTimeTr(v.endsAt)}`;
  if (s.type === 'int' || s.type === 'number') return num(v, s.bounds.decimals ?? 0);
  if (s.type === 'packs') return packsText(s, v);
  if (s.type === 'tiers') return tiersText(v);
  return String(v);
}
/** Yayıncı haftalık bonusu: on or off, and its tiers ("10.000 → 5.000 · 20.000 → 10.000 …"). */
function tiersText(v) {
  if (!v?.tiers?.length) return 'Barem yok';
  return `${v.on ? 'Açık' : 'Kapalı'} · ${v.tiers.length} barem: ${v.tiers.map((t) => `${num(t.from)} → ${num(t.bonus)}`).join(' · ')}`;
}
/** Jeton paketleri in their order: each pack's coins, its extra coins and its first-purchase gift. */
function packsText(s, v) {
  const rows = packRows(s, v);
  return rows.map((p) => `${num(p.coins)}${p.extra ? ` +${num(p.extra)}` : ''}${p.first ? ` (ilk +${num(p.first)})` : ''}`).join(' · ');
}
/** The packs as set up (or the app's own values), in their order. */
function packRows(s, v) {
  return s.bounds.packs
    .map((p, i) => ({ id: p.id, coins: p.coins, tl: p.tl, label: p.label, extra: v?.[p.id]?.extra ?? 0, first: v?.[p.id]?.first ?? p.firstBonus, own: v?.[p.id]?.first ?? null, order: v?.[p.id]?.order ?? i + 1, i }))
    .sort((a, b) => a.order - b.order || a.i - b.i);
}

/** A saved value in the history: null is the default. */
function saved(v) {
  if (v === null || v === undefined) return 'varsayılan';
  if (v === '') return 'boş';
  if (typeof v === 'number') return num(v, Number.isInteger(v) ? 0 : 2);
  if (Array.isArray(v)) return v.length ? v.join(', ') : 'hiçbiri';
  if (typeof v === 'object' && Array.isArray(v.tiers)) return `${v.on ? 'açık' : 'kapalı'}, ${v.tiers.length} barem`;
  if (typeof v === 'object') return v.percent !== undefined ? `%${v.percent} · ${v.label}` : Object.values(v)[0]?.order !== undefined ? 'jeton paketleri ayarı' : JSON.stringify(v);
  return String(v);
}

/**
 * Canlı ayarlar by subject (owners, 24 Nov 2026: one long page was too much): each subject a page of its own in the
 * menu, with the app's setting groups under it. A group the list doesn't name yet (a new one from the app) shows
 * under "Diğer", so nothing is ever hidden. [key, name, icon, groups, what it is about].
 */
export const SETTING_SECTIONS = [
  ['para', 'Para ve kur', '💱', ['Jeton değeri', 'Çevirme kuru', 'Ödemeler', 'Para çekme sınırları', 'Jeton Noktası', 'VIP'], 'Jeton değeri, kurlar, elmas değeri, ödemeler, yayıncı bonusu, çekim sınırları, VIP koruma dönemi'],
  ['magaza', 'Mağaza ve paketler', '🛍️', ['Hediyeler ve paketler', 'Kampanya', 'Yeni üye ödülleri', 'Çantam', 'Özel albüm'], 'Jeton paketleri, gizli hediye ve ürünler, kampanya, hoş geldin ve davet ödülleri, özel albüm'],
  ['gorusme', 'Görüşme ve mesaj', '💬', ['Birebir ve eşleşme', 'Otomatik mesaj', 'SimilarClub Sistem'], 'Mesaj ve arama fiyatları, eşleşme, kalp seviyeleri, otomatik mesaj, sistem bildirimleri'],
  ['odalar', 'Odalar ve etkinlikler', '🎙️', ['Odalar', 'Oda seviyeleri', 'Oda süslemesi', 'Etkinlikler'], 'Oda seviyeleri ve sınırları, patron koltuğu, oda süslemesi, etkinlik kuralları'],
  ['aile', 'Aile ve bağlar', '👪', ['Aile', 'Aile görevleri', 'Aile sandıkları', 'Bağlar', 'Koruma'], 'Aile kuralları, görev puanları, sandıklar, temalar, bağlar ve koruma'],
  ['oyun', 'Oyun ve şanslı hediyeler', '🎲', ['Oyun Salonu', 'Şanslı çanta', 'Kazanç duyurusu', 'Global hediye'], 'Oyun Salonu, şanslı çanta, kazanç ve global hediye duyuruları'],
  ['profil', 'Profil', '🪪', ['Profil rozetleri', 'Profil izleri'], 'Madalya ve unvan kuralları, profil izlerinin süresi'],
  ['sistem', 'Sistem ve güvenlik', '🛡️', ['Acil durum', 'Zorunlu sürüm', 'SMS', 'Yönetim'], 'Acil durum anahtarları ve duyuru, zorunlu sürüm, SMS sınırı, yönetim sitesi'],
];
const NAMED = new Set(SETTING_SECTIONS.flatMap(([, , , g]) => g));
/** The groups of section `key` that the app has, in the list's order; 'diger': the ones no section names. */
const groupsOf = (key, all) => (key === 'diger' ? all.filter((g) => !NAMED.has(g)) : (SETTING_SECTIONS.find(([k]) => k === key)?.[3] ?? []).filter((g) => all.includes(g)));
const sectionOfGroup = (g) => SETTING_SECTIONS.find(([, , , gs]) => gs.includes(g)) ?? ['diger', 'Diğer', '📁'];
const searchText = (v) => String(v ?? '').toLocaleLowerCase('tr-TR');

/**
 * Canlı ayarlar. `section`: a subject's page (its groups); 'gecmis': the history; none: the overview (search over
 * every setting, the subjects with their counts, the latest changes).
 */
export function AppSettings({ section = null }) {
  const { can } = useApp();
  const data = useApi('/api/app/live-settings');
  const history = useApi(section === 'gecmis' || !section ? `/api/app/live-settings/history?limit=${section ? 30 : 5}` : null);
  const [edit, setEdit] = useState(null);
  const [q, setQ] = useState('');
  const [ask, prompt] = usePrompt();
  const all = data.data ? [...new Set(data.data.settings.map((s) => s.group))] : [];
  /** A save or a rollback: a preview first; a big change needs a second yes. */
  const apply = async (path, body) => {
    try {
      const pre = await post(path, { ...body, dryRun: true });
      const lines = pre.preview.map((p) => `• ${p.label}: ${p.impact}`).join('\n');
      if (!confirm(`${pre.needsConfirm ? 'DİKKAT: büyük değişiklik.\n\n' : ''}${lines}\n\nKaydedilsin mi?`)) return false;
      await post(path, { ...body, confirm: pre.needsConfirm });
      toast('Kaydedildi; uygulama birkaç saniyede yeni değeri kullanır');
      data.reload();
      history.reload();
      return true;
    } catch (e) {
      if (e.status === 409) data.reload();
      showError(e);
      return false;
    }
  };
  const rollback = async (b) => {
    const v = await ask('Bu değişikliği geri al', { text: 'Her ayar bu değişiklikten hemen önceki değerine döner (önce önizlenir).', label: 'Neden', ok: 'Önizle' });
    if (v) apply('/api/app/live-settings/rollback', { batch: b.batch, reason: v.reason, baseV: data.data.v });
  };
  const sec = SETTING_SECTIONS.find(([k]) => k === section);
  const title = section === 'gecmis' ? 'Canlı ayarlar · Geçmiş' : section === 'diger' ? 'Canlı ayarlar · Diğer' : sec ? `Canlı ayarlar · ${sec[1]}` : 'Canlı ayarlar';
  const subtitle = sec
    ? `${sec[4]}. Her kayıt önce önizlenir, nedenle yazılır, uygulamadaki yöneticilere bildirilir ve Geçmiş'ten geri alınabilir.`
    : section === 'gecmis'
      ? 'Son 30 değişiklik: kim, ne zaman, neden, önce ve sonra. Bir değişikliği geri almak önce önizlenir.'
      : 'Uygulamanın kurulum gerektirmeden değişen ayarları, konularına göre. Bir ayarı aramak için yazın ya da bir konuyu açın.';
  /** One group's table (a card). */
  const groupCard = (d, g, rows = d.settings.filter((s) => s.group === g)) => html`<${Card} title=${g}><${Table} dense columns=${[
    // Long help and reasons wrap, so "Şu an" and Değiştir stay on screen.
    { key: 'label', label: 'Ayar', render: (s) => html`<div style="white-space:normal;min-width:280px;max-width:560px"><strong>${s.label}</strong><br /><small class="muted">${s.help}</small></div>` },
    { key: 'effective', label: 'Şu an', render: (s) => html`<div style="white-space:normal;max-width:380px">${shown(s, s.effective)}${s.invalid ? html` <span class="badge bad">kayıt geçersiz, varsayılan kullanılıyor</span>` : ''}</div>` },
    { key: 'changedAt', label: 'Son değişiklik', render: (s) => (s.changedAt ? html`<div style="white-space:normal;max-width:260px">${dateTimeTr(s.changedAt)}<br /><small class="muted">${s.changedBy?.name ?? ''}${s.reason ? ` · ${s.reason}` : ''}</small></div>` : html`<span class="muted">varsayılan</span>`) },
    { key: 'a', label: '', render: (s) => can('app.settings') && !d.safeMode && html`<${Button} onClick=${() => setEdit(s)}>Değiştir</${Button}>` },
  ]} rows=${rows} /></${Card}>`;
  const historyTable = (h) => html`<${Table} empty="Kayıt yok" columns=${[
    { key: 'at', label: 'Zaman', render: (b) => html`${dateTimeTr(b.at)}<br /><small class="muted">${b.by?.name ?? ''}</small>` },
    { key: 'reason', label: 'Neden', render: (b) => html`${b.reason}${b.rollbackOf ? html` <span class="badge">geri alma</span>` : ''}` },
    { key: 'changes', label: 'Değişiklikler', render: (b) => b.changes.map((c) => html`<div>${c.label}: ${saved(c.before)} → ${saved(c.after)}</div>`) },
    { key: 'a', label: '', render: (b) => can('app.settings') && html`<${Button} onClick=${() => rollback(b)}>Geri al</${Button}>` },
  ]} rows=${h.batches} />`;
  const words = searchText(q).split(/\s+/).filter(Boolean);
  const hit = (s) => words.every((w) => searchText(`${s.label} ${s.help} ${s.group} ${s.key}`).includes(w));
  return html`<${Page} title=${title} subtitle=${subtitle}>
    ${prompt}
    ${section === 'gecmis'
      ? html`<${Loading} state=${history}>${historyTable}</${Loading}>`
      : html`<${Loading} state=${data}>${(d) => html`
      ${d.safeMode && html`<p class="note bad">Uygulamanın sunucusu güvenli modda (LIVE_SAFE_MODE): kayıtlı ayarlar kullanılmıyor ve kaydedilemez.</p>`}
      ${section
        ? html`
          ${groupsOf(section, all).length > 1 && html`<div class="row gap wrap" style="margin-bottom:10px">${groupsOf(section, all).map((g) => html`<a class="chip" href=${`#/${location.hash.replace(/^#\/?/, '').split('?')[0]}`} onClick=${(e) => (e.preventDefault(), document.getElementById(`grp-${g}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))}>${g} <small class="muted">${d.settings.filter((s) => s.group === g).length}</small></a>`)}</div>`}
          ${groupsOf(section, all).map((g) => html`<div id=${`grp-${g}`}>${groupCard(d, g)}</div>`)}
          ${!groupsOf(section, all).length && html`<p class="muted">Bu konuda ayar yok.</p>`}`
        : html`
          <input type="search" placeholder="Ayarlarda ara: ör. kur, bonus, mikrofon, kampanya" value=${q} onInput=${(e) => setQ(e.target.value)} style="width:100%;max-width:560px;margin-bottom:14px" aria-label="Ayarlarda ara" />
          ${words.length
            ? (() => {
                const found = d.settings.filter(hit);
                const by = [...new Set(found.map((s) => s.group))];
                return found.length ? by.map((g) => groupCard(d, `${sectionOfGroup(g)[1]} › ${g}`, found.filter((s) => s.group === g))) : html`<p class="muted">"${q}" ile eşleşen ayar yok.</p>`;
              })()
            : html`
              <div class="kpis">
                ${[...SETTING_SECTIONS, ...(groupsOf('diger', all).length ? [['diger', 'Diğer', '📁', groupsOf('diger', all), 'Henüz bir konuya yerleşmemiş ayarlar']] : [])].map(([k, name, icon, , about]) => {
                  const gs = groupsOf(k, all);
                  const n = d.settings.filter((s) => gs.includes(s.group)).length;
                  const changed = d.settings.filter((s) => gs.includes(s.group) && s.changedAt).length;
                  return html`<a class="kpi" href=${`#/app-settings-${k}`} style="text-decoration:none;color:inherit">
                    <span class="kpi-l">${icon} ${name}</span>
                    <strong class="kpi-v num">${num(n)} ayar</strong>
                    <small class="muted">${changed ? `${num(changed)} değiştirildi · ` : ''}${about}</small>
                  </a>`;
                })}
              </div>
              <${Card} title="Son değişiklikler" actions=${html`<a href="#/app-settings-gecmis">Tüm geçmiş</a>`}><${Loading} state=${history}>${historyTable}</${Loading}></${Card}>`}`}`}</${Loading}>`}
    ${edit && data.data && html`<${SettingEditor} s=${edit} onClose=${() => setEdit(null)} onSave=${async (value, reason) => (await apply('/api/app/live-settings', { changes: { [edit.key]: value }, reason, baseV: data.data.v })) && setEdit(null)} />`}
  </${Page}>`;
}

const local = (iso) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '');
function SettingEditor({ s, onClose, onSave }) {
  const start = s.value ?? s.effective;
  // Jeton paketleri: one row per pack, in its order (moved with ↑ ↓).
  const [packs, setPacks] = useState(() => (s.type === 'packs' ? packRows(s, start).map((p) => ({ ...p, extra: String(p.extra), first: String(p.first) })) : []));
  const movePack = (i, d) => setPacks((l) => {
    const n = [...l];
    [n[i], n[i + d]] = [n[i + d], n[i]];
    return n;
  });
  const setPack = (i, k, x) => setPacks((l) => l.map((p, j) => (j === i ? { ...p, [k]: x } : p)));
  // Yayıncı haftalık bonusu: on or off, and one row per tier (from this many diamonds earned, this bonus).
  const [tiersOn, setTiersOn] = useState(() => (s.type === 'tiers' ? start?.on !== false : true));
  const [tiers, setTiers] = useState(() => (s.type === 'tiers' ? (start?.tiers ?? []).map((t) => ({ from: num(t.from), bonus: num(t.bonus) })) : []));
  const setTier = (i, k, x) => setTiers((l) => l.map((t, j) => (j === i ? { ...t, [k]: x } : t)));
  const whole = (x) => Number(String(x).replace(/[^\d]/g, '') || 0);
  const [v, setV] = useState(s.type === 'campaign' ? (start ? { ...start, startsAt: local(start.startsAt), endsAt: local(start.endsAt) } : { percent: s.bounds.percent.min, startsAt: '', endsAt: '', label: '' }) : start ?? (s.type === 'set' ? [] : ''));
  const [reason, setReason] = useState('');
  const b = s.bounds ?? {};
  const value = () => {
    // Whole numbers may be typed with thousands dots (25.000); a rate with a decimal comma (42,50).
    if (s.type === 'int') return Number(String(v).replace(/[^\d-]/g, ''));
    if (s.type === 'number') return Number(String(v).replace(/\s/g, '').replace(',', '.'));
    if (s.type === 'campaign') return { percent: Number(v.percent), startsAt: v.startsAt ? new Date(v.startsAt).toISOString() : '', endsAt: v.endsAt ? new Date(v.endsAt).toISOString() : '', label: v.label };
    // Empty text is a value of its own (no notice; Yönetim back in the app); "Varsayılana dön" is the default.
    if (s.type === 'text') return String(v).trim();
    if (s.type === 'version') return String(v).trim() || null;
    if (s.type === 'tiers') return { on: tiersOn, tiers: tiers.map((t) => ({ from: whole(t.from), bonus: whole(t.bonus) })) };
    if (s.type === 'packs') {
      return Object.fromEntries(packs.map((p, i) => [p.id, { extra: whole(p.extra), first: whole(p.first) === (s.bounds.packs.find((x) => x.id === p.id)?.firstBonus ?? 0) ? null : whole(p.first), order: i + 1 }]));
    }
    return v;
  };
  let input;
  if (s.type === 'set')
    input = html`<div class="stack">${b.options.map((o) => html`<label class="field inline"><span>${b.labels?.[o] ?? o}</span><input type="checkbox" checked=${v.includes(o)} onChange=${(e) => setV(e.target.checked ? [...v, o] : v.filter((x) => x !== o))} /></label>`)}</div>`;
  else if (s.type === 'campaign')
    input = html`<div class="form"><div class="grid2">
      <label class="field"><span>Ek jeton yüzdesi</span><input type="number" min=${b.percent.min} max=${b.percent.max} step=${b.percent.step} value=${v.percent} onInput=${(e) => setV({ ...v, percent: e.target.value })} /></label>
      <label class="field"><span>Adı (pakette görünür)</span><input value=${v.label} maxlength=${b.label.max} onInput=${(e) => setV({ ...v, label: e.target.value })} /></label>
      <label class="field"><span>Başlangıç</span><input type="datetime-local" value=${v.startsAt} onInput=${(e) => setV({ ...v, startsAt: e.target.value })} /></label>
      <label class="field"><span>Bitiş</span><input type="datetime-local" value=${v.endsAt} onInput=${(e) => setV({ ...v, endsAt: e.target.value })} /></label>
    </div></div>`;
  else if (s.type === 'packs')
    input = html`<table class="table dense"><thead><tr><th>Sıra</th><th>Paket</th><th>Ek jeton (her alımda)</th><th>İlk alım hediyesi</th><th>Bir alımda toplam</th></tr></thead><tbody>
      ${packs.map(
        (p, i) => html`<tr key=${p.id}>
          <td class="nowrap">${i + 1}. <button type="button" class="btn link" disabled=${i === 0} onClick=${() => movePack(i, -1)} aria-label="Yukarı">↑</button><button type="button" class="btn link" disabled=${i === packs.length - 1} onClick=${() => movePack(i, 1)} aria-label="Aşağı">↓</button></td>
          <td><strong>${num(p.coins)} jeton</strong><br /><small class="muted">${num(p.tl, 2)} TL (Google Play fiyatı)</small></td>
          <td><input inputmode="numeric" style="width:110px" value=${p.extra} onInput=${(e) => setPack(i, 'extra', e.target.value)} /></td>
          <td><input inputmode="numeric" style="width:110px" value=${p.first} onInput=${(e) => setPack(i, 'first', e.target.value)} /></td>
          <td class="num">${num(p.coins + Number(String(p.extra).replace(/[^\d]/g, '') || 0))}${Number(String(p.first).replace(/[^\d]/g, '') || 0) ? html`<br /><small class="muted">ilk alımda +${num(Number(String(p.first).replace(/[^\d]/g, '')))}</small>` : ''}</td>
        </tr>`,
      )}
    </tbody></table>
    <p class="note">Paketin kendi jetonu ve fiyatı Google Play'deki ürüne bağlı, burada değişmez. Ek jeton ve ilk alım hediyesi en çok paketin kendi jetonu kadar olabilir. Gizlemek için "Gizli paketler" ayarını kullanın.</p>`;
  else if (s.type === 'tiers')
    input = html`<label class="field inline"><span>Bonus açık (kapalıyken biten hafta ödenmez; Yayıncı haftalık bonusu sayfasından sonradan ödenebilir)</span><input type="checkbox" checked=${tiersOn} onChange=${(e) => setTiersOn(e.target.checked)} /></label>
    <table class="table dense"><thead><tr><th>#</th><th>Haftalık kazanç (elmas, en az)</th><th>Bonus (elmas)</th><th>Aralık</th><th></th></tr></thead><tbody>
      ${tiers.map(
        (t, i) => html`<tr key=${i}>
          <td>${i + 1}</td>
          <td><input inputmode="numeric" style="width:130px" value=${t.from} onInput=${(e) => setTier(i, 'from', e.target.value)} /></td>
          <td><input inputmode="numeric" style="width:130px" value=${t.bonus} onInput=${(e) => setTier(i, 'bonus', e.target.value)} /></td>
          <td class="muted nowrap">${num(whole(t.from))}${i + 1 < tiers.length ? ` – ${num(Math.max(0, whole(tiers[i + 1].from) - 1))}` : ' ve üstü'}</td>
          <td><button type="button" class="btn link" disabled=${tiers.length <= 1} onClick=${() => setTiers((l) => l.filter((_, j) => j !== i))}>Sil</button></td>
        </tr>`,
      )}
    </tbody></table>
    <div class="row gap"><${Button} disabled=${tiers.length >= (b.maxTiers ?? 30)} onClick=${() => setTiers((l) => [...l, { from: '', bonus: '' }])}>Barem ekle</${Button}></div>
    <p class="note">Ajansa bağlı yayıncı ve yönetim yayıncısı, haftada (Pazartesi 00:00 – Pazar 23:59:59) ulaştığı en yüksek baremin bonusunu alır; ilk baremin altında bonus yok. Baremler küçükten büyüğe, bonus bir öncekinden az olamaz. Değişiklik, kapanmamış haftaya (bu haftaya) uygulanır.</p>`;
  else if (s.type === 'text') input = html`<textarea rows="3" maxlength=${b.max} value=${v ?? ''} onInput=${(e) => setV(e.target.value)}></textarea>`;
  else input = html`<input value=${v ?? ''} inputmode=${s.type === 'version' ? 'text' : 'decimal'} onInput=${(e) => setV(e.target.value)} />`;
  const range = s.type === 'int' || s.type === 'number' ? `${num(b.min, b.decimals ?? 0)}–${num(b.max, b.decimals ?? 0)}${b.step ? `, ${num(b.step, b.decimals ?? 0)}'er` : ''}` : '';
  return html`<${Modal} title=${s.label} onClose=${onClose}>
    <p class="muted">${s.help}</p>
    <p>Şu an: <strong>${shown(s, s.effective)}</strong>${range ? html` · <span class="muted">aralık ${range}</span>` : ''}</p>
    ${input}
    <label class="field" style="margin-top:10px"><span>Neden (3–300 karakter, kayda ve bildirime yazılır) *</span><input value=${reason} maxlength="300" onInput=${(e) => setReason(e.target.value)} /></label>
    <div class="row end gap" style="margin-top:12px">
      <${Button} onClick=${onClose}>Vazgeç</${Button}>
      ${s.value !== null && html`<${Button} onClick=${() => (reason.trim().length >= 3 ? onSave(null, reason.trim()) : showError(new Error('Neden yazın')))}>Varsayılana dön</${Button}>`}
      <${Button} kind="primary" onClick=${() => (reason.trim().length >= 3 ? onSave(value(), reason.trim()) : showError(new Error('Neden yazın')))}>Önizle ve kaydet</${Button}>
    </div>
  </${Modal}>`;
}

// ---- Raporlar ve durum ----------------------------------------------------------------------------------
const PERIOD_LABEL = { today: 'Bugün', week: 'Son 7 gün', month: 'Son 30 gün', kept: 'Kayıtlı süre (180 gün)' };
export function AppReports() {
  const [tab, setTab] = useState('casino');
  const casino = useApi(tab === 'casino' ? '/api/app/casino/report' : null);
  const alerts = useApi(tab === 'status' ? '/api/app/alerts' : null);
  const sync = useApi(tab === 'status' ? '/api/app/finance-sync' : null);
  const [period, setPeriod] = useState('week');
  return html`<${Page} title="Uygulama raporları" subtitle="Oyun Salonu'nun kasası ve oyunları; uygulama sunucusunun uyarıları ve bu panele veri gönderimi.">
    <${Tabs} tabs=${[['casino', 'Oyun Salonu'], ['status', 'Sunucu durumu']]} value=${tab} onChange=${setTab} />
    ${tab === 'casino' && html`<${Loading} state=${casino}>${(c) => {
      const names = Object.fromEntries(Object.values(c.periods).flatMap((p) => p.games.map((g) => [g.id, g.name])));
      return html`
      <div class="kpis">
        <${Kpi} label="Oynanan (başlangıçtan)" value=${num(c.book.wagered)} sub="oyun jetonu" />
        <${Kpi} label="Kasanın payı (%60)" value=${num(c.book.house)} />
        <${Kpi} label="Ödül havuzu" value=${num(c.book.pool)} sub=${`açılış avansı ${num(c.book.seed)}`} />
        <${Kpi} label="Ödenen kazanç" value=${num(c.book.paid)} />
        ${Object.entries(c.jackpots ?? {}).map(([g, f]) => html`<${Kpi} label=${`Jackpot · ${names[g] ?? g}`} value=${num(f)} />`)}
      </div>
      <${Tabs} tabs=${Object.keys(c.periods).map((k) => [k, PERIOD_LABEL[k] ?? k])} value=${period} onChange=${setPeriod} />
      ${c.periods[period] && html`<${Table} columns=${[
        { key: 'name', label: 'Oyun' },
        { key: 'rounds', label: 'Tur', align: 'right', render: (g) => num(g.rounds) },
        { key: 'players', label: 'Oyuncu', align: 'right', render: (g) => num(g.players) },
        { key: 'wagered', label: 'Oynanan', align: 'right', render: (g) => num(g.wagered) },
        { key: 'paid', label: 'Ödenen', align: 'right', render: (g) => num(g.paid) },
        { key: 'house', label: 'Kasa payı', align: 'right', render: (g) => num(g.house) },
      ]} rows=${[...c.periods[period].games, { name: 'Toplam', rounds: c.periods[period].rounds, players: null, wagered: c.periods[period].wagered, paid: c.periods[period].paid, house: c.periods[period].house }]} />`}`;
    }}</${Loading}>`}
    ${tab === 'status' && html`
      <${Card} title="Uyarılar"><${Loading} state=${alerts}>${(a) => html`<${Table} empty="Uyarı yok" columns=${[
        { key: 'code', label: 'Kod' },
        { key: 'message', label: 'Açıklama' },
        { key: 'value', label: 'Değer', render: (w) => JSON.stringify(w.value) },
        { key: 'threshold', label: 'Eşik', render: (w) => JSON.stringify(w.threshold) },
      ]} rows=${a.warnings} />`}</${Loading}></${Card}>
      <${Card} title="Bu panele veri gönderimi"><${Loading} state=${sync}>${(s) => html`<div class="kpis">
        <${Kpi} label="Durum" value=${s.enabled ? 'Açık' : 'Kapalı'} />
        <${Kpi} label="Geride kalan kayıt" value=${num(s.behind)} sub=${`son gönderilen #${num(s.lastId)}`} />
        <${Kpi} label="Son başarılı tur" value=${s.lastOkAt ? dateTimeTr(s.lastOkAt) : '—'} />
        <${Kpi} label="Bekleyen ret" value=${num(s.failed)} sub=${s.lastError ?? ''} />
      </div>`}</${Loading}></${Card}>`}
  </${Page}>`;
}
