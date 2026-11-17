// Uygulama › Mağaza: the Similar Club app's shop frames, entry effects, chat bubbles and voice waves (the app's
// server/api/shop-items.mjs; server/app-admin.ts passes the calls on as the signed-in panel user). The app's own items
// change (name, price, days, VIP level, on the shelf, order) and go back to the app's values; the team adds its own:
//   - a frame: a transparent square PNG/WebP drawn around the photo, with how big the photo's hole is;
//   - an entry effect: a video (a ready stacked MP4, or a transparent WebM, ProRes .mov or SVGA the app's server converts,
//     as a gift's) and its name plate: where the entering person's name is written over it, how wide it may be (a long
//     name is drawn smaller), how big, which colour;
//   - a chat bubble: two colours and the text's, or a picture (made at 3×) stretched round the message with its
//     corners kept (how far in each corner goes is set here; the browser draws it the same way, border-image);
//   - a voice wave: a style the app draws and its colours; the sparkle style's sparks may be a picture.
// Phones read the shop from the server (a new APK); older APKs keep their compiled shop.
import { Badge, Button, Card, Loading, Modal, Page, Tabs, act, html, num, post, searchable, useApi, useApp, useEffect, useRef, useState } from '../lib.js';
import { Stage, typeOf, upload, videoKindOf } from './app-gifts.js';

const KINDS = [
  ['entry', 'Giriş efektleri'],
  ['frame', 'Çerçeveler'],
  ['bubble', 'Sohbet balonları'],
  ['wave', 'Ses dalgaları'],
];
const NEW_LABEL = { entry: 'Yeni giriş efekti', frame: 'Yeni çerçeve', bubble: 'Yeni sohbet balonu', wave: 'Yeni ses dalgası' };
const KIND_HELP = {
  entry: 'Sizin eklediğiniz giriş efektlerinde odaya girenin adı isim plakasına yazılır.',
  frame: 'Çerçeve resmi saydam, kare PNG ya da WebP olmalı; fotoğraf ortadaki boşluğa oturur.',
  bubble: 'Balon iki renkle ya da bir resimle olur. Resmin köşeleri bozulmaz, ortası mesaja göre uzar.',
  wave: 'Dalga, konuşanın koltuğundaki halkadır; sese göre büyür. Stil ve renk seçilir; Parıltı stilinde dönen şekiller resim olabilir.',
};
/** The app's own bubbles and waves as the app draws them (app/src/data/catalog.ts, components/room/voice-wave.tsx): a preview only. */
const APP_LOOKS = {
  'bb-candy': { colors: ['#F472B6', '#FB7185'], text: '#FFFFFF' },
  'bb-galaxy': { colors: ['#312E81', '#7C3AED'], text: '#FFFFFF' },
  'bb-gold': { colors: ['#B45309', '#F59E0B'], text: '#FFFFFF' },
  'wv-sparkle': { style: 'sparkle', colors: ['#FF5FA2', '#FFFFFF'] },
  'wv-flame': { style: 'double', colors: ['#FF8A3D', '#FF3B30'] },
  'wv-rainbow': { style: 'spin', colors: ['#FF3B30', '#FFD60A', '#13D9DF', '#3D9BFF'] },
  'wv-gold': { style: 'ripple', colors: ['#F6BD60'] },
};
/** A bubble's picture is made at 3× (a phone's screen): the phone draws one of its pixels as a third of a point. */
const BUBBLE_SCALE = 1 / 3;
const SHORT = 'Merhaba 👋';
const LONG = 'Bu akşam saat 9’da odada buluşuyoruz, herkes gelsin! 🎉';
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

