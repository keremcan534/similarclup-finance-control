// Uygulama › Oda roketi: the Similar Club app's room rocket (the app's server/api/room-rocket.mjs; server/app-admin.ts
// passes the calls on as the signed-in panel user). Gifts sent in a room fill its rocket for the day (from 00:00,
// Turkey's time); five levels in a row, each with its goal; a full level launches and its prizes go to the day's givers
// in the room by how much each gave (owners, 25 Nov 2026; a draw before): the biggest coin prize to the most, items
// after the coins, at most one prize each. Here: on or
// off, each level's goal and prizes (coins, normal ones, or a shop item for some days, and how many people get each),
// the five launch videos (an SVGA for each level) and the last launches. A save made on an older copy is refused; the
// page is read again.
import { Badge, Button, Card, Loading, Page, Table, act, dateTimeTr, html, num, post, useApi, useApp, useEffect, useState } from '../lib.js';
import { upload, videoKindOf } from './app-gifts.js';

const KIND_TR = { frame: 'Çerçeveler', entry: 'Giriş efektleri', ride: 'Araçlar', bubble: 'Sohbet balonları', wave: 'Ses dalgaları' };
const clone = (x) => JSON.parse(JSON.stringify(x));
const toNumber = (v) => (v === '' ? 0 : Number(String(v).replace(/\./g, '').replace(',', '.')));

export function AppRocket() {
  const { can, meta } = useApp();
  const view = useApi(meta.app_link ? '/api/app/rocket' : null);
  if (!meta.app_link)
    return html`<${Page} title="Oda roketi"><div class="empty bad">Uygulama bağlantısı ayarlı değil: sunucuda FC_APP_API_URL ve FC_APP_API_KEY gerekli.</div></${Page}>`;
  return html`<${Page}
    title="Oda roketi"
    subtitle="Odadaki hediyeler roketi doldurur; seviye dolunca roket kalkar ve ödüller o gün odada katkı verenlere katkı sırasıyla verilir: en çok gönderen en büyük jeton ödülünü alır, eşyalar jetonlardan sonra. Her gün 00:00'da Lv.1'den başlar. Değişiklik sunucuda hemen geçerli; roketi yeni APK gösterir."
  >
    <${Loading} state=${view}>${(d) => html`
      <${Editor} key=${d.version} data=${d} editing=${can('app.rocket')} onSaved=${() => view.reload()} />
      <${Videos} data=${d} editing=${can('app.rocket')} onSaved=${() => view.reload()} />
      <${Recent} rows=${d.recent} />
    `}</${Loading}>
  </${Page}>`;
}

