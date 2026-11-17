// Uygulama › finance pages: the Similar Club app's own money work, through its admin API (server/app-admin.ts passes
// each call on as the signed-in panel user; the app checks and records every one). Para çekme and Ajans ödemeleri
// never send money: the money goes from the bank, the page records it. İadeler takes back a store purchase's coins;
// Şanslı hediyeler and Canlı ayarlar change what the app does at once, for everyone.
import { Badge, Button, Card, ID_HINT, Kpi, Loading, Modal, Page, Table, Tabs, act, dateTimeTr, html, num, personOf, post, showError, toast, useApi, useApp, usePrompt, useState } from '../lib.js';

const usd = (n) => `$${num(n, 2)}`;
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
  const paid = async (w) => {
    const to = w.method === 'iban' ? 'bu IBAN’a' : 'bu hesaba';
    if (!confirm(`Bu düğme para göndermez. Önce ${usd(w.usd)} tutarını bankanızdan ${w.holder} adına ${to} gönderin:\n\n${w.account}\n\nGönderdiyseniz devam edin; ${w.user.name} ödemenin yapıldığını görür.`)) return;
    done(list, 'Ödendi olarak işaretlendi')(await act(() => post('/api/app/withdrawals/decide', { id: w.id, approve: true, note: '' })));
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
          { key: 'user', label: 'Kişi', render: (w) => html`${w.user.name}<br /><small class="muted">${w.user.phone ?? w.user.id}</small>` },
          { key: 'diamonds', label: 'Elmas', align: 'right', render: (w) => num(w.diamonds) },
          { key: 'usd', label: 'Tutar', align: 'right', render: (w) => usd(w.usd) },
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
  const pay = async (p) => {
    const v = await ask('Ödendi olarak işaretle', {
      text: `Bu düğme para göndermez. Önce ${usd(p.usd)} tutarını ${p.agency.name} ajansına bankadan gönderin, sonra havale dekontundaki numarayı yazın. Ajans ödemenin yapıldığını görür.`,
      fields: [{ name: 'paymentRef', label: 'Dekont numarası', required: true, wide: true }],
      ok: 'Gönderdim, işaretle',
    });
    if (v) decide(p, 'pay', { paymentRef: v.paymentRef }, 'Ödendi olarak işaretlendi');
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
            { key: 'user', label: 'Hesap', render: (p) => html`${p.user.name}<br /><small class="muted">${p.user.id}</small>` },
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
          <${Kpi} label="Hesap" value=${a.user.name} sub=${a.user.publicNo ? `ID ${a.user.publicNo}` : a.user.id} />
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

// ---- Şanslı hediyeler -----------------------------------------------------------------------------------
const MULTS = [2, 5, 10, 20, 50, 100, 200, 500, 1000];
const TOTAL = 100_000;
/** What a package pays back on average for each coin spent: Σ multiplier × chance. */
const rtp = (g) => g.tiers.reduce((s, t) => s + t.mult * t.weight, 0) / TOTAL;
const top = (g) => Math.max(0, ...g.tiers.filter((t) => t.weight > 0).map((t) => t.mult));

export function AppLucky() {
  const { can } = useApp();
  const data = useApi('/api/app/lucky');
  const [edit, setEdit] = useState(null);
  return html`<${Page}
    title="Şanslı hediyeler"
    subtitle="Uygulamadaki Şanslı hediye paketleri: fiyat, olasılık tablosu (toplam %100), günlük ödül limiti ve duyuru çarpanı. Kayıt anında herkes için geçer; ödülü uygulamanın sunucusu çeker. Alıcı her gönderimde fiyatın %20'sini elmas olarak alır."
    actions=${can('app.lucky') && data.data && html`<${Button} kind="primary" onClick=${() => setEdit(structuredClone(data.data.config))}>Düzenle</${Button}>`}
  >
    <${Loading} state=${data}>${(d) => html`
      <div class="kpis">
        ${[['Bugün', d.stats.today], ['Toplam', d.stats.total]].map(([l, s]) => html`
          <${Kpi} label=${`${l}: gönderim`} value=${num(s.sends)} />
          <${Kpi} label=${`${l}: harcanan jeton`} value=${num(s.spent)} />
          <${Kpi} label=${`${l}: ödenen oyun jetonu`} value=${num(s.paid)} sub=${s.spent ? `geri ödeme %${num((s.paid / s.spent) * 100, 1)}` : ''} />
          <${Kpi} label=${`${l}: alıcılara elmas`} value=${num(s.shared)} />`)}
      </div>
      <${Card} title=${`Paketler (sürüm ${d.version}${d.updatedAt ? ` · ${dateTimeTr(d.updatedAt)}` : ''})`}>
        <p class="muted">Günlük ödül limiti ${num(d.config.dailyPayoutLimit)} oyun jetonu · ${d.config.announceFrom}x ve üstü odada duyurulur.</p>
        <${Table} dense columns=${[
          { key: 'name', label: 'Paket', render: (g) => `${g.emoji} ${g.name} (${g.id})` },
          { key: 'price', label: 'Fiyat', align: 'right', render: (g) => num(g.price) },
          { key: 'enabled', label: 'Durum', render: (g) => html`<${Badge} s=${g.enabled ? 'active' : 'passive'} label=${g.enabled ? 'Açık' : 'Kapalı'} />` },
          { key: 'tiers', label: 'Olasılıklar', render: (g) => g.tiers.filter((t) => t.weight > 0).map((t) => `${t.mult ? `${t.mult}x` : 'ödülsüz'} %${num(t.weight / 1000, 3)}`).join(' · ') },
          { key: 'rtp', label: 'Ortalama geri ödeme', align: 'right', render: (g) => `%${num(rtp(g) * 100, 2)}` },
          { key: 'top', label: 'En yüksek', align: 'right', render: (g) => `${top(g)}x` },
        ]} rows=${d.config.gifts} />
      </${Card}>
      <${Card} title="Son gönderimler"><${Table} dense empty="Gönderim yok" columns=${[
        { key: 'at', label: 'Zaman', render: (s) => dateTimeTr(s.at) },
        { key: 'sender', label: 'Gönderen', render: (s) => s.sender.name },
        { key: 'giftId', label: 'Paket' },
        { key: 'count', label: 'Adet', align: 'right' },
        { key: 'cost', label: 'Harcanan', align: 'right', render: (s) => num(s.cost) },
        { key: 'payout', label: 'Ödül', align: 'right', render: (s) => num(s.payout) },
        { key: 'best', label: 'En iyi', align: 'right', render: (s) => (s.best ? `${s.best}x` : '—') },
      ]} rows=${d.recent} /></${Card}>`}</${Loading}>
    ${edit && html`<${LuckyEditor} config=${edit} version=${data.data.version} onClose=${() => setEdit(null)} onSaved=${() => (setEdit(null), toast('Şanslı hediye ayarları kaydedildi'), data.reload())} />`}
  </${Page}>`;
}

function LuckyEditor({ config, version, onClose, onSaved }) {
  const [c, setC] = useState(config);
  const setGift = (i, patch) => setC({ ...c, gifts: c.gifts.map((g, j) => (j === i ? { ...g, ...patch } : g)) });
  /** The tier weights as percentages with 3 decimals; the no-reward row takes what is left. */
  const pct = (g, m) => (g.tiers.find((t) => t.mult === m)?.weight ?? 0) / 1000;
  const setPct = (i, m, value) => {
    const g = c.gifts[i];
    const w = Math.round(Number(String(value).replace(',', '.')) * 1000);
    const rest = g.tiers.filter((t) => t.mult !== 0 && t.mult !== m);
    const list = [...rest, ...(Number.isFinite(w) && w > 0 ? [{ mult: m, weight: w }] : [])];
    const left = TOTAL - list.reduce((s, t) => s + t.weight, 0);
    setGift(i, { tiers: [{ mult: 0, weight: left }, ...list].sort((a, b) => a.mult - b.mult) });
  };
  const add = () => setC({ ...c, gifts: [...c.gifts, { id: `lk${Date.now().toString(36)}`, name: 'Yeni paket', emoji: '🍀', price: 100, enabled: false, tiers: [{ mult: 0, weight: TOTAL }] }] });
  const save = async () => {
    const bad = c.gifts.find((g) => (g.tiers.find((t) => t.mult === 0)?.weight ?? 0) < 0);
    if (bad) return showError(new Error(`${bad.name}: olasılıkların toplamı %100'ü geçiyor`));
    (await act(() => post('/api/app/lucky/config', { config: c, version }))) && onSaved();
  };
  return html`<${Modal} title="Şanslı hediyeler" wide onClose=${onClose}>
    <div class="form"><div class="grid2">
      <label class="field"><span>Günlük ödül limiti (oyun jetonu, bütün platform)</span><input inputmode="numeric" value=${c.dailyPayoutLimit} onInput=${(e) => setC({ ...c, dailyPayoutLimit: Number(e.target.value.replace(/[^\d]/g, '')) })} /></label>
      <label class="field"><span>Odada duyurulan en düşük çarpan</span><select value=${String(c.announceFrom)} onChange=${(e) => setC({ ...c, announceFrom: Number(e.target.value) })}>${MULTS.map((m) => html`<option value=${String(m)}>${m}x</option>`)}</select></label>
    </div></div>
    ${c.gifts.map((g, i) => html`<${Card} title=${`${g.emoji} ${g.name}`} actions=${html`<${Button} kind="ghost" onClick=${() => setC({ ...c, gifts: c.gifts.filter((_, j) => j !== i) })}>Paketi çıkar</${Button}>`}>
      <div class="form"><div class="grid2">
        <label class="field"><span>Ad</span><input value=${g.name} maxlength="30" onInput=${(e) => setGift(i, { name: e.target.value })} /></label>
        <label class="field"><span>Simge</span><input value=${g.emoji} maxlength="8" onInput=${(e) => setGift(i, { emoji: e.target.value })} /></label>
        <label class="field"><span>Fiyat (jeton, 5–100.000)</span><input inputmode="numeric" value=${g.price} onInput=${(e) => setGift(i, { price: Number(e.target.value.replace(/[^\d]/g, '')) })} /></label>
        <label class="field inline"><span>Açık</span><input type="checkbox" checked=${g.enabled} onChange=${(e) => setGift(i, { enabled: e.target.checked })} /></label>
      </div></div>
      <div class="row gap wrap">${MULTS.map((m) => html`<label class="field" style="width:96px"><span>${m}x (%)</span><input inputmode="decimal" value=${String(pct(g, m) || '').replace('.', ',')} placeholder="0" onChange=${(e) => setPct(i, m, e.target.value)} /></label>`)}</div>
      <p class=${pct(g, 0) < 0 ? 'note bad' : 'muted'}>Ödülsüz %${num(pct(g, 0), 3)} · ortalama geri ödeme %${num(rtp(g) * 100, 2)} · en yüksek ${top(g)}x</p>
    </${Card}>`)}
    <${Button} onClick=${add}>Paket ekle</${Button}>
    <div class="row end gap" style="margin-top:12px"><${Button} onClick=${onClose}>Vazgeç</${Button}><${Button} kind="primary" onClick=${save}>Kaydet</${Button}></div>
  </${Modal}>`;
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
  return String(v);
}

/** A saved value in the history: null is the default. */
function saved(v) {
  if (v === null || v === undefined) return 'varsayılan';
  if (v === '') return 'boş';
  if (typeof v === 'number') return num(v, Number.isInteger(v) ? 0 : 2);
  if (Array.isArray(v)) return v.length ? v.join(', ') : 'hiçbiri';
  if (typeof v === 'object') return v.percent !== undefined ? `%${v.percent} · ${v.label}` : JSON.stringify(v);
  return String(v);
}

export function AppSettings() {
  const { can } = useApp();
  const [tab, setTab] = useState('settings');
  const data = useApi('/api/app/live-settings');
  const history = useApi(tab === 'history' ? '/api/app/live-settings/history?limit=30' : null);
  const [edit, setEdit] = useState(null);
  const [ask, prompt] = usePrompt();
  const groups = data.data ? [...new Set(data.data.settings.map((s) => s.group))] : [];
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
  return html`<${Page} title="Canlı ayarlar" subtitle="Uygulamanın kurulum gerektirmeden değişen ayarları: kur, kampanya, gizli hediye ve paketler, fiyatlar, sınırlar, acil durum anahtarları. Her kayıt önce önizlenir, nedenle yazılır, uygulamadaki yöneticilere bildirilir ve geri alınabilir.">
    ${prompt}
    <${Tabs} tabs=${[['settings', 'Ayarlar'], ['history', 'Geçmiş']]} value=${tab} onChange=${setTab} />
    ${tab === 'settings' && html`<${Loading} state=${data}>${(d) => html`
      ${d.safeMode && html`<p class="note bad">Uygulamanın sunucusu güvenli modda (LIVE_SAFE_MODE): kayıtlı ayarlar kullanılmıyor ve kaydedilemez.</p>`}
      ${groups.map((g) => html`<${Card} title=${g}><${Table} dense columns=${[
        // Long help and reasons wrap, so "Şu an" and Değiştir stay on screen.
        { key: 'label', label: 'Ayar', render: (s) => html`<div style="white-space:normal;min-width:280px;max-width:560px"><strong>${s.label}</strong><br /><small class="muted">${s.help}</small></div>` },
        { key: 'effective', label: 'Şu an', render: (s) => html`${shown(s, s.effective)}${s.invalid ? html` <span class="badge bad">kayıt geçersiz, varsayılan kullanılıyor</span>` : ''}` },
        { key: 'changedAt', label: 'Son değişiklik', render: (s) => (s.changedAt ? html`<div style="white-space:normal;max-width:260px">${dateTimeTr(s.changedAt)}<br /><small class="muted">${s.changedBy?.name ?? ''}${s.reason ? ` · ${s.reason}` : ''}</small></div>` : html`<span class="muted">varsayılan</span>`) },
        { key: 'a', label: '', render: (s) => can('app.settings') && !d.safeMode && html`<${Button} onClick=${() => setEdit(s)}>Değiştir</${Button}>` },
      ]} rows=${d.settings.filter((s) => s.group === g)} /></${Card}>`)}`}</${Loading}>`}
    ${tab === 'history' && html`<${Loading} state=${history}>${(h) => html`<${Table} empty="Kayıt yok" columns=${[
      { key: 'at', label: 'Zaman', render: (b) => html`${dateTimeTr(b.at)}<br /><small class="muted">${b.by?.name ?? ''}</small>` },
      { key: 'reason', label: 'Neden', render: (b) => html`${b.reason}${b.rollbackOf ? html` <span class="badge">geri alma</span>` : ''}` },
      { key: 'changes', label: 'Değişiklikler', render: (b) => b.changes.map((c) => html`<div>${c.label}: ${saved(c.before)} → ${saved(c.after)}</div>`) },
      { key: 'a', label: '', render: (b) => can('app.settings') && html`<${Button} onClick=${() => rollback(b)}>Geri al</${Button}>` },
    ]} rows=${h.batches} />`}</${Loading}>`}
    ${edit && data.data && html`<${SettingEditor} s=${edit} onClose=${() => setEdit(null)} onSave=${async (value, reason) => (await apply('/api/app/live-settings', { changes: { [edit.key]: value }, reason, baseV: data.data.v })) && setEdit(null)} />`}
  </${Page}>`;
}

const local = (iso) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '');
function SettingEditor({ s, onClose, onSave }) {
  const start = s.value ?? s.effective;
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