/** A chat message in this bubble on the room's dark ground, as the phone draws it (its picture: border-image). */
function BubbleSample({ look, src, text = SHORT }) {
  const s = look?.slice;
  if (src && s) {
    const k = BUBBLE_SCALE;
    return html`<div
      class="shop-bubble art"
      style=${`color:${look.text};border-width:${s.t * k}px ${s.r * k}px ${s.b * k}px ${s.l * k}px;border-image:url("${src}") ${s.t} ${s.r} ${s.b} ${s.l} fill / ${s.t * k}px ${s.r * k}px ${s.b * k}px ${s.l * k}px stretch`}
    >${text}</div>`;
  }
  const c = look?.colors ?? ['#334155', '#334155'];
  return html`<div class="shop-bubble" style=${`color:${look?.text ?? '#FFFFFF'};background:linear-gradient(90deg, ${c[0]}, ${c[1]})`}>${text}</div>`;
}
const bubbleStage = (look, src) => html`<div class="bubble-stage">
  <${BubbleSample} look=${look} src=${src} />
  <${BubbleSample} look=${look} src=${src} text=${LONG} />
</div>`;

/** A face talking with this wave: the ring and its style's motion, sized as on a seat (CSS: .wave-*). */
function WaveSample({ look, src, size = 64 }) {
  const c = look?.colors ?? ['#FFFFFF'];
  const style = look?.style ?? 'ring';
  const ring = (color, cls = '') => html`<i class=${`wave-ring ${cls}`} style=${`border-color:${color};box-shadow:0 0 8px ${color}`}></i>`;
  const side = (i) => c[i % c.length];
  return html`<div class="wave-sample" style=${`width:${size}px;height:${size}px`} aria-label="Ses dalgası önizlemesi">
    ${style === 'spin' && html`<i class="wave-ring spin" style=${`border-color:${side(0)} ${side(1)} ${side(2)} ${side(3)};box-shadow:0 0 8px ${side(1)}`}></i>`}
    ${style === 'double' && [ring(c[1], 'outer'), ring(c[0])]}
    ${style === 'ripple' && [ring(c[0], 'ripple'), ring(c[0])]}
    ${(style === 'ring' || style === 'sparkle') && ring(c[0])}
    ${style === 'sparkle' &&
    html`<span class="wave-sparks">${[0, 90, 180, 270].map(
      (deg) => html`<span style=${`transform:rotate(${deg}deg)`}>${src ? html`<img src=${src} alt="" />` : html`<b style=${`background:${c[1]};box-shadow:0 0 6px ${c[1]}`}></b>`}</span>`,
    )}</span>`}
    <span class="wave-face">🙂</span>
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
    subtitle="Giriş efektleri, çerçeveler, sohbet balonları ve ses dalgaları: uygulamanın kendileri ve sizin eklediğiniz. Değişiklikler sunucuda hemen geçerli; yeni APK'da telefonlar mağazayı buradan gösterir."
    actions=${editing && html`<${Button} kind="primary" onClick=${() => setEdit({ kind })}>${NEW_LABEL[kind]}</${Button}>`}
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
          <small class="muted">${KIND_HELP[kind]}</small>
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
            ${x.kind === 'bubble' && (x.look || APP_LOOKS[x.id]) ? html`<div class="bubble-stage small"><${BubbleSample} look=${x.look ?? APP_LOOKS[x.id]} src=${x.art?.url} /></div>` : ''}
            ${x.kind === 'wave' && (x.look || APP_LOOKS[x.id]) ? html`<div class="bubble-stage small"><${WaveSample} look=${x.look ?? APP_LOOKS[x.id]} src=${x.art?.url} size=${48} /></div>` : ''}
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

/** A picture's size in the browser (a picked file, before the app's server measures it). */
async function sizeOf(src) {
  const img = new Image();
  img.src = src;
  await img.decode();
  return { w: img.naturalWidth, h: img.naturalHeight };
}
/** A third of each side, as the app's server starts a bubble's picture. */
const thirds = ({ w, h }) => ({ t: Math.floor(h / 3), r: Math.floor(w / 3), b: Math.floor(h / 3), l: Math.floor(w / 3) });
/** A wave's colours fitted to a style's count (more: the last ones go; fewer: the last is repeated). */
function fitColors(colors, [lo, hi]) {
  const out = colors.slice(0, hi);
  while (out.length < lo) out.push(out.at(-1) ?? '#FFFFFF');
  return out;
}

/** Adding or changing an item. The app's own: name, price, days, VIP and on/off only. */
function Editor({ item, kind, limits, convert, svga, onClose, onSaved }) {
  const own = !item?.builtin;
  const looks = kind === 'bubble' || kind === 'wave';
  // A bubble's or wave's colours (and style); a bubble's picture's size and corners.
  const [look, setLook] = useState(() => {
    const l = item?.look ?? limits.lookDefault?.[kind] ?? null;
    return l ? { ...l, colors: [...l.colors] } : null;
  });
  const [dims, setDims] = useState(() => (item?.look?.slice ? { w: item.look.slice.w, h: item.look.slice.h } : null));
  const [slice, setSlice] = useState(() => (item?.look?.slice ? { t: item.look.slice.t, r: item.look.slice.r, b: item.look.slice.b, l: item.look.slice.l } : null));
  const setColor = (i, c) => setLook((x) => ({ ...x, colors: x.colors.map((y, j) => (j === i ? c : y)) }));
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
    if (!typeOf('shopframe', file)) return alert('Resim PNG ya da WebP olmalı');
    const max = kind === 'bubble' ? limits.bubbleBytes : kind === 'wave' ? limits.sparkBytes : limits.frameBytes;
    if (file.size > max) return alert(`Resim en fazla ${max >= 1024 * 1024 ? `${Math.round(max / 1024 / 1024)} MB` : `${Math.round(max / 1024)} KB`} olabilir`);
    setBusy('Resim yükleniyor…');
    try {
      const local = URL.createObjectURL(file);
      if (kind === 'bubble') {
        const d = await sizeOf(local);
        if (d.w < limits.bubblePxMin || d.h < limits.bubblePxMin || d.w > limits.bubblePxMax || d.h > limits.bubblePxMax)
          throw new Error(`Balon resmi her yönde ${limits.bubblePxMin}–${limits.bubblePxMax} piksel olmalı (bu ${d.w} × ${d.h})`);
        setDims(d);
        setSlice(thirds(d));
      }
      setArt(await upload('shopframe', file));
      setArtShown(local);
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
  const removeArt = () => {
    setArt(null);
    setArtShown(null);
    setDims(null);
    setSlice(null);
  };
  const save = async () => {
    const body = { name: v.name, price: Number(v.price), days: Number(v.days), minVip: Number(v.minVip), enabled: v.enabled };
    if (own && kind === 'frame') Object.assign(body, { hole: Number(v.hole), ...(art && art !== item?.art?.url ? { art } : {}) });
    if (own && looks) {
      // The picture: a new one goes with its address; one taken away as null; the one in use isn't sent.
      const artNow = art !== (item?.art?.url ?? null) ? { art } : {};
      const sl = kind === 'bubble' && art && slice ? { slice: { t: Number(slice.t), r: Number(slice.r), b: Number(slice.b), l: Number(slice.l) } } : {};
      Object.assign(body, { look: kind === 'bubble' ? { colors: look.colors, text: look.text, ...sl } : { style: look.style, colors: look.colors }, ...artNow });
    }
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
  return html`<${Modal} title=${item ? `${item.name} · düzenle` : NEW_LABEL[kind]} onClose=${onClose} wide>
    <div class="grid2" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px">
      <label class="field"><span>Ad *</span><input value=${v.name} maxlength=${limits.nameMax} onInput=${(e) => set('name', e.target.value)} /></label>
      <label class="field"><span>Fiyat (jeton) *</span><input type="number" min="1" value=${v.price} onInput=${(e) => set('price', e.target.value)} /></label>
      <label class="field"><span>Süre (gün; 0 = süresiz)</span><input type="number" min="0" max=${limits.daysMax} value=${v.days} onInput=${(e) => set('days', e.target.value)} /></label>
      <label class="field"><span>VIP seviyesi (0 = herkes)</span><input type="number" min="0" max=${limits.vipMax} value=${v.minVip} onInput=${(e) => set('minVip', e.target.value)} /></label>
    </div>
    <label class="field inline" style="margin-top:6px"><span>Satışta</span><input type="checkbox" checked=${v.enabled} onChange=${(e) => set('enabled', e.target.checked)} /></label>
    ${!own && html`<p class="note">Uygulamanın kendi eşyasının görünüşü uygulamada. Yeni görünüşle bir eşya için "${NEW_LABEL[kind]}" ekleyin.</p>`}
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
    ${own && kind === 'bubble' && look && html`<${BubbleEditor} look=${look} setLook=${setLook} setColor=${setColor} src=${artShown} dims=${dims} slice=${slice} setSlice=${setSlice} pickArt=${pickArt} removeArt=${removeArt} limits=${limits} />`}
    ${own && kind === 'wave' && look && html`<${WaveEditor} look=${look} setLook=${setLook} setColor=${setColor} src=${artShown} pickArt=${pickArt} removeArt=${removeArt} limits=${limits} />`}
    <div class="row gap end">
      ${busy && html`<small class="muted">${busy}</small>`}
      <${Button} onClick=${onClose}>Vazgeç</${Button}>
      <${Button} kind="primary" onClick=${save} disabled=${!!busy || (!item && own && ((kind === 'frame' && !art) || (kind === 'entry' && !video)))}>Kaydet</${Button}>
    </div>
  </${Modal}>`;
}

const colorInput = (label, value, onInput) => html`<label class="field inline"><span>${label}</span><input type="color" value=${value} onInput=${(e) => onInput(e.target.value.toUpperCase())} /></label>`;

/** A bubble's colours, text colour and picture with its corners, and the bubble round a short and a long message. */
function BubbleEditor({ look, setLook, setColor, src, dims, slice, setSlice, pickArt, removeArt, limits }) {
  const shown = src && dims && slice ? { ...look, slice: { ...dims, ...slice } } : { ...look, slice: undefined };
  const corner = (k, label, max) => html`<label class="field">
    <span>${label}: ${slice[k]} px</span>
    <input type="range" min="1" max=${max} step="1" value=${slice[k]} onInput=${(e) => setSlice((x) => ({ ...x, [k]: Number(e.target.value) }))} />
  </label>`;
  // The guide: the picture with the lines where the corners end (what lies between them stretches).
  const scale = dims ? Math.min(1, 280 / dims.w, 160 / dims.h) : 1;
  return html`<div class="row gap wrap" style="align-items:flex-start;margin-top:10px">
    ${bubbleStage(shown, src)}
    <div class="stack" style="flex:1;min-width:240px">
      <div class="row gap wrap">
        ${colorInput('1. renk', look.colors[0], (c) => setColor(0, c))}
        ${colorInput('2. renk', look.colors[1], (c) => setColor(1, c))}
        ${colorInput('Yazı rengi', look.text, (c) => setLook((x) => ({ ...x, text: c })))}
      </div>
      <small class="muted">Tek renk için iki rengi aynı seçin. Resim varsa renkler yalnız resim açılamazsa görünür.</small>
      <label class="field"><span>Balon resmi (isteğe bağlı; PNG ya da WebP, her yönde ${limits.bubblePxMin}–${limits.bubblePxMax} px, telefon için 3 kat büyük hazırlayın)</span>
        <input type="file" accept="image/png,image/webp" onChange=${(e) => pickArt(e.target.files[0])} /></label>
      ${src && html`<div><${Button} kind="ghost" onClick=${removeArt}>Resmi kaldır (yalnız renkler)</${Button}></div>`}
      ${src &&
      dims &&
      slice &&
      html`<h3>Köşeler</h3>
        <small class="muted">Çizgilerin dışındaki köşeler olduğu gibi kalır; aradaki kısım mesaja göre uzar ve mesaj ortaya yazılır. Süsleri köşelere koyun.</small>
        <div class="slice-guide" style=${`width:${dims.w * scale}px;height:${dims.h * scale}px`}>
          <img src=${src} alt="" />
          <i class="h" style=${`top:${slice.t * scale}px`}></i>
          <i class="h" style=${`top:${(dims.h - slice.b) * scale}px`}></i>
          <i class="v" style=${`left:${slice.l * scale}px`}></i>
          <i class="v" style=${`left:${(dims.w - slice.r) * scale}px`}></i>
        </div>
        ${corner('t', 'Üst', dims.h - slice.b - 2)}
        ${corner('b', 'Alt', dims.h - slice.t - 2)}
        ${corner('l', 'Sol', dims.w - slice.r - 2)}
        ${corner('r', 'Sağ', dims.w - slice.l - 2)}`}
    </div>
  </div>`;
}

/** A wave's style and colours, its sparks' picture for the sparkle style, and a talking face with it. */
function WaveEditor({ look, setLook, setColor, src, pickArt, removeArt, limits }) {
  const styles = limits.waveStyles;
  const [lo, hi] = styles[look.style].colors;
  const setStyle = (style) => {
    if (style !== 'sparkle' && src && !confirm('Resim yalnız Parıltı stilinde kullanılır. Resim kaldırılsın mı?')) return;
    if (style !== 'sparkle' && src) removeArt();
    setLook((x) => ({ style, colors: fitColors(x.colors, styles[style].colors) }));
  };
  return html`<div class="row gap wrap" style="align-items:flex-start;margin-top:10px">
    <div class="bubble-stage wave"><${WaveSample} look=${look} src=${look.style === 'sparkle' ? src : null} size=${96} /></div>
    <div class="stack" style="flex:1;min-width:240px">
      <label class="field"><span>Stil</span>
        <select value=${look.style} onChange=${(e) => setStyle(e.target.value)}>
          ${Object.entries(styles).map(([k, x]) => html`<option value=${k}>${x.name}</option>`)}
        </select></label>
      <small class="muted">${
        { ring: 'Halka: tek renk, sese göre büyür.', double: 'Çift halka: içteki 1. renk; dıştaki 2. renk sesle daha çok açılır.', spin: 'Dönen renkler: halka 2–4 renkle döner.', ripple: 'Yayılan halka: halkadan dışa doğru dalgalar yayılır.', sparkle: 'Parıltı: halkada dört şekil döner; 2. renk ya da resim.' }[look.style]
      }</small>
      <div class="row gap wrap">
        ${look.colors.map((c, i) => colorInput(look.style === 'sparkle' ? (i ? 'Parıltı' : 'Halka') : `${i + 1}. renk`, c, (x) => setColor(i, x)))}
        ${look.colors.length < hi && html`<${Button} kind="ghost" onClick=${() => setLook((x) => ({ ...x, colors: [...x.colors, x.colors.at(-1)] }))}>+ renk</${Button}>`}
        ${look.colors.length > lo && html`<${Button} kind="ghost" onClick=${() => setLook((x) => ({ ...x, colors: x.colors.slice(0, -1) }))}>− renk</${Button}>`}
      </div>
      ${look.style === 'sparkle' &&
      html`<label class="field"><span>Parıltı resmi (isteğe bağlı; saydam PNG ya da WebP, ${limits.sparkPxMin}–${limits.sparkPxMax} px: kalp, yıldız…)</span>
          <input type="file" accept="image/png,image/webp" onChange=${(e) => pickArt(e.target.files[0])} /></label>
        ${src && html`<div><${Button} kind="ghost" onClick=${removeArt}>Resmi kaldır (renkli noktalar)</${Button}></div>`}`}
    </div>
  </div>`;
}
