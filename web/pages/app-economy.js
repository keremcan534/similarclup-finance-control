// Uygulama › Mağaza eşyaları and Uygulama › Jeton Noktası, through the app's admin API (server/app-admin.ts; the app's
// economy.mjs and jeton.mjs check and record each one). Mağaza eşyaları (app.economy): what a person owns, giving an
// item (support, a lost purchase, a prize: price 0, the reason in the app's audit), taking one back, the items a store
// refund left for staff to look at. Jeton Noktası (app.jeton, critical): an account made a bank or back, selling a bank
// its stock for a receipt.
import { Button, Card, Loading, Page, Table, Tabs, act, dateTimeTr, html, num, post, toast, useApi, useApp, usePrompt, useState } from '../lib.js';

const Tag = ({ c, label }) => html`<span class=${`badge ${c}`}>${label}</span>`;
/** economy.mjs stateOf. */
const STATE = { live: ['ok', 'Kullanımda'], ended: ['muted', 'Süresi doldu'], revoked: ['muted', 'Geri alındı'], upcoming: ['info', 'Başlayacak'] };
/** catalog.mjs SHOP kinds and a sticker pack. */
const KIND = { frame: 'Çerçeve', entry: 'Giriş efekti', ride: 'Binek', bubble: 'Sohbet balonu', specialId: 'Özel ID', wave: 'Ses dalgası', sticker: 'Çıkartma paketi', micfx: 'Mikrofon efekti', noble: 'Rütbe' };
/** entitlements.source (020_economy.sql). */
const SOURCE = { buy: 'Satın aldı', bridge: 'Satın aldı (eski uygulama)', migrate: 'Önceki sürümden', admin: 'Yönetim verdi' };
/** A request id for the app's once-only rule (REF: 8–64 of [A-Za-z0-9_-]). */
const ref = () => `fc${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A person by account id, or (with app.users) by a search of the app's accounts. */
function FindPerson({ onPick }) {
  const { can } = useApp();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const found = useApi(q && can('app.users') ? `/api/app/users?q=${encodeURIComponent(q)}` : null);
  const go = (e) => {
    e.preventDefault();
    const v = text.trim();
    if (UUID.test(v)) return onPick({ id: v, name: v });
    setQ(v);
  };
  return html`<div>
    <form class="row gap" style="margin:10px 0" onSubmit=${go}>
      <input value=${text} onInput=${(e) => setText(e.target.value)} placeholder=${can('app.users') ? 'Ad, kullanıcı adı ya da hesap kimliği' : 'Hesap kimliği'} style="min-width:360px" />
      <button class="btn" type="submit">${can('app.users') ? 'Ara' : 'Aç'}</button>
    </form>
    ${q && !UUID.test(q) && !can('app.users') && html`<p class="muted">Arama için Kullanıcılar yetkisi gerekir; hesap kimliğini yapıştır.</p>`}
    ${q && can('app.users') && html`<${Loading} state=${found}>${(x) => html`<${Table}
      dense
      empty="Bu aramayla kimse bulunamadı"
      columns=${[
        { key: 'name', label: 'Kişi', render: (u) => html`<strong>${u.name}</strong>${u.username ? html` <span class="muted">@${u.username}</span>` : ''}` },
        { key: 'id', label: 'Hesap kimliği', render: (u) => html`<span class="num muted">${u.id}</span>` },
        { key: 'a', label: '', render: (u) => html`<${Button} onClick=${() => onPick(u)}>Aç</${Button}>` },
      ]}
      rows=${x.users}
    />`}</${Loading}>`}
  </div>`;
}

export function AppEconomy() {
  const [tab, setTab] = useState('person');
  const [who, setWho] = useState(null);
  return html`<${Page}
    title="Mağaza eşyaları"
    subtitle="Bir kişinin mağazadan aldığı ya da kendisine verilen eşyalar: eşya verme (destek, kaybolan satın alma, ödül), geri alma; mağaza iadesinin bıraktığı eşyalar. Her işlem uygulamada senin adınla ve nedeniyle kaydedilir."
  >
    <${Tabs} tabs=${[['person', 'Kişi'], ['reviews', 'İadenin bıraktıkları']]} value=${tab} onChange=${setTab} />
    ${tab === 'person' && html`${!who && html`<${FindPerson} onPick=${setWho} />`}${who && html`<${Owned} id=${who.id} onBack=${() => setWho(null)} />`}`}
    ${tab === 'reviews' && html`<${Reviews} onOpen=${(u) => (setWho(u), setTab('person'))} />`}
  </${Page}>`;
}

function Owned({ id, onBack }) {
  const data = useApi(`/api/app/economy/user?id=${encodeURIComponent(id)}`);
  const [ask, prompt] = usePrompt();
  const grant = async (x) => {
    const options = x.grantable.map((g) => [g.sku, `${g.name} · ${KIND[g.kind] ?? g.kind}${g.days === null ? ' · süresiz' : ` · ${g.days} gün`}`]);
    const v = await ask(`${x.user.name}: eşya ver`, {
      text: 'Ücretsiz verilir; süresi olan eşyada gün sayısını değiştirebilirsin. Neden uygulamanın kaydına yazılır.',
      fields: [
        { name: 'sku', label: 'Eşya', type: 'select', required: true, options, def: options[0]?.[0] },
        { name: 'days', label: 'Gün (boş: eşyanın kendi süresi)', type: 'number' },
        { name: 'reason', label: 'Neden', type: 'textarea', required: true, wide: true },
      ],
      ok: 'Ver',
    });
    if (!v) return;
    const item = x.grantable.find((g) => g.sku === v.sku);
    const days = v.days === '' || v.days === undefined || item?.days === null ? undefined : Number(v.days);
    const r = await act(() => post('/api/app/economy/grant', { userId: x.user.id, sku: v.sku, ...(days ? { days } : {}), reason: v.reason, ref: ref() }));
    if (r) (toast(`${item?.name ?? v.sku} verildi`), data.reload());
  };
  const revoke = async (e) => {
    const v = await ask(`Geri al: ${e.name}`, { text: 'Kişi eşyayı kullanamaz; ödediği jeton geri dönmez.', label: 'Neden' });
    if (v) {
      const r = await act(() => post('/api/app/economy/revoke', { id: e.id, reason: v.reason }));
      if (r) (toast('Eşya geri alındı'), data.reload());
    }
  };
  return html`<div style="margin-top:10px">
    ${prompt}
    <${Loading} state=${data}>${(x) => html`
      <div class="row gap" style="align-items:center;margin-bottom:10px">
        <${Button} kind="ghost" onClick=${onBack}>← Başka kişi</${Button}>
        <strong style="font-size:1.1em">${x.user.name}</strong>${x.user.deleted ? html` <${Tag} c="muted" label="Silinmiş" />` : ''}
        <span class="muted">Ödül jetonu: ${num(x.rewardCoins)}</span>
        <span style="flex:1"></span>
        ${!x.user.deleted && html`<${Button} kind="primary" onClick=${() => grant(x)}>Eşya ver</${Button}>`}
      </div>
      ${x.reviews.length > 0 && html`<p><${Tag} c="warn" label=${`${x.reviews.length} eşya iade incelemesinde`} /></p>`}
      <${Table}
        empty="Eşyası yok"
        columns=${[
          { key: 'name', label: 'Eşya', render: (e) => html`<strong>${e.name}</strong> <span class="muted">${KIND[e.kind] ?? e.kind}</span>` },
          { key: 'state', label: 'Durum', render: (e) => html`<${Tag} c=${STATE[e.state]?.[0] ?? 'muted'} label=${STATE[e.state]?.[1] ?? e.state} />` },
          { key: 'time', label: 'Süre', render: (e) => (e.endsAt ? `${dateTimeTr(e.startsAt)} → ${dateTimeTr(e.endsAt)}` : 'Süresiz') },
          { key: 'price', label: 'Ödenen', render: (e) => (e.price ? `${num(e.price)} jeton` : 'Ücretsiz') },
          { key: 'source', label: 'Nereden', render: (e) => SOURCE[e.source] ?? e.source ?? '—' },
          { key: 'a', label: '', render: (e) => e.state !== 'revoked' && html`<${Button} kind="ghost" onClick=${() => revoke(e)}>Geri al</${Button}>` },
        ]}
        rows=${x.items}
      />
    `}</${Loading}>
  </div>`;
}

function Reviews({ onOpen }) {
  const list = useApi('/api/app/economy/reviews');
  return html`<div style="margin-top:10px">
    <p class="muted">Mağaza iadesi alınan jetonlarla alınmış ama alıcıda olmayan eşyalar (örneğin jetonu Jeton Noktası'ndan geçmiş). Son 90 gün. Gerekirse kişiyi açıp eşyayı geri al.</p>
    <${Loading} state=${list}>${(x) => html`<${Table}
      empty="İncelenecek eşya yok"
      columns=${[
        { key: 'user', label: 'Kişi', render: (r) => html`<strong>${r.user.name}</strong>` },
        { key: 'item', label: 'Eşya', render: (r) => (r.item ? `${r.item.name} · ${STATE[r.item.state]?.[1] ?? r.item.state}` : '—') },
        { key: 'coins', label: 'İadeden gelen jeton', render: (r) => num(r.taintedCoins) },
        { key: 'purchase', label: 'Satın alma', render: (r) => html`<span class="num">#${r.purchase}</span>` },
        { key: 'at', label: 'Ne zaman', render: (r) => dateTimeTr(r.createdAt) },
        { key: 'a', label: '', render: (r) => html`<${Button} onClick=${() => onOpen(r.user)}>Kişiyi aç</${Button}>` },
      ]}
      rows=${x.rows}
    />`}</${Loading}>
  </div>`;
}

