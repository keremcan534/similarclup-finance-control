// Uygulama › Mağaza: the Similar Club app's shop frames and entry effects (the app's server/api/shop-items.mjs;
// server/app-admin.ts passes the calls on as the signed-in panel user). The app's own items change (name, price, days,
// VIP level, on the shelf, order) and go back to the app's values; the team adds its own:
//   - a frame: a transparent square PNG/WebP drawn around the photo, with how big the photo's hole is;
//   - an entry effect: a video (a ready stacked MP4, or a transparent WebM, ProRes .mov or SVGA the app's server converts,
//     as a gift's) and its name plate: where the entering person's name is written over it, how wide it may be (a long
//     name is drawn smaller), how big, which colour.
// Phones read the shop from the server (a new APK); older APKs keep their compiled shop.
import { Badge, Button, Card, Loading, Modal, Page, Tabs, act, html, num, post, searchable, useApi, useApp, useEffect, useRef, useState } from '../lib.js';
import { Stage, typeOf, upload, videoKindOf } from './app-gifts.js';

const KINDS = [
  ['entry', 'Giriş efektleri'],
  ['frame', 'Çerçeveler'],
];
const FIELD_TR = { name: 'ad', price: 'fiyat', days: 'süre', minVip: 'VIP', enabled: 'rafta / kapalı' };
const daysText = (d) => (d ? `${num(d)} gün` : 'süresiz');
const pct = (x) => `${Math.round(x * 1000) / 10}`;
const SAMPLE = 'KaaN';

/** The name as the phone writes it on the plate: the plate's size, smaller until it fits the plate's width (one line). */
function plateFont(name, plate, H, W) {
  const c = plateFont.c ?? (plateFont.c = document.createElement('canvas').getContext('2d'));
  let px = plate.size * H;
  const fit = plate.w * W;
  c.font = `${plate.bold ? 800 : 500} ${px}px system-ui, sans-serif`;
  const width = c.measureText(name).width;
  if (width > fit) px = Math.max(8, (px * fit) / width);
  return px;
}

/** The video stage with the name plate over it, at the plate's place: what a phone shows when someone enters. */
function PlateStage({ src, plate, name }) {
  const W = 270;
  const H = 480;
  const px = plateFont(name || SAMPLE, plate, H, W);
  return html`<div class="plate-stage" style=${`width:${W}px;height:${H}px`}>
    ${src ? html`<${Stage} key=${src} src=${src} />` : html`<div class="plate-empty muted">Video çevrilince burada oynar</div>`}
    <div class="plate-box" style=${`left:${plate.x * 100}%;top:${plate.y * 100}%;width:${plate.w * 100}%;height:${plate.size * H * 1.8}px`}></div>
    <div class="plate-name" style=${`left:${plate.x * 100}%;top:${plate.y * 100}%;max-width:${plate.w * 100}%;font-size:${px}px;color:${plate.color};font-weight:${plate.bold ? 800 : 500}`}>${name || SAMPLE}</div>
  </div>`;
}

/** A frame over a sample photo, as a seat or a profile shows it: the photo fills the frame's hole. */
function FramePreview({ src, hole, size = 120 }) {
  const photo = Math.round(size * hole * 2);
  return html`<div class="frame-preview" style=${`width:${size}px;height:${size}px`}>
    <div class="frame-photo" style=${`width:${photo}px;height:${photo}px`}>🙂</div>
    ${src && html`<img src=${src} alt="" width=${size} height=${size} />`}
  </div>`;
}