/** On / off and the five levels, saved together. */
function Editor({ data, editing, onSaved }) {
  const [cfg, setCfg] = useState(() => clone(data.config));
  const L = data.limits;
  const dirty = JSON.stringify(cfg) !== JSON.stringify(data.config);
  const setLevel = (i, f) => setCfg((c) => ({ ...c, levels: c.levels.map((l, j) => (j === i ? f(l) : l)) }));
  const setPrize = (i, k, f) => setLevel(i, (l) => ({ ...l, prizes: l.prizes.map((p, j) => (j === k ? f(p) : p)) }));
  const movePrize = (i, k, by) =>
    setLevel(i, (l) => {
      const prizes = [...l.prizes];
      const j = k + by;
      if (j < 0 || j >= prizes.length) return l;
      [prizes[k], prizes[j]] = [prizes[j], prizes[k]];
      return { ...l, prizes };
    });
  // Each level launches when the day's coins reach the goals so far added up.
  const ends = cfg.levels.reduce((a, l) => [...a, (a.at(-1) ?? 0) + (Number(l.goal) || 0)], []);
  const save = async () => {
    if (cfg.enabled && !data.config.enabled && !confirm('Oda roketi açılsın mı? Ödüller o gün odada en çok gönderenlere sırayla verilir; jeton ödülü harcanabilir jetondur.')) return;
    if ((await act(() => post('/api/app/rocket/config', { config: cfg, version: data.version }), 'Oda roketi kaydedildi')) !== undefined) onSaved();
  };
  // A prize's item that is no longer on the shelf stays choosable as it is (the app refuses it on save).
  const itemOptions = (sku) => {
    const known = data.items.some((x) => x.sku === sku);
    const kinds = [...new Set(data.items.map((x) => x.kind))];
    return html`${!known && sku && html`<option value=${sku}>${sku} (satışta değil)</option>`}
      ${kinds.map((k) => html`<optgroup label=${KIND_TR[k] ?? k}>${data.items.filter((x) => x.kind === k).map((x) => html`<option value=${x.sku}>${x.name}</option>`)}</optgroup>`)}`;
  };
  return html`
    <${Card} title="Roket">
      <label class="field inline"><span>Oda roketi açık</span>
        <input type="checkbox" checked=${cfg.enabled} disabled=${!editing} onChange=${(e) => setCfg((c) => ({ ...c, enabled: e.target.checked }))} /></label>
      <p class="note">
        Ödüller o gün odada katkı verenlere <b>katkı sırasıyla</b> verilir (çekiliş yok): en çok gönderen en büyük jeton ödülünü alır, sonra ikincisi;
        jeton ödülleri büyükten küçüğe önce, eşya ödülleri sonra; herkes en çok bir ödül alır. Kazanılan jeton normal jetondur (cüzdanda "Şanslı
        ödülü"): hediye gönderilebilir, böylece elmasa ve nakde dönebilir; harcanınca Cömertlik'e sayılmaz. Kapatınca hiçbir oda dolmaz; kazanılan
        ödüller kişilerde kalır.
      </p>
    </${Card}>
    ${cfg.levels.map(
      (l, i) => html`<${Card} key=${i} title=${`Lv.${i + 1}`} actions=${html`<small class="muted">Gün içinde toplam ${num(ends[i])} jetonda kalkar</small>`}>
        <label class="field" style="max-width:240px"><span>Hedef (jeton, ${num(L.goalMin)}–${num(L.goalMax)})</span>
          <input type="number" min=${L.goalMin} max=${L.goalMax} value=${l.goal} disabled=${!editing} onInput=${(e) => setLevel(i, (x) => ({ ...x, goal: toNumber(e.target.value) }))} /></label>
        <h3>Ödüller <small class="muted">(en çok gönderene en büyük jeton ödülü; eşyalar jetonlardan sonra)</small></h3>
        ${!l.prizes.length && html`<div class="empty">Bu seviyenin ödülü yok: roket kalkar, kimse bir şey kazanmaz.</div>`}
        ${l.prizes.map(
          (p, k) => html`<div class="row gap wrap" style="align-items:flex-end;margin-bottom:6px">
            <label class="field"><span>Tür</span>
              <select value=${p.kind} disabled=${!editing}
                onChange=${(e) => setPrize(i, k, () => (e.target.value === 'coins' ? { kind: 'coins', amount: 100, winners: p.winners } : { kind: 'item', sku: data.items[0]?.sku ?? '', days: 1, winners: p.winners }))}>
                <option value="coins">Jeton</option>
                <option value="item">Mağaza eşyası</option>
              </select></label>
            ${p.kind === 'coins'
              ? html`<label class="field"><span>Jeton</span>
                  <input type="number" min="1" max=${L.coinsMax} value=${p.amount} disabled=${!editing} onInput=${(e) => setPrize(i, k, (x) => ({ ...x, amount: toNumber(e.target.value) }))} /></label>`
              : html`<label class="field"><span>Eşya</span>
                    <select value=${p.sku} disabled=${!editing} onChange=${(e) => setPrize(i, k, (x) => ({ ...x, sku: e.target.value }))}>${itemOptions(p.sku)}</select></label>
                  <label class="field"><span>Gün (1–${L.daysMax})</span>
                    <input type="number" min="1" max=${L.daysMax} value=${p.days} disabled=${!editing} onInput=${(e) => setPrize(i, k, (x) => ({ ...x, days: toNumber(e.target.value) }))} /></label>`}
            <label class="field"><span>Kaç kişiye (1–${L.winnersMax})</span>
              <input type="number" min="1" max=${L.winnersMax} value=${p.winners} disabled=${!editing} onInput=${(e) => setPrize(i, k, (x) => ({ ...x, winners: toNumber(e.target.value) }))} /></label>
            ${editing &&
            html`<${Button} kind="ghost" onClick=${() => movePrize(i, k, -1)} aria-label="Yukarı">↑</${Button}>
              <${Button} kind="ghost" onClick=${() => movePrize(i, k, 1)} aria-label="Aşağı">↓</${Button}>
              <${Button} kind="ghost" onClick=${() => setLevel(i, (x) => ({ ...x, prizes: x.prizes.filter((_, j) => j !== k) }))}>Sil</${Button}>`}
          </div>`,
        )}
        ${editing &&
        l.prizes.length < L.prizesMax &&
        html`<${Button} kind="ghost" onClick=${() => setLevel(i, (x) => ({ ...x, prizes: [...x.prizes, { kind: 'coins', amount: 100, winners: 1 }] }))}>+ Ödül</${Button}>`}
      </${Card}>`,
    )}
    ${editing &&
    html`<div class="row gap end" style="margin-bottom:14px">
      ${dirty && html`<${Button} onClick=${() => setCfg(clone(data.config))}>Vazgeç</${Button}>`}
      <${Button} kind="primary" onClick=${save} disabled=${!dirty}>Kaydet</${Button}>
    </div>`}
  `;
}