export function AppJeton() {
  const [ask, prompt] = usePrompt();
  const [last, setLast] = useState(null);
  const bank = async (enabled) => {
    const v = await ask(enabled ? 'Jeton Noktası hesabı aç' : 'Jeton Noktası hesabını kapat', {
      text: enabled ? 'Hesap Jeton Noktası olur: başkalarına jeton satabilir, elmas bozdurabilir. Yalnız güvendiğiniz işletmeler.' : 'Hesap sıradan hesaba döner; elindeki jetonlar kalır.',
      fields: [{ name: 'user', label: 'Hesap kimliği', type: 'text', required: true, wide: true }],
      ok: enabled ? 'Aç' : 'Kapat',
    });
    if (!v) return;
    const r = await act(() => post('/api/app/jeton/bank', { user: v.user.trim(), enabled }));
    if (r) toast(enabled ? 'Jeton Noktası hesabı açıldı' : 'Jeton Noktası hesabı kapatıldı');
  };
  const wholesale = async () => {
    const v = await ask('Toptan jeton satışı', {
      text: 'Jeton Noktası\'na stok: jetonlar hesabına geçer, finans paneline satış olarak gider. Dekont numarası zorunlu.',
      fields: [
        { name: 'bank', label: 'Jeton Noktası hesap kimliği', type: 'text', required: true, wide: true },
        { name: 'coins', label: 'Jeton', type: 'number', required: true },
        { name: 'paymentRef', label: 'Dekont / ödeme no', type: 'text', required: true },
        { name: 'note', label: 'Not', type: 'text', wide: true },
      ],
      ok: 'Sat',
    });
    if (!v) return;
    if (!confirm(`${num(Number(v.coins))} jeton bu Jeton Noktası'na geçecek. Emin misin?`)) return;
    const r = await act(() => post('/api/app/jeton/wholesale', { bank: v.bank.trim(), coins: Number(v.coins), paymentRef: v.paymentRef.trim(), note: v.note ?? '', ref: ref() }));
    if (r) (setLast(r), toast(`${num(Number(v.coins))} jeton satıldı`));
  };
  return html`<${Page} title="Jeton Noktası" subtitle="Jeton Noktası hesapları ve onlara toptan jeton satışı. Her işlem uygulamada senin adınla kaydedilir; satış finans paneline de gelir.">
    ${prompt}
    <div class="cols2">
      <${Card} title="Hesap">
        <p class="muted">Bir hesabı Jeton Noktası yap ya da sıradan hesaba döndür.</p>
        <div class="row gap"><${Button} kind="primary" onClick=${() => bank(true)}>Aç</${Button}><${Button} onClick=${() => bank(false)}>Kapat</${Button}></div>
      </${Card}>
      <${Card} title="Toptan satış">
        <p class="muted">Jeton Noktası'nın ödediği tutarın dekontuyla stok satışı.</p>
        <${Button} kind="primary" onClick=${wholesale}>Toptan sat</${Button}>
        ${last && html`<p class="muted">Son satış: ${num(last.coins ?? last.transfer?.coins)} jeton${last.transfer?.id ? ` · aktarım #${last.transfer.id}` : ''}${last.replay ? ' (daha önce yapılmıştı)' : ''}</p>`}
      </${Card}>
    </div>
  </${Page}>`;
}