export function AppShop() {
  const { can, meta } = useApp();
  const list = useApi(meta.app_link ? '/api/app/shop' : null);
  const [kind, setKind] = useState('entry');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);
  const [play, setPlay] = useState(null);
  if (!meta.app_link)
    return html`<${Page} title="Mağaza"><div class="empty bad">Uygulama bağlantısı ayarlı değil: sunucuda FC_APP_API_URL ve FC_APP_API_KEY gerekli.</div></${Page}>`;
  const editing = can('app.shop');
  const done = () => list.reload();

  const move = async (items, x, by) => {
    const ids = items.map((y) => y.id);
    const i = ids.indexOf(x.id);
    const j = i + by;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    (await act(() => post('/api/app/shop/order', { kind, ids }), 'Sıra kaydedildi')) && done();
  };
  const toggle = async (x) => {
    if (!confirm(x.enabled ? `“${x.name}” satıştan kaldırılsın mı? Alanlarda kalır ve kullanılır.` : `“${x.name}” yeniden satışa çıksın mı?`)) return;
    (await act(() => post('/api/app/shop/update', { id: x.id, enabled: !x.enabled }), x.enabled ? 'Satıştan kaldırıldı' : 'Satışa çıktı')) && done();
  };
  const reset = async (x) => {
    if (!confirm(`“${x.name}” uygulamadaki haline dönsün mü? Geri alınacak: ${x.changed.map((f) => FIELD_TR[f] ?? f).join(', ')}. Sırası değişmez.`)) return;
    (await act(() => post('/api/app/shop/reset', { id: x.id }), 'Orijinaline döndü')) && done();
  };
  const remove = async (x) => {
    if (!confirm(`“${x.name}” silinsin mi? Resmi ve videosu da silinir. Geri alınamaz.`)) return;
    (await act(() => post('/api/app/shop/delete', { id: x.id }), 'Silindi')) && done();
  };

  return html`<${Page}
    title="Mağaza"
    subtitle="Çerçeveler ve giriş efektleri: uygulamanın kendileri ve sizin eklediğiniz. Değişiklikler sunucuda hemen geçerli; yeni APK'da telefonlar mağazayı buradan gösterir."
    actions=${editing && html`<${Button} kind="primary" onClick=${() => setEdit({ kind })}>${kind === 'entry' ? 'Yeni giriş efekti' : 'Yeni çerçeve'}</${Button}>`}
  >
    <${Loading} state=${list}>${(d) => {
      const w = searchable(q.trim());
      const items = d.items.filter((x) => x.kind === kind);
      const shown = items.filter((x) => !w || searchable(`${x.name} ${x.id}`).includes(w));
      return html`
        ${!d.storage && html`<div class="empty bad">Uygulamanın dosya deposu açık değil: resim ve video yüklenemez.</div>`}
        <${Tabs} tabs=${KINDS.map(([k, l]) => [k, `${l} (${d.items.filter((x) => x.kind === k).length})`])} value=${kind} onChange=${setKind} />
        <div class="row gap wrap" style="margin:10px 0">
          <input type="search" class="list-search" style="margin-left:0" placeholder="Eşya ara: ad ya da kimlik" aria-label="Eşya ara" value=${q} onInput=${(e) => setQ(e.target.value)} />
          <small class="muted">${kind === 'entry' ? 'Sizin eklediğiniz giriş efektlerinde odaya girenin adı isim plakasına yazılır.' : 'Çerçeve resmi saydam, kare PNG ya da WebP olmalı; fotoğraf ortadaki boşluğa oturur.'}</small>
        </div>
        ${!shown.length && html`<div class="empty">${q ? `“${q}” için eşya yok.` : 'Eşya yok.'}</div>`}
        <div class="shop-grid">${shown.map((x) => html`<${Card}
          key=${x.id}
          class="shop-card"
          title=${html`<span>${x.name}</span> ${x.builtin ? html`<${Badge} s="info" label="Uygulamanın" />` : html`<${Badge} s="active" label="Eklenen" />`}
            ${!x.enabled && html` <${Badge} s="passive" label="Satışta değil" />`}
            ${x.changed?.length > 0 && html` <${Badge} s="warning" label=${`Değiştirildi: ${x.changed.map((f) => FIELD_TR[f] ?? f).join(', ')}`} />`}
            ${x.job?.status === 'processing' && html` <${Badge} s="pending" label="Video çevriliyor…" />`}
            ${x.job?.status === 'failed' && html` <${Badge} s="error" label="Video çevrilemedi" />`}`}
        >
          <div class="row gap" style="align-items:flex-start">
            ${x.kind === 'frame' && x.art ? html`<${FramePreview} src=${x.art.url} hole=${x.art.hole} size=${88} />` : ''}
            ${x.kind === 'entry' && x.video ? html`<${Button} onClick=${() => setPlay(x)}>▶ Oynat</${Button}>` : ''}
            <div class="stack" style="flex:1">
              <div>🪙 ${num(x.price)} · ${daysText(x.days)}${x.minVip ? ` · VIP ${x.minVip}+` : ''} · ${num(x.owners)} kişide</div>
              ${x.job?.status === 'failed' && html`<small class="bad">${x.job.error}</small>`}
              ${x.builtin && html`<small class="muted">Resmi ve animasyonu uygulamada; burada adı, fiyatı, süresi, VIP seviyesi ve satışta olup olmadığı değişir.</small>`}
            </div>
          </div>
          ${editing &&
          html`<div class="row gap wrap" style="margin-top:8px">
            <${Button} onClick=${() => setEdit(x)}>Düzenle</${Button}>
            <${Button} onClick=${() => toggle(x)}>${x.enabled ? 'Satıştan kaldır' : 'Satışa çıkar'}</${Button}>
            <${Button} kind="ghost" onClick=${() => move(items, x, -1)} aria-label="Yukarı">↑</${Button}>
            <${Button} kind="ghost" onClick=${() => move(items, x, 1)} aria-label="Aşağı">↓</${Button}>
            ${x.builtin && x.changed?.length > 0 && html`<${Button} kind="ghost" onClick=${() => reset(x)}>Orijinaline dön</${Button}>`}
            ${!x.builtin && x.owners === 0 && html`<${Button} kind="danger" onClick=${() => remove(x)}>Sil</${Button}>`}
          </div>`}
        </${Card}>`)}</div>
        ${edit && html`<${Editor} item=${edit.id ? edit : null} kind=${edit.kind} limits=${d.limits} convert=${d.convert} svga=${d.svga} onClose=${() => setEdit(null)} onSaved=${() => (setEdit(null), done())} />`}
        ${play && html`<${Modal} title=${play.name} onClose=${() => setPlay(null)}><${PlateStage} src=${play.video.url} plate=${play.plate ?? d.limits.plateDefault} name=${SAMPLE} /></${Modal}>`}
      `;
    }}</${Loading}>
  </${Page}>`;
}

