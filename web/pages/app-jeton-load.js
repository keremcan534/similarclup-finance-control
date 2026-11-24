// Para › Yönetim jeton yükleme (owners, 22 Nov 2026: "yönetim olarak jeton noktası hizmeti vereceğiz"): the Süper
// yönetici makes coins into management's own Jeton Noktası account (üretim: the app's wholesale, at the TL price
// given, booked for finance), then loads them from it to a person found by their ID. TL or coins are typed, the other
// is worked out from the rate; a confirmation names the person, the coins and the TL before anything moves. Only
// management takes a wrong load back: the coins of that load still unspent go back to the account (the app's
// jeton.mjs: GET /api/admin/jeton/loads, POST /api/admin/jeton/load, /reverse, /wholesale; permission app.jeton_load).
import { Button, Card, ID_HINT, Loading, Page, Table, act, dateTimeTr, html, num, personOf, personText, post, toast, useApi, usePrompt, useState } from '../lib.js';

const ref = () => `yk${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const tl = (x) => `${Number(x).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`;
/** TL as typed (comma or dot), rounded to kuruş; NaN when it isn't a number. */
const tlIn = (s) => Math.round(Number(String(s ?? '').replace(/\s/g, '').replace(',', '.')) * 100) / 100;

export function AppJetonLoad() {
  const [bankId, setBankId] = useState(() => localStorage.getItem('fc:jeton-load-bank') ?? '');
  const data = useApi(`/api/app/jeton/loads${bankId ? `?bank=${bankId}` : ''}`);
  const [ask, prompt] = usePrompt();
  // The calculator: 1,000 coins = rate TL (starts at the wholesale price set in Canlı ayarlar › Jeton Noktası; the staff may change it).
  const [rate, setRate] = useState('');
  const [coins, setCoins] = useState('');
  const [money, setMoney] = useState('');
  const [to, setTo] = useState('');
  const [paymentRef, setPaymentRef] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const d = data.data;
  const banks = d?.banks ?? [];
  const bank = banks.find((b) => b.id === bankId) ?? null;
  const rateNow = rate !== '' ? tlIn(rate) : (d?.rateTl ?? 0);
  const pick = (id) => {
    setBankId(id);
    localStorage.setItem('fc:jeton-load-bank', id);
  };
  // Typing one side works out the other; a new rate works out the coins again from the TL paid (or the TL from the
  // coins, when no TL is typed).
  const fromCoins = (v, r = rateNow) => {
    setCoins(v);
    const c = Number(v);
    setMoney(c > 0 && r > 0 ? String(Math.round((c / 1000) * r * 100) / 100) : '');
  };
  const fromMoney = (v, r = rateNow) => {
    setMoney(v);
    const m = tlIn(v);
    setCoins(m > 0 && r > 0 ? String(Math.floor((m / r) * 1000)) : '');
  };
  const fromRate = (v) => {
    setRate(v);
    const r = tlIn(v);
    if (tlIn(money) > 0) fromMoney(money, r);
    else if (Number(coins) > 0) fromCoins(coins, r);
  };

  const make = async () => {
    if (!bank) return toast('Önce yönetimin Jeton Noktası hesabını seçin', 'error');
    const v = await ask('Jeton üret', {
      text: `${personText(bank)} hesabına jeton üretilir (uygulamanın toptan satışı). Fiyat finansa bu hesabın stoğunun maliyeti olarak yazılır.`,
      fields: [
        { name: 'coins', label: 'Jeton', type: 'number', required: true },
        { name: 'price', label: 'Bu jetonların toplam fiyatı (TL)', type: 'money', required: true, hint: d?.rateTl ? `Toptan fiyat (Canlı ayarlar › Jeton Noktası): 1.000 jeton = ${tl(d.rateTl)}` : '' },
        { name: 'paymentRef', label: 'Belge / dekont no', type: 'text', required: true },
        { name: 'note', label: 'Not', type: 'text', wide: true },
      ],
      ok: 'Devam',
    });
    if (!v) return;
    const c = Number(v.coins);
    const p = tlIn(v.price);
    if (!(c > 0) || !(p >= 0)) return toast('Jeton ve fiyat sayı olmalı', 'error');
    if (!confirm(`${num(c)} jeton, ${tl(p)} fiyatla ${personText(bank)} hesabına üretilecek. Onaylıyor musun?`)) return;
    const r = await act(() => post('/api/app/jeton/wholesale', { bank: bank.id, coins: c, priceTl: p, paymentRef: v.paymentRef.trim(), note: v.note ?? '', ref: ref() }));
    if (r) (toast(`${num(c)} jeton üretildi`), data.reload());
  };

  const load = async (e) => {
    e.preventDefault();
    if (!bank) return toast('Önce yönetimin Jeton Noktası hesabını seçin', 'error');
    const c = Number(coins);
    const m = tlIn(money);
    if (!(c > 0) || !Number.isInteger(c)) return toast('Jeton miktarı tam sayı olmalı', 'error');
    if (!(m >= 0)) return toast('Ödenen tutar sayı olmalı', 'error');
    if (c > bank.coins) return toast(`Hesapta ${num(bank.coins)} jeton var; önce jeton üretin`, 'error');
    setBusy(true);
    try {
      // Who gets the coins, by name, before they move: a mistyped ID is someone else.
      const who = await act(() => personOf(to));
      if (!who) return;
      const ok = await ask('Yüklemeyi onayla', {
        text: `${personText(who)} kişisine ${num(c)} jeton yüklenecek. Ödenen: ${tl(m)}${paymentRef.trim() ? ` · dekont ${paymentRef.trim()}` : ''}. Jetonlar ${personText(bank)} hesabından düşer.`,
        fields: [],
        ok: 'Onayla ve yükle',
      });
      if (!ok) return toast('Yükleme iptal edildi');
      const r = await act(() => post('/api/app/jeton/load', { bank: bank.id, to: who.id, coins: c, valueTl: m, paymentRef: paymentRef.trim(), note: note.trim(), ref: ref() }));
      if (r) {
        toast(`${personText(who)}: ${num(c)} jeton yüklendi`);
        setCoins('');
        setMoney('');
        setTo('');
        setPaymentRef('');
        setNote('');
        data.reload();
      }
    } finally {
      setBusy(false);
    }
  };

  const reverse = async (x) => {
    const v = await ask(`#${x.id} yüklemesini geri al`, {
      text: `${x.to.name ?? 'Kişi'}: ${num(x.coins)} jeton yüklenmişti, ${num(x.unspent)} jetonu hâlâ hesabında. Geri alınca bu kadarı yönetim hesabına döner; harcanmış olan geri gelmez.`,
      label: 'Geri alma nedeni',
    });
    if (!v) return;
    const r = await act(() => post('/api/app/jeton/reverse', { transfer: x.id, reason: v.reason }));
    if (r) (toast(`${num(r.coins)} jeton geri alındı${r.spent ? ` (${num(r.spent)} jeton harcanmıştı)` : ''}`), data.reload());
  };

  return html`<${Page} title="Yönetim jeton yükleme" subtitle="Yönetimin Jeton Noktası hesabına jeton üretin, sonra ödeme yapan kişiye buradan yükleyin. Yalnız Süper yönetici. Her işlem uygulamada sizin adınızla kaydedilir; yanlış yüklemeyi yalnız yönetim geri alır.">
    ${prompt}
    <${Loading} state=${data}>${() => html`
      <div class="cols2">
        <${Card} title="Yönetim hesabı">
          ${banks.length
            ? html`<label class="field"><span>Jeton Noktası hesabı</span>
                <select value=${bankId} onChange=${(e) => pick(e.target.value)}>
                  <option value="">— seçin —</option>
                  ${banks.map((b) => html`<option value=${b.id}>${b.name}${b.publicNo ? ` · ID ${b.publicNo}` : ''} · ${num(b.coins)} jeton</option>`)}
                </select></label>`
            : html`<p class="muted">Hiç Jeton Noktası hesabı yok. Para › Jeton Noktası sayfasından yönetimin hesabını Jeton Noktası yapın.</p>`}
          ${bank && html`<p>Stok: <strong>${num(bank.coins)}</strong> jeton</p>`}
          <${Button} kind="primary" onClick=${make} disabled=${!bank}>Jeton üret</${Button}>
        </${Card}>
        <${Card} title="Kişiye yükle">
          <form class="form" onSubmit=${load}>
            <div class="grid2">
              <label class="field wide"><span>Kişinin ID’si *</span><input value=${to} onInput=${(e) => setTo(e.target.value)} required placeholder=${ID_HINT} /></label>
              <label class="field"><span>1.000 jeton =</span><input inputmode="decimal" value=${rate !== '' ? rate : String(d?.rateTl ?? '')} onInput=${(e) => fromRate(e.target.value)} /><small class="muted">TL (hesap için; değiştirilebilir)</small></label>
              <span></span>
              <label class="field"><span>Jeton *</span><input type="number" min="1" step="1" value=${coins} onInput=${(e) => fromCoins(e.target.value)} /></label>
              <label class="field"><span>Ödenen tutar (TL) *</span><input inputmode="decimal" value=${money} onInput=${(e) => fromMoney(e.target.value)} /></label>
              <label class="field"><span>Dekont / ödeme no</span><input value=${paymentRef} maxlength="100" onInput=${(e) => setPaymentRef(e.target.value)} /></label>
              <label class="field"><span>Not</span><input value=${note} maxlength="200" onInput=${(e) => setNote(e.target.value)} /></label>
            </div>
            <div class="row gap end"><button class="btn primary" type="submit" disabled=${busy || !bank}>${busy ? 'Bekleyin…' : 'Yükle'}</button></div>
          </form>
        </${Card}>
      </div>
      <${Card} title="Yüklemeler">
        <${Table}
          dense
          empty="Henüz yönetim yüklemesi yok"
          columns=${[
            { key: 'id', label: '#', render: (x) => html`<span class="num">${x.id}</span>` },
            { key: 'at', label: 'Ne zaman', render: (x) => dateTimeTr(x.createdAt) },
            { key: 'to', label: 'Kişi', render: (x) => x.to.name ?? x.to.id },
            { key: 'c', label: 'Jeton', render: (x) => num(x.coins) },
            { key: 'tl', label: 'Ödenen', render: (x) => (x.valueTl === null ? '—' : tl(x.valueTl)) },
            { key: 'r', label: 'Dekont', render: (x) => x.paymentRef || '—' },
            { key: 'u', label: 'Hesabında kalan', render: (x) => num(x.unspent) },
            {
              key: 'a',
              label: '',
              render: (x) =>
                x.reversed
                  ? html`<span class="muted">${num(x.reversed.coins)} jeton geri alındı · ${dateTimeTr(x.reversed.at)}</span>`
                  : x.unspent > 0
                    ? html`<${Button} kind="danger" onClick=${() => reverse(x)}>Geri al</${Button}>`
                    : html`<span class="muted">Hepsi harcandı</span>`,
            },
          ]}
          rows=${d.loads}
        />
      </${Card}>
    `}</${Loading}>
  </${Page}>`;
}