/** Each level's launch video: an SVGA (or a transparent WebM / MOV, or a ready stacked MP4) the app's server converts. */
function Videos({ data, editing, onSaved }) {
  const [busy, setBusy] = useState(null);
  const working = (data.videos ?? []).some((v) => v.job?.status === 'processing');
  // While a video is being converted the page looks again by itself.
  useEffect(() => {
    if (!working) return;
    const t = setInterval(onSaved, 5000);
    return () => clearInterval(t);
  }, [working]);
  const pick = async (level, file) => {
    if (!file) return;
    const k = videoKindOf(file);
    if (!k) return alert('Dosya SVGA, saydam WebM, ProRes .mov ya da hazır yığılmış MP4 olmalı');
    if ((k === 'svga' && !data.svga) || (k === 'source' && !data.convert)) return alert('Uygulamanın sunucusu bu dosyayı çeviremiyor: hazır yığılmış MP4 yükleyin');
    setBusy(level);
    try {
      const url = await upload(k === 'stacked' ? 'giftvideo' : 'giftsource', file);
      if ((await act(() => post('/api/app/rocket/video', { level, video: { kind: k === 'stacked' ? 'stacked' : 'source', url } }), `Lv.${level} videosu kaydedildi`)) !== undefined) onSaved();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  };
  const remove = async (level) => {
    if (!confirm(`Lv.${level} videosu kaldırılsın mı? Roket hediyesinin resmi uçar.`)) return;
    if ((await act(() => post('/api/app/rocket/video', { level, video: null }), `Lv.${level} videosu kaldırıldı`)) !== undefined) onSaved();
  };
  const state = (v) =>
    v.job?.status === 'processing'
      ? html`<${Badge} s="pending" label="Çevriliyor" />`
      : v.job?.status === 'failed'
        ? html`<${Badge} s="error" label="Çevrilemedi" /> <small class="muted">${v.job.error}</small>`
        : v.video
          ? html`<${Badge} s="active" label=${`Hazır · ${(v.video.ms / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} sn`} />`
          : html`<span class="muted">Yok (Roket hediyesinin resmi uçar)</span>`;
  return html`<${Card} title="Kalkış videoları">
    <p class="note">Her seviye kalkarken odada kendi videosu oynar. SVGA yükleyin; uygulamanın sunucusu telefonların oynattığı videoya çevirir. En çok 15 saniye. Videoyu yeni APK gösterir.</p>
    ${(data.videos ?? []).map(
      (v) => html`<div class="row gap wrap" key=${v.level} style="align-items:center;margin-bottom:8px">
        <b style="min-width:48px">Lv.${v.level}</b>
        <span style="flex:1;min-width:180px">${busy === v.level ? html`<${Badge} s="pending" label="Yükleniyor" />` : state(v)}</span>
        ${editing &&
        html`<input type="file" accept=".svga,.webm,.mov,.mp4,video/mp4,video/webm,video/quicktime" aria-label=${`Lv.${v.level} videosu`} disabled=${busy !== null} onChange=${(e) => pick(v.level, e.target.files[0])} />
          ${v.video && html`<${Button} kind="ghost" onClick=${() => remove(v.level)}>Kaldır</${Button}>`}`}
      </div>`,
    )}
  </${Card}>`;
}

/** The last launches, every room. */
function Recent({ rows }) {
  return html`<${Card} title="Son kalkışlar">
    <${Table}
      empty="Henüz kalkan roket yok."
      columns=${[
        { key: 'launchedAt', label: 'Zaman', render: (r) => dateTimeTr(r.launchedAt) },
        { key: 'room', label: 'Oda', render: (r) => r.room.title },
        { key: 'level', label: 'Seviye', render: (r) => `Lv.${r.level}` },
        { key: 'goal', label: 'Hedef', align: 'right', render: (r) => num(r.goal) },
        { key: 'winners', label: 'Kazanan', align: 'right', render: (r) => (r.paidAt ? num(r.winners) : html`<${Badge} s="pending" label="Ödeniyor" />`) },
      ]}
      rows=${rows}
    />
  </${Card}>`;
}