/** Adding or changing an item. The app's own: name, price, days, VIP and on/off only. */
function Editor({ item, kind, limits, convert, svga, onClose, onSaved }) {
  const own = !item?.builtin;
  const [v, setV] = useState(() => ({
    name: item?.name ?? '',
    price: item?.price ?? '',
    days: item ? (item.days ?? 0) : 30,
    minVip: item?.minVip ?? 0,
    enabled: item?.enabled ?? true,
    hole: item?.art?.hole ?? limits.holeDefault,
    plate: item?.plate ?? limits.plateDefault,
  }));
  // `art`: the address to save (the app's, as the upload answered it); `artShown`: what this page draws (the panel's
  // copy of a saved one, or the picked file itself: the app's address is another origin, which the page doesn't load).
  const [art, setArt] = useState(item?.art?.url ?? null);
  const [artShown, setArtShown] = useState(item?.art?.url ?? null);
  const [video, setVideo] = useState(null);
  const [preview, setPreview] = useState(item?.video?.url ?? null);
  const [sample, setSample] = useState(SAMPLE);
  const [busy, setBusy] = useState(null);
  const set = (k, x) => setV((s) => ({ ...s, [k]: x }));
  const setPlate = (k, x) => setV((s) => ({ ...s, plate: { ...s.plate, [k]: x } }));
  const localUrl = useRef(null);
  useEffect(() => () => localUrl.current && URL.revokeObjectURL(localUrl.current), []);

  const pickArt = async (file) => {
    if (!file) return;
    if (!typeOf('shopframe', file)) return alert('Çerçeve resmi PNG ya da WebP olmalı');
    if (file.size > limits.frameBytes) return alert(`Resim en fazla ${Math.round(limits.frameBytes / 1024 / 1024)} MB olabilir`);
    setBusy('Resim yükleniyor…');
    try {
      setArt(await upload('shopframe', file));
      setArtShown(URL.createObjectURL(file));
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  };
  const pickVideo = async (file) => {
    if (!file) return;
    const k = videoKindOf(file);
    if (!k) return alert('Video hazır yığılmış MP4, saydam WebM, ProRes .mov ya da SVGA olmalı');
    if ((k === 'source' && !convert) || (k === 'svga' && !svga)) return alert('Uygulamanın sunucusu bu dosyayı çeviremiyor: hazır yığılmış MP4 yükleyin');
    setBusy('Video yükleniyor… %0');
    try {
      const url = await upload(k === 'stacked' ? 'giftvideo' : 'giftsource', file, (p) => setBusy(`Video yükleniyor… %${Math.round(p * 100)}`));
      setVideo(k === 'stacked' ? { kind: 'stacked', url } : { kind: 'source', url });
      if (localUrl.current) URL.revokeObjectURL(localUrl.current);
      // A ready stacked MP4 plays here at once; a source plays once the app's server has converted it.
      localUrl.current = k === 'stacked' ? URL.createObjectURL(file) : null;
      setPreview(localUrl.current);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  };
  const save = async () => {
    const body = { name: v.name, price: Number(v.price), days: Number(v.days), minVip: Number(v.minVip), enabled: v.enabled };
    if (own && kind === 'frame') Object.assign(body, { hole: Number(v.hole), ...(art && art !== item?.art?.url ? { art } : {}) });
    if (own && kind === 'entry') Object.assign(body, { plate: { ...v.plate, x: Number(v.plate.x), y: Number(v.plate.y), w: Number(v.plate.w), size: Number(v.plate.size) }, ...(video ? { video } : {}) });
    setBusy('Kaydediliyor…');
    const r = await act(
      () => (item ? post('/api/app/shop/update', { id: item.id, ...body }) : post('/api/app/shop', { kind, ...body })),
      video?.kind === 'source' ? 'Kaydedildi; video çevriliyor, birkaç dakika sürebilir' : 'Kaydedildi',
    );
    setBusy(null);
    if (r) onSaved();
  };
  const slider = (k, label, min, max, step) => html`<label class="field">
    <span>${label}: %${pct(v.plate[k])}</span>
    <input type="range" min=${min} max=${max} step=${step} value=${v.plate[k]} onInput=${(e) => setPlate(k, Number(e.target.value))} />
  </label>`;
  const P = limits.plate;
  return html`<${Modal} title=${item ? `${item.name} · düzenle` : kind === 'entry' ? 'Yeni giriş efekti' : 'Yeni çerçeve'} onClose=${onClose} wide>
    <div class="grid2" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px">
      <label class="field"><span>Ad *</span><input value=${v.name} maxlength=${limits.nameMax} onInput=${(e) => set('name', e.target.value)} /></label>
      <label class="field"><span>Fiyat (jeton) *</span><input type="number" min="1" value=${v.price} onInput=${(e) => set('price', e.target.value)} /></label>
      <label class="field"><span>Süre (gün; 0 = süresiz)</span><input type="number" min="0" max=${limits.daysMax} value=${v.days} onInput=${(e) => set('days', e.target.value)} /></label>
      <label class="field"><span>VIP seviyesi (0 = herkes)</span><input type="number" min="0" max=${limits.vipMax} value=${v.minVip} onInput=${(e) => set('minVip', e.target.value)} /></label>
    </div>
    <label class="field inline" style="margin-top:6px"><span>Satışta</span><input type="checkbox" checked=${v.enabled} onChange=${(e) => set('enabled', e.target.checked)} /></label>
    ${!own && html`<p class="note">Uygulamanın kendi eşyasının resmi ve animasyonu uygulamada. Yeni görselle bir eşya için "Yeni ${kind === 'entry' ? 'giriş efekti' : 'çerçeve'}" ekleyin.</p>`}
    ${own &&
    kind === 'frame' &&
    html`<div class="row gap wrap" style="align-items:flex-start;margin-top:10px">
      <${FramePreview} src=${artShown} hole=${v.hole} size=${160} />
      <div class="stack" style="flex:1;min-width:220px">
        <label class="field"><span>Çerçeve resmi * (saydam, kare PNG ya da WebP, ${limits.framePxMin}–${limits.framePxMax} px)</span><input type="file" accept="image/png,image/webp" onChange=${(e) => pickArt(e.target.files[0])} /></label>
        <label class="field"><span>Fotoğraf alanı: resmin %${pct(v.hole * 2)}'i</span>
          <input type="range" min=${limits.holeMin} max=${limits.holeMax} step="0.005" value=${v.hole} onInput=${(e) => set('hole', Number(e.target.value))} /></label>
        <small class="muted">Kaydırıcıyı, örnek fotoğraf çerçevenin ortasındaki boşluğu tam dolduracak yere getirin.</small>
      </div>
    </div>`}
    ${own &&
    kind === 'entry' &&
    html`<div class="row gap wrap" style="align-items:flex-start;margin-top:10px">
      <${PlateStage} src=${preview} plate=${v.plate} name=${sample} />
      <div class="stack" style="flex:1;min-width:240px">
        <label class="field"><span>Video${item ? ' (değiştirmek için)' : ' *'}: hazır yığılmış MP4, saydam WebM, ProRes 4444 .mov ya da SVGA</span>
          <input type="file" accept=".mp4,.webm,.mov,.svga,video/mp4,video/webm,video/quicktime" onChange=${(e) => pickVideo(e.target.files[0])} /></label>
        ${video?.kind === 'source' && html`<small class="muted">Kaydedince uygulamanın sunucusu videoyu çevirir (birkaç dakika). Çevrilene kadar eskisi oynar.</small>`}
        <h3>İsim plakası</h3>
        <small class="muted">Odaya girenin adı buraya yazılır. Animasyonda isim alanını boş bırakın; uzun adlar plakaya sığacak kadar küçülür.</small>
        <label class="field"><span>Örnek ad</span><input value=${sample} maxlength="24" onInput=${(e) => setSample(e.target.value)} /></label>
        ${slider('x', 'Yatay yer', 0, 1, 0.005)}
        ${slider('y', 'Dikey yer', 0, 1, 0.005)}
        ${slider('w', 'Plaka genişliği', P.wMin, P.wMax, 0.005)}
        ${slider('size', 'Yazı boyu', P.sizeMin, P.sizeMax, 0.001)}
        <div class="row gap">
          <label class="field inline"><span>Renk</span><input type="color" value=${v.plate.color} onInput=${(e) => setPlate('color', e.target.value.toUpperCase())} /></label>
          <label class="field inline"><span>Kalın</span><input type="checkbox" checked=${v.plate.bold} onChange=${(e) => setPlate('bold', e.target.checked)} /></label>
        </div>
      </div>
    </div>`}
    <div class="row gap end">
      ${busy && html`<small class="muted">${busy}</small>`}
      <${Button} onClick=${onClose}>Vazgeç</${Button}>
      <${Button} kind="primary" onClick=${save} disabled=${!!busy || (!item && own && ((kind === 'frame' && !art) || (kind === 'entry' && !video)))}>Kaydet</${Button}>
    </div>
  </${Modal}>`;
}
