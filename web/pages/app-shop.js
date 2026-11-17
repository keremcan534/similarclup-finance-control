// Uygulama › Mağaza: the Similar Club app's shop frames, entry effects, chat bubbles and voice waves (the app's
// server/api/shop-items.mjs; server/app-admin.ts passes the calls on as the signed-in panel user). The app's own items
// change (name, price, days, VIP level, on the shelf, order) and go back to the app's values; the team adds its own:
//   - a frame: a transparent square PNG/WebP drawn around the photo, with how big the photo's hole is (measured from
//     the picture's clear middle when one is picked), and a moving version (an animated WebP) the new app plays; a
//     whole set at once ("Toplu çerçeve ekle": a designer's folder, each frame's still and moving file paired by name);
//   - an entry effect: a video (a ready stacked MP4, or a transparent WebM, ProRes .mov or SVGA the app's server converts,
//     as a gift's), its name plate: where the entering person's name is written over it (dragged on the preview, or
//     the sliders), how wide it may be (a long name is drawn smaller), how big, which colour, and how it looks and when
//     it shows (written or not, capitals, letter spacing, shadow or glow, outline, a band behind it, the seconds of
//     the clip and how it comes in: the preview plays the video with its controls and times the name the same way),
//     and an icon the shop shows for it;
//   - a chat bubble: two colours and the text's, or a picture (made at 3×) stretched round the message with its
//     corners kept (how far in each corner goes is set here; the browser draws it the same way, border-image);
//   - a voice wave: a style the app draws and its colours; the sparkle style's sparks may be a picture;
//   - a seat color (Koltuk renkleri): the colour of a room's empty mics, which a room's owner buys for the room for its
//     days. The app tints one pouf picture with it (its gold kept), so any colour works; this page draws it the same
//     way (web/img, a CSS mask). The default (silver) is every room's, free: its name and colour change, nothing else.
// Phones read the shop from the server (a new APK); older APKs keep their compiled shop.
import { Badge, Button, Card, Loading, Modal, Page, Tabs, act, html, num, post, searchable, toast, useApi, useApp, useEffect, useRef, useState } from '../lib.js';
import { Stage, typeOf, upload, videoKindOf } from './app-gifts.js';

const KINDS = [
  ['entry', 'Giriş efektleri'],
  ['frame', 'Çerçeveler'],
  ['bubble', 'Sohbet balonları'],
  ['wave', 'Ses dalgaları'],
  ['seat', 'Koltuk renkleri'],
];
const NEW_LABEL = { entry: 'Yeni giriş efekti', frame: 'Yeni çerçeve', bubble: 'Yeni sohbet balonu', wave: 'Yeni ses dalgası', seat: 'Yeni koltuk rengi' };
const KIND_HELP = {
  entry: 'Sizin eklediğiniz giriş efektlerinde odaya girenin adı isim plakasına yazılır.',
  frame: 'Çerçeve resmi saydam, kare PNG ya da WebP olmalı; fotoğraf ortadaki boşluğa oturur.',
  bubble: 'Balon iki renkle ya da bir resimle olur. Resmin köşeleri bozulmaz, ortası mesaja göre uzar.',
  wave: 'Dalga, konuşanın koltuğundaki halkadır; sese göre büyür. Stil ve renk seçilir; Parıltı stilinde dönen şekiller resim olabilir.',
  seat: 'Odadaki boş mikrofonların rengi. Oda sahibi rengi odası için alır; süresi bitince oda varsayılan renge döner. Varsayılan renk her odanın, ücretsiz.',
};
/** Soft colours to start from (the app's own seat colours and a few more in the same tone). */
const SEAT_SWATCHES = ['#D5DAE1', '#F4B6C8', '#D2453F', '#EE9447', '#9C9A6A', '#46B3B0', '#8FA7C8', '#B7A2D6', '#C9A27E', '#7A8C6E', '#5E6B8A', '#E3C77A'];
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
const FIELD_TR = { name: 'ad', price: 'fiyat', days: 'süre', minVip: 'VIP', enabled: 'rafta / kapalı', look: 'renk' };
const daysText = (d) => (d ? `${num(d)} gün` : 'süresiz');
const pct = (x) => `${Math.round(x * 1000) / 10}`;
const SAMPLE = 'KaaN';
const sec = (s) => (Math.round(s * 10) / 10).toLocaleString('tr-TR', { minimumFractionDigits: 1 });
const ANIM_TR = { none: 'Hemen', fade: 'Solarak', zoom: 'Büyüyerek', rise: 'Yükselerek' };
/** What a plate saved before its look and timing is read with, as the phones read it (app lib/shop-live-core PLATE_LOOK). */
const PLATE_LOOK = { show: true, upper: false, spacing: 0, shadow: { color: '#000000', size: 0.1 }, outline: null, back: null, from: 0, to: 0, anim: 'none' };
const plateIn = (p) => ({ ...PLATE_LOOK, ...p });
/** What a switched-on shadow, outline or band starts as. */
const PAINT_START = { shadow: { color: '#000000', size: 0.1 }, outline: { color: '#000000', size: 0.05 }, back: { color: '#000000', alpha: 0.45 } };
/** How long the name takes to come in and go, as the phones draw it (app components/fx/video-fx PLATE_IN_MS). */
const IN_S = 0.35;
const OUT_S = 0.3;
/** The eight ways round a letter the phones draw the outline (app components/fx/video-fx AROUND). */
const AROUND = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.71, 0.71], [-0.71, 0.71], [0.71, -0.71], [-0.71, -0.71]];
/** The stage: the 540 × 960 frame the plate is set in, at half size. */
const W = 270;
const H = 480;

/** Capitals the Turkish way (i → İ, ı → I), as the phones write them. */
const trUpper = (s) => s.replace(/i/g, 'İ').replace(/ı/g, 'I').toUpperCase();
/** How much of the name shows `t` seconds into the clip (0–1), timed as the phones time it. */
function shownAt(plate, t) {
  if (t < plate.from) return 0;
  const k = plate.anim === 'none' ? 0 : 1;
  if (plate.to && t >= plate.to) return k ? Math.max(0, 1 - (t - plate.to) / OUT_S) : 0;
  return k ? Math.min(1, (t - plate.from) / IN_S) : 1;
}
/** The name as the phone writes it on the plate: the plate's size, smaller until it fits the plate's width (one line). */
function plateFont(text, plate) {
  const c = plateFont.c ?? (plateFont.c = document.createElement('canvas').getContext('2d'));
  let px = plate.size * H;
  const fit = plate.w * W;
  c.font = `${plate.bold ? 800 : 500} ${px}px system-ui, sans-serif`;
  const width = c.measureText(text).width + [...text].length * plate.spacing * px;
  if (width > fit) px = Math.max(8, (px * fit) / width);
  return px;
}
/** The outline (on top) and the shadow or glow round the letters, as the phones draw them in layers. */
function plateShadow(plate, px) {
  const out = [];
  if (plate.outline) {
    const d = Math.max(1, plate.outline.size * px);
    for (const [x, y] of AROUND) out.push(`${(x * d).toFixed(2)}px ${(y * d).toFixed(2)}px 0 ${plate.outline.color}`);
  }
  if (plate.shadow) out.push(`0 0 ${(plate.shadow.size * px).toFixed(2)}px ${plate.shadow.color}`);
  return out.length ? out.join(', ') : 'none';
}
const withAlpha = (hex, a) => `${hex}${Math.round(a * 255).toString(16).padStart(2, '0')}`;
const round3 = (n) => Math.round(n * 1000) / 1000;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/**
 * The video stage with the name over it at the plate's place, as a phone shows someone entering: the name's look, and
 * its coming and going at the video's time. Under it, the video's controls (play and pause, from the start, loop,
 * sound, the time bar). With `onPlate` (the editor) the name is placed by hand: dragged, put where the stage is
 * clicked, nudged with the arrow keys (Shift: further), and the corner handle widens the plate and grows the letters;
 * while the video stands still or the name is being moved, a name not on show at that moment is drawn faint so it can
 * still be placed, and "görünsün" / "kaybolsun" set its seconds to the moment shown.
 */
function PlateStage({ src, plate, name, onPlate, limits }) {
  const edit = !!onPlate;
  const text = plate.upper ? trUpper(name || SAMPLE) : name || SAMPLE;
  const px = plateFont(text, plate);
  const stage = useRef(null);
  const drag = useRef(null);
  const vid = useRef(null);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [paused, setPaused] = useState(false);
  const [moving, setMoving] = useState(false);
  const [loop, setLoop] = useState(edit);
  const [muted, setMuted] = useState(edit);
  // The video's time, every frame while the stage is up: it times the name and moves the bar.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = vid.current;
      if (v) {
        setT(v.currentTime);
        setPaused(v.paused);
        if (Number.isFinite(v.duration)) setDur(v.duration);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const play = () => {
    const v = vid.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };
  const again = () => {
    const v = vid.current;
    if (!v) return;
    v.currentTime = 0;
    v.play().catch(() => {});
  };
  const seek = (s) => vid.current && (vid.current.currentTime = s);

  const P = limits?.plate;
  const at = (e) => {
    const r = stage.current.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const grab = (mode) => (e) => {
    if (!edit || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const p0 = at(e);
    const from = { x: plate.x, y: plate.y, w: plate.w, size: plate.size };
    // A click on the stage puts the name there and goes on moving it.
    if (mode === 'place') Object.assign(from, { x: clamp(p0.x, 0, 1), y: clamp(p0.y, 0, 1) });
    if (mode === 'place') onPlate({ x: round3(from.x), y: round3(from.y) });
    drag.current = { mode: mode === 'size' ? 'size' : 'move', p0, from };
    stage.current.setPointerCapture(e.pointerId);
    setMoving(true);
  };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    const p = at(e);
    const dx = p.x - d.p0.x;
    const dy = p.y - d.p0.y;
    if (d.mode === 'move') onPlate({ x: round3(clamp(d.from.x + dx, 0, 1)), y: round3(clamp(d.from.y + dy, 0, 1)) });
    // The handle is the box's corner: the box grows both ways from its centre, its height is 1.8 letters.
    else onPlate({ w: round3(clamp(d.from.w + 2 * dx, P.wMin, P.wMax)), size: round3(clamp(d.from.size + (2 * dy) / 1.8, P.sizeMin, P.sizeMax)) });
  };
  const drop = () => {
    drag.current = null;
    setMoving(false);
  };
  const nudge = (e) => {
    const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!k) return;
    e.preventDefault();
    const step = e.shiftKey ? 0.025 : 0.005;
    onPlate({ x: round3(clamp(plate.x + k[0] * step, 0, 1)), y: round3(clamp(plate.y + k[1] * step, 0, 1)) });
  };

  // As the phone shows it at this moment; in the editor, standing still or moving it, faint rather than gone.
  const a = src ? shownAt(plate, t) : 1;
  const real = !edit || (!paused && !moving);
  const opacity = real ? a : Math.max(a, 0.35);
  const motion = real && plate.anim === 'zoom' ? `scale(${0.5 + 0.5 * a})` : real && plate.anim === 'rise' ? `translateY(${(1 - a) * px}px)` : '';
  const band = plate.back ? `background:${withAlpha(plate.back.color, plate.back.alpha)};padding:0.25em 0.5em;border-radius:999px;line-height:1;` : '';
  return html`<div class="plate-side">
    <div
      ref=${stage}
      class=${`plate-stage${edit ? ' edit' : ''}`}
      style=${`width:${W}px;height:${H}px`}
      onPointerDown=${edit ? grab('place') : undefined}
      onPointerMove=${edit ? move : undefined}
      onPointerUp=${edit ? drop : undefined}
      onPointerCancel=${edit ? drop : undefined}
    >
      ${src ? html`<${Stage} key=${src} src=${src} loop=${loop} muted=${muted} onVideo=${(v) => (vid.current = v)} />` : html`<div class="plate-empty muted">Video çevrilince burada oynar</div>`}
      ${plate.show &&
      html`<div
          class="plate-box"
          tabindex=${edit ? 0 : undefined}
          aria-label=${edit ? 'İsim plakası: sürükleyin ya da ok tuşlarıyla taşıyın' : undefined}
          onPointerDown=${edit ? grab('move') : undefined}
          onKeyDown=${edit ? nudge : undefined}
          style=${`left:${plate.x * 100}%;top:${plate.y * 100}%;width:${plate.w * 100}%;height:${plate.size * H * 1.8}px`}
        >
          ${edit && html`<i class="plate-handle" title="Plakayı genişlet, yazıyı büyüt" onPointerDown=${grab('size')}></i>`}
        </div>
        <div
          class="plate-name"
          style=${`left:${plate.x * 100}%;top:${plate.y * 100}%;max-width:${plate.w * 100}%;font-size:${px}px;color:${plate.color};font-weight:${plate.bold ? 800 : 500};letter-spacing:${plate.spacing * px}px;text-shadow:${plateShadow(plate, px)};opacity:${opacity};transform:translate(-50%, -50%) ${motion};${band}`}
        >${text}</div>`}
    </div>
    ${src &&
    html`<div class="plate-controls">
      <${Button} kind="ghost" onClick=${play}>${paused ? '▶ Oynat' : '⏸ Durdur'}</${Button}>
      <${Button} kind="ghost" onClick=${again}>↻ Baştan</${Button}>
      <label class="field inline"><span>Döngü</span><input type="checkbox" checked=${loop} onChange=${(e) => setLoop(e.target.checked)} /></label>
      <label class="field inline"><span>Ses</span><input type="checkbox" checked=${!muted} onChange=${(e) => setMuted(!e.target.checked)} /></label>
      <input type="range" min="0" max=${dur || 0} step="0.05" value=${t} onInput=${(e) => seek(Number(e.target.value))} aria-label="Videonun anı" />
      <small class="muted">${sec(t)} / ${sec(dur)} sn${plate.show && a === 0 ? ' · ad şu an görünmüyor' : ''}</small>
      ${edit &&
      plate.show &&
      html`<span class="row gap wrap">
        <small class="muted">Ad bu anda:</small>
        <${Button} kind="ghost" onClick=${() => onPlate({ from: Math.round(t * 10) / 10, ...(plate.to && plate.to < Math.round(t * 10) / 10 + 0.5 ? { to: 0 } : {}) })}>görünsün</${Button}>
        <${Button} kind="ghost" onClick=${() => onPlate({ to: Math.round(t * 10) / 10 })}>kaybolsun</${Button}>
      </span>`}
    </div>`}
  </div>`;
}

/**
 * A frame over a sample photo, as a seat or a profile shows it: the photo fills the frame's hole, at the hole's centre
 * (`at`, shares of the picture; the middle when there is none). The phone moves the picture instead; it looks the same.
 * With `onChange` the photo is placed by hand (the frame's picture lets the pointer through to it): dragged, or put
 * where the preview is clicked; sized by the dot on its rim or the mouse wheel; nudged with the arrow keys (Shift:
 * further), + and − size it. A dashed circle over the picture shows its edge. Each change goes out as `{ x, y }` or
 * `{ hole }`, within `limits`, the photo inside the picture.
 */
function FramePreview({ src, hole, at, size = 120, onChange, limits }) {
  const box = useRef(null);
  const drag = useRef(null);
  const edit = !!onChange;
  const photo = Math.round(size * hole * 2);
  const c = at ?? { x: 0.5, y: 0.5 };
  const round = (v) => Math.round(v * 1000) / 1000;
  const place = (x, y) => {
    const fit = (v) => round(clamp(clamp(v, limits.holeAtMin ?? 0.5, limits.holeAtMax ?? 0.5), hole, 1 - hole));
    onChange({ x: fit(x), y: fit(y) });
  };
  const resize = (h) => onChange({ hole: round(clamp(Math.min(h, c.x, 1 - c.x, c.y, 1 - c.y), limits.holeMin, limits.holeMax)) });
  const point = (e) => {
    const r = box.current.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const grab = (mode) => (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const p = point(e);
    if (mode === 'place') place(p.x, p.y);
    // Moving keeps where the photo was taken hold of under the pointer; a click elsewhere starts from its centre.
    drag.current = { mode: mode === 'size' ? 'size' : 'move', dx: mode === 'move' ? p.x - c.x : 0, dy: mode === 'move' ? p.y - c.y : 0 };
    box.current.setPointerCapture(e.pointerId);
    box.current.focus();
  };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    const p = point(e);
    if (d.mode === 'move') place(p.x - d.dx, p.y - d.dy);
    else resize(Math.hypot(p.x - c.x, p.y - c.y));
  };
  const drop = () => (drag.current = null);
  const wheel = (e) => {
    e.preventDefault();
    resize(hole + (e.deltaY < 0 ? 0.005 : -0.005));
  };
  const key = (e) => {
    const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    const step = e.shiftKey ? 0.02 : 0.003;
    if (k) place(c.x + k[0] * step, c.y + k[1] * step);
    else if (e.key === '+' || e.key === '=') resize(hole + 0.005);
    else if (e.key === '-') resize(hole - 0.005);
    else return;
    e.preventDefault();
  };
  const circle = `left:${c.x * size - photo / 2}px;top:${c.y * size - photo / 2}px;width:${photo}px;height:${photo}px`;
  const dot = `left:${c.x * size + (photo / 2) * Math.SQRT1_2 - 6}px;top:${c.y * size + (photo / 2) * Math.SQRT1_2 - 6}px`;
  return html`<div
    ref=${box}
    class=${`frame-preview${edit ? ' edit' : ''}`}
    style=${`width:${size}px;height:${size}px`}
    tabindex=${edit ? 0 : undefined}
    title=${edit ? 'Fotoğrafı sürükleyin; noktadan ya da tekerlekle büyütün; ok tuşları ince ayar yapar' : undefined}
    onPointerDown=${edit ? grab('place') : undefined}
    onPointerMove=${edit ? move : undefined}
    onPointerUp=${edit ? drop : undefined}
    onPointerCancel=${edit ? drop : undefined}
    onWheel=${edit ? wheel : undefined}
    onKeyDown=${edit ? key : undefined}
  >
    <div class="frame-photo" style=${`position:absolute;${circle}`}>🙂</div>
    ${src && html`<img src=${src} alt="" width=${size} height=${size} />`}
    ${edit && html`<i class="frame-guide" style=${circle} onPointerDown=${grab('move')}></i><i class="frame-handle" style=${dot} onPointerDown=${grab('size')}></i>`}
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

/**
 * An empty (or locked) mic seat in a colour as the app draws it (app components/room/seat-pouf): the pouf's cushion in
 * the colour (its shape as a mask), its light and shade over it, its gold as it is.
 */
function SeatPreview({ color, size = 64, locked = false }) {
  const s = locked ? 'kilitli' : 'bos';
  const mask = `url(/img/koltuk-${s}-renk.png)`;
  return html`<div class="seat-preview" style=${`width:${size}px;height:${size}px`} aria-label="Koltuk önizlemesi">
    <i style=${`background:${color};-webkit-mask-image:${mask};mask-image:${mask}`}></i>
    <img src=${`/img/koltuk-${s}-isik.png`} alt="" />
    <img src=${`/img/koltuk-${s}-altin.png`} alt="" />
  </div>`;
}

export function AppShop() {
  const { can, meta } = useApp();
  const list = useApi(meta.app_link ? '/api/app/shop' : null);
  const [kind, setKind] = useState('entry');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);
  const [play, setPlay] = useState(null);
  const [bulk, setBulk] = useState(false);
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
    const kept = x.kind === 'seat' ? 'Alan odalar süresi bitene kadar kullanır.' : 'Alanlarda kalır ve kullanılır.';
    if (!confirm(x.enabled ? `“${x.name}” satıştan kaldırılsın mı? ${kept}` : `“${x.name}” yeniden satışa çıksın mı?`)) return;
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
    subtitle="Giriş efektleri, çerçeveler, sohbet balonları, ses dalgaları ve koltuk renkleri: uygulamanın kendileri ve sizin eklediğiniz. Değişiklikler sunucuda hemen geçerli; yeni APK'da telefonlar mağazayı buradan gösterir."
    actions=${editing &&
    html`${kind === 'frame' && list.data?.limits?.motionPxMin && html`<${Button} onClick=${() => setBulk(true)}>Toplu çerçeve ekle</${Button}>`}
      <${Button} kind="primary" onClick=${() => setEdit({ kind })}>${NEW_LABEL[kind]}</${Button}>`}
  >
    <${Loading} state=${list}>${(d) => {
      const w = searchable(q.trim());
      const items = d.items.filter((x) => x.kind === kind);
      const shown = items.filter((x) => !w || searchable(`${x.name} ${x.id}`).includes(w));
      return html`
        ${!d.storage && html`<div class="empty bad">Uygulamanın dosya deposu açık değil: resim ve video yüklenemez.</div>`}
        <${Tabs}
          tabs=${KINDS.filter(([k]) => k !== 'seat' || d.limits.seatDefault).map(([k, l]) => [k, `${l} (${d.items.filter((x) => x.kind === k).length})`])}
          value=${kind}
          onChange=${setKind}
        />
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
            ${x.art?.motion && html` <${Badge} s="info" label="Hareketli" />`}
            ${x.job?.status === 'processing' && html` <${Badge} s="pending" label="Video çevriliyor…" />`}
            ${x.job?.status === 'failed' && html` <${Badge} s="error" label="Video çevrilemedi" />`}`}
        >
          <div class="row gap" style="align-items:flex-start">
            ${x.kind === 'frame' && x.art ? html`<${FramePreview} src=${x.art.motion?.url ?? x.art.url} hole=${x.art.hole} at=${x.art.at} size=${88} />` : ''}
            ${x.kind === 'bubble' && (x.look || APP_LOOKS[x.id]) ? html`<div class="bubble-stage small"><${BubbleSample} look=${x.look ?? APP_LOOKS[x.id]} src=${x.art?.url} /></div>` : ''}
            ${x.kind === 'wave' && (x.look || APP_LOOKS[x.id]) ? html`<div class="bubble-stage small"><${WaveSample} look=${x.look ?? APP_LOOKS[x.id]} src=${x.art?.url} size=${48} /></div>` : ''}
            ${x.kind === 'entry' && x.icon ? html`<img class="shop-icon" src=${x.icon.url} alt="" title="Mağazadaki ikonu" />` : ''}
            ${x.kind === 'entry' && x.video ? html`<${Button} onClick=${() => setPlay(x)}>▶ Oynat</${Button}>` : ''}
            ${x.kind === 'seat' && x.look ? html`<${SeatPreview} color=${x.look.color} size=${64} />` : ''}
            <div class="stack" style="flex:1">
              ${x.kind === 'seat'
                ? html`<div>${x.default ? 'Ücretsiz · her odanın rengi' : `🪙 ${num(x.price)} · ${daysText(x.days)} · ${num(x.owners)} odada`}</div>`
                : html`<div>🪙 ${num(x.price)} · ${daysText(x.days)}${x.minVip ? ` · VIP ${x.minVip}+` : ''} · ${num(x.owners)} kişide</div>`}
              ${x.job?.status === 'failed' && html`<small class="bad">${x.job.error}</small>`}
              ${x.kind === 'seat' && x.default && html`<small class="muted">Her odanın varsayılan rengi: adı ve rengi değişir; fiyatı ve süresi olmaz, satıştan kalkmaz.</small>`}
              ${x.kind !== 'seat' && x.builtin && html`<small class="muted">Resmi ve animasyonu uygulamada; burada adı, fiyatı, süresi, VIP seviyesi ve satışta olup olmadığı değişir.</small>`}
            </div>
          </div>
          ${editing &&
          html`<div class="row gap wrap" style="margin-top:8px">
            <${Button} onClick=${() => setEdit(x)}>Düzenle</${Button}>
            ${!x.default && html`<${Button} onClick=${() => toggle(x)}>${x.enabled ? 'Satıştan kaldır' : 'Satışa çıkar'}</${Button}>`}
            <${Button} kind="ghost" onClick=${() => move(items, x, -1)} aria-label="Yukarı">↑</${Button}>
            <${Button} kind="ghost" onClick=${() => move(items, x, 1)} aria-label="Aşağı">↓</${Button}>
            ${x.builtin && x.changed?.length > 0 && html`<${Button} kind="ghost" onClick=${() => reset(x)}>Orijinaline dön</${Button}>`}
            ${!x.builtin && x.owners === 0 && html`<${Button} kind="danger" onClick=${() => remove(x)}>Sil</${Button}>`}
          </div>`}
        </${Card}>`)}</div>
        ${edit && html`<${Editor} item=${edit.id ? edit : null} kind=${edit.kind} limits=${d.limits} convert=${d.convert} svga=${d.svga} onClose=${() => setEdit(null)} onSaved=${() => (setEdit(null), done())} />`}
        ${play && html`<${Modal} title=${play.name} onClose=${() => setPlay(null)}><${PlateStage} src=${play.video.url} plate=${plateIn(play.plate ?? d.limits.plateDefault)} name=${SAMPLE} /></${Modal}>`}
        ${bulk && html`<${BulkFrames} limits=${d.limits} taken=${d.items.filter((x) => x.kind === 'frame').flatMap((x) => [x.name, x.original?.name].filter(Boolean))} onClose=${() => setBulk(false)} onDone=${done} />`}
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
/** A picked WebP's first bytes: whether it moves (VP8X's animation flag) and can be transparent; null: not a WebP. */
async function webpFlags(file) {
  const b = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const tag = (i) => String.fromCharCode(...b.slice(i, i + 4));
  if (b.length < 21 || tag(0) !== 'RIFF' || tag(8) !== 'WEBP') return null;
  return tag(12) === 'VP8X' ? { animated: (b[20] & 0x02) !== 0, alpha: (b[20] & 0x10) !== 0 } : { animated: false, alpha: tag(12) === 'VP8L' };
}
/**
 * A moving WebP's first frame as a PNG, for a frame that came without its still picture (older phones, "Düşük veri
 * modu" and small photos show the still one): the browser draws the first frame of an animated picture not on show.
 */
async function stillOf(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    const blob = await new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error('Hareketli resmin ilk karesi alınamadı'))), 'image/png'));
    return new File([blob], `${file.name.replace(/\.webp$/i, '')}_ilk_kare.png`, { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(url);
  }
}
/** The circle nearest to these points (least squares, Kåsa): its centre and radius; null when they don't make one. */
function circleThrough(pts) {
  const s = { xx: 0, xy: 0, x: 0, yy: 0, y: 0, xz: 0, yz: 0, z: 0 };
  for (const { x, y } of pts) {
    const z = x * x + y * y;
    s.xx += x * x;
    s.xy += x * y;
    s.x += x;
    s.yy += y * y;
    s.y += y;
    s.xz += x * z;
    s.yz += y * z;
    s.z += z;
  }
  const A = [[s.xx, s.xy, s.x], [s.xy, s.yy, s.y], [s.x, s.y, pts.length]];
  const b = [-s.xz, -s.yz, -s.z];
  const det = (M) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  const d = det(A);
  if (!d) return null;
  const [D, E, F] = [0, 1, 2].map((i) => det(A.map((row, r) => row.map((v, c) => (c === i ? b[r] : v)))) / d);
  const R = Math.sqrt((D * D + E * E) / 4 - F);
  return Number.isFinite(R) ? { x: -D / 2, y: -E / 2, R } : null;
}
/**
 * A frame picture's hole, where the photo goes: the ring's inner edge, found by rays from a centre out to the first
 * solid pixel, with a circle fitted through the points they reach. The rays a gem, a wing tip or a moon stops early
 * (much shorter than most) and those out through a gap (much longer) are left out, so a decoration reaching into the
 * ring doesn't shrink or push the photo: it lies over the photo's rim, as the designer drew it. The fit is repeated
 * from the circle's own centre; the photo's radius leaves four rays in five outside it. A designer's ring is often not
 * in the middle (a crown above, a name plate below): `x`, `y` is its centre and `hole` its radius, as shares of the
 * picture, in the sliders' steps, the photo inside the picture. Measured at up to 256 px.
 */
async function measureHole(src, limits) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const n = Math.min(256, img.naturalWidth);
  const c = document.createElement('canvas');
  c.width = n;
  c.height = n;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, n, n);
  const px = g.getImageData(0, 0, n, n).data;
  const K = 90;
  const ray = (ox, oy, a) => {
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let r = 0;
    for (; r < n; r += 0.5) {
      const x = Math.round(ox + r * dx);
      const y = Math.round(oy + r * dy);
      if (x < 0 || y < 0 || x >= n || y >= n || px[(y * n + x) * 4 + 3] > 40) break;
    }
    return { r, x: ox + r * dx, y: oy + r * dy };
  };
  const cast = (o) => Array.from({ length: K }, (_, k) => ray(o.x, o.y, (2 * Math.PI * k) / K));
  const mid = (n - 1) / 2;
  let o = { x: mid, y: mid };
  for (let i = 0; i < 4; i++) {
    const hits = cast(o);
    const med = [...hits.map((h) => h.r)].sort((a, b) => a - b)[K >> 1];
    const edge = hits.filter((h) => h.r > med * 0.8 && h.r < med * 1.2);
    const f = edge.length >= K / 3 ? circleThrough(edge) : null;
    if (!f || Math.hypot(f.x - mid, f.y - mid) > n * 0.2) break;
    o = { x: f.x, y: f.y };
  }
  const rs = cast(o)
    .map((h) => h.r)
    .sort((a, b) => a - b);
  const step = (v) => Math.round(v * 200) / 200;
  const lo = limits.holeAtMin ?? 0.5;
  const hi = limits.holeAtMax ?? 0.5;
  const x = clamp(step((o.x + 0.5) / n), lo, hi);
  const y = clamp(step((o.y + 0.5) / n), lo, hi);
  const hole = clamp(Math.min(step(rs[Math.floor(K * 0.2)] / n), x, 1 - x, y, 1 - y), limits.holeMin, limits.holeMax);
  return { hole, x, y };
}
/** A third of each side, as the app's server starts a bubble's picture. */
const thirds = ({ w, h }) => ({ t: Math.floor(h / 3), r: Math.floor(w / 3), b: Math.floor(h / 3), l: Math.floor(w / 3) });
/** A wave's colours fitted to a style's count (more: the last ones go; fewer: the last is repeated). */
function fitColors(colors, [lo, hi]) {
  const out = colors.slice(0, hi);
  while (out.length < lo) out.push(out.at(-1) ?? '#FFFFFF');
  return out;
}

/**
 * Adding or changing an item. The app's own: name, price, days, VIP and on/off only (a seat color its color too; the
 * default seat color its name and color alone).
 */
function Editor({ item, kind, limits, convert, svga, onClose, onSaved }) {
  const own = !item?.builtin;
  const looks = kind === 'bubble' || kind === 'wave';
  const seat = kind === 'seat';
  const isDefault = seat && !!item?.default;
  const [seatColor, setSeatColor] = useState(() => item?.look?.color ?? limits.lookDefault?.seat?.color ?? '#D5DAE1');
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
    holeX: item?.art?.at?.x ?? 0.5,
    holeY: item?.art?.at?.y ?? 0.5,
    plate: plateIn(item?.plate ?? limits.plateDefault),
  }));
  // An entry effect's icon: the address to save and what this page draws, as a frame's picture (`art`, `artShown`).
  const [icon, setIcon] = useState(item?.icon?.url ?? null);
  const [iconShown, setIconShown] = useState(item?.icon?.url ?? null);
  // `art`: the address to save (the app's, as the upload answered it); `artShown`: what this page draws (the panel's
  // copy of a saved one, or the picked file itself: the app's address is another origin, which the page doesn't load).
  const [art, setArt] = useState(item?.art?.url ?? null);
  const [artShown, setArtShown] = useState(item?.art?.url ?? null);
  // A frame's moving version (an animated WebP), the same way.
  const [motion, setMotion] = useState(item?.art?.motion?.url ?? null);
  const [motionShown, setMotionShown] = useState(item?.art?.motion?.url ?? null);
  const [video, setVideo] = useState(null);
  const [preview, setPreview] = useState(item?.video?.url ?? null);
  const [sample, setSample] = useState(SAMPLE);
  const [busy, setBusy] = useState(null);
  const set = (k, x) => setV((s) => ({ ...s, [k]: x }));
  const setPlate = (k, x) => setV((s) => ({ ...s, plate: { ...s.plate, [k]: x } }));
  const patchPlate = (o) => setV((s) => ({ ...s, plate: { ...s.plate, ...o } }));
  const localUrl = useRef(null);
  useEffect(() => () => localUrl.current && URL.revokeObjectURL(localUrl.current), []);

  const pickArt = async (file) => {
    if (!file) return;
    if (!typeOf('shopframe', file)) return alert('Resim PNG ya da WebP olmalı');
    const max = kind === 'bubble' ? limits.bubbleBytes : kind === 'wave' ? limits.sparkBytes : limits.frameBytes;
    if (file.size > max) return alert(`Resim en fazla ${max >= 1024 * 1024 ? `${Math.round(max / 1024 / 1024)} MB` : `${Math.round(max / 1024)} KB`} olabilir`);
    if (kind === 'frame' && (await webpFlags(file))?.animated) return alert('Bu resim hareketli: onu "Hareketli hali"ne yükleyin. Çerçeve resmi durağan bir PNG ya da WebP olmalı (eski telefonlar onu gösterir).');
    setBusy('Resim yükleniyor…');
    try {
      const local = URL.createObjectURL(file);
      // The photo's hole, measured from the picture's clear middle (the sliders fine-tune it).
      if (kind === 'frame') await measure(local);
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
  /** The hole's size and, where the app's server takes it, its place, measured from a frame's picture. */
  const measure = async (src) => {
    const m = await measureHole(src, limits);
    setV((s) => ({ ...s, hole: m.hole, ...(limits.holeAtMin ? { holeX: m.x, holeY: m.y } : {}) }));
  };
  const pickMotion = async (file) => {
    if (!file) return;
    const flags = await webpFlags(file);
    if (!flags?.animated) return alert('Hareketli hali hareketli bir WebP olmalı (GIF ya da SVGA değil). Tasarımcının "animated_webp" klasöründeki dosya.');
    if (!flags.alpha) return alert('Hareketli çerçevede saydamlık yok: ortası ve çevresi saydam olmalı');
    if (file.size > limits.motionBytes) return alert(`Hareketli çerçeve en fazla ${Math.round(limits.motionBytes / 1024 / 1024)} MB olabilir`);
    setBusy('Hareketli çerçeve yükleniyor…');
    try {
      const local = URL.createObjectURL(file);
      const d = await sizeOf(local);
      if (Math.abs(d.w - d.h) > Math.max(2, d.w * 0.02)) throw new Error(`Hareketli çerçeve kare olmalı (bu ${d.w} × ${d.h})`);
      if (d.w < limits.motionPxMin || d.w > limits.motionPxMax) throw new Error(`Hareketli çerçeve ${limits.motionPxMin}–${limits.motionPxMax} piksel olmalı (bu ${d.w})`);
      setMotion(await upload('shopframe', file));
      setMotionShown(local);
      // No still picture yet: the moving one's first frame becomes it (its hole measured from it).
      if (!art) await pickArt(await stillOf(file));
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  };
  const pickIcon = async (file) => {
    if (!file) return;
    if (!typeOf('shopframe', file)) return alert('İkon PNG ya da WebP olmalı');
    if (file.size > limits.iconBytes) return alert(`İkon en fazla ${Math.round(limits.iconBytes / 1024)} KB olabilir`);
    setBusy('İkon yükleniyor…');
    try {
      const local = URL.createObjectURL(file);
      const d = await sizeOf(local);
      if (d.w < limits.iconPxMin || d.h < limits.iconPxMin || d.w > limits.iconPxMax || d.h > limits.iconPxMax)
        throw new Error(`İkon her yönde ${limits.iconPxMin}–${limits.iconPxMax} piksel olmalı (bu ${d.w} × ${d.h})`);
      setIcon(await upload('shopframe', file));
      setIconShown(local);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  };
  const save = async () => {
    // A seat color has no VIP level; the default one only its name and color. Its color goes when it changed.
    const body = seat
      ? { name: v.name, ...(isDefault ? {} : { price: Number(v.price), days: Number(v.days), enabled: v.enabled }), ...(seatColor !== item?.look?.color ? { look: { color: seatColor } } : {}) }
      : { name: v.name, price: Number(v.price), days: Number(v.days), minVip: Number(v.minVip), enabled: v.enabled };
    if (own && kind === 'frame')
      Object.assign(body, {
        hole: Number(v.hole),
        ...(limits.holeAtMin ? { holeX: Number(v.holeX), holeY: Number(v.holeY) } : {}),
        ...(art && art !== item?.art?.url ? { art } : {}),
        ...(motion !== (item?.art?.motion?.url ?? null) ? { motion } : {}),
      });
    if (own && looks) {
      // The picture: a new one goes with its address; one taken away as null; the one in use isn't sent.
      const artNow = art !== (item?.art?.url ?? null) ? { art } : {};
      const sl = kind === 'bubble' && art && slice ? { slice: { t: Number(slice.t), r: Number(slice.r), b: Number(slice.b), l: Number(slice.l) } } : {};
      Object.assign(body, { look: kind === 'bubble' ? { colors: look.colors, text: look.text, ...sl } : { style: look.style, colors: look.colors }, ...artNow });
    }
    if (own && kind === 'entry') {
      const p = v.plate;
      const paint = (x, k) => x && { color: x.color, [k]: Number(x[k]) };
      const plate = { ...p, x: Number(p.x), y: Number(p.y), w: Number(p.w), size: Number(p.size), spacing: Number(p.spacing), shadow: paint(p.shadow, 'size'), outline: paint(p.outline, 'size'), back: paint(p.back, 'alpha'), from: Number(p.from) || 0, to: Number(p.to) || 0 };
      // The icon: a new one goes with its address; one taken away as null; the one in use isn't sent.
      Object.assign(body, { plate, ...(video ? { video } : {}), ...(icon !== (item?.icon?.url ?? null) ? { icon } : {}) });
    }
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
  /** A shadow, an outline or a band behind the name: on or off, its colour, and how much of it. */
  const paintRow = (k, label, amount, amountLabel, min, max) => {
    const x = v.plate[k];
    return html`<div class="stack" style="gap:4px">
      <div class="row gap wrap" style="align-items:center">
        <label class="field inline"><span>${label}</span><input type="checkbox" checked=${!!x} onChange=${(e) => setPlate(k, e.target.checked ? { ...PAINT_START[k] } : null)} /></label>
        ${x && html`<label class="field inline"><span>Renk</span><input type="color" value=${x.color} onInput=${(e) => setPlate(k, { ...x, color: e.target.value.toUpperCase() })} /></label>`}
      </div>
      ${x &&
      html`<label class="field"><span>${amountLabel}: %${pct(x[amount])}</span>
        <input type="range" min=${min} max=${max} step="0.005" value=${x[amount]} onInput=${(e) => setPlate(k, { ...x, [amount]: Number(e.target.value) })} /></label>`}
    </div>`;
  };
  const P = limits.plate;
  // What the app's server takes: an older one reads the plate's place, size, colour and boldness only, and no icon.
  const rich = !!P.anims;
  const icons = !!limits.iconPxMin;
  return html`<${Modal} title=${item ? `${item.name} · düzenle` : NEW_LABEL[kind]} onClose=${onClose} wide>
    <div class="grid2" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px">
      <label class="field"><span>Ad *</span><input value=${v.name} maxlength=${limits.nameMax} onInput=${(e) => set('name', e.target.value)} /></label>
      <label class="field"><span>Fiyat (jeton) *</span><input type="number" min="1" value=${v.price} disabled=${isDefault} onInput=${(e) => set('price', e.target.value)} /></label>
      <label class="field"><span>Süre (gün; 0 = süresiz)</span><input type="number" min="0" max=${limits.daysMax} value=${v.days} disabled=${isDefault} onInput=${(e) => set('days', e.target.value)} /></label>
      ${!seat && html`<label class="field"><span>VIP seviyesi (0 = herkes)</span><input type="number" min="0" max=${limits.vipMax} value=${v.minVip} onInput=${(e) => set('minVip', e.target.value)} /></label>`}
    </div>
    ${!isDefault && html`<label class="field inline" style="margin-top:6px"><span>Satışta</span><input type="checkbox" checked=${v.enabled} onChange=${(e) => set('enabled', e.target.checked)} /></label>`}
    ${isDefault && html`<p class="note">Her odanın ücretsiz, varsayılan rengi: fiyatı ve süresi olmaz, satıştan kalkmaz. Adı ve rengi değişir.</p>`}
    ${seat && !isDefault && html`<p class="note">Oda sahibi bu rengi odası için alır; süre bitince oda varsayılan renge döner (0 gün: süresiz). Fiyatı ya da süreyi değiştirmek önceden alanları etkilemez.</p>`}
    ${!own && !seat && html`<p class="note">Uygulamanın kendi eşyasının görünüşü uygulamada. Yeni görünüşle bir eşya için "${NEW_LABEL[kind]}" ekleyin.</p>`}
    ${seat &&
    html`<div class="row gap wrap" style="align-items:flex-start;margin-top:10px">
      <div class="seat-stage">
        <${SeatPreview} color=${seatColor} size=${96} />
        <${SeatPreview} color=${seatColor} size=${96} locked />
      </div>
      <div class="stack" style="flex:1;min-width:240px">
        <div class="row gap wrap" style="align-items:center">
          ${colorInput('Renk', seatColor, setSeatColor)}
          <code>${seatColor}</code>
          ${item?.original?.look && seatColor !== item.original.look.color && html`<${Button} kind="ghost" onClick=${() => setSeatColor(item.original.look.color)}>Uygulamadaki rengi</${Button}>`}
        </div>
        <div class="swatches">
          ${SEAT_SWATCHES.map((c) => html`<button type="button" class=${c === seatColor ? 'swatch on' : 'swatch'} style=${`background:${c}`} title=${c} aria-label=${`Renk ${c}`} onClick=${() => setSeatColor(c)}></button>`)}
        </div>
        <small class="muted">Koltuğun minderi bu renge boyanır; altın kenarı, ayakları ve kilidi olduğu gibi kalır. Yumuşak tonlar odada daha iyi durur; çok açık renkte "+" gölgesiyle görünür.</small>
      </div>
    </div>`}
    ${own &&
    kind === 'frame' &&
    html`<div class="row gap wrap" style="align-items:flex-start;margin-top:10px">
      <${FramePreview}
        src=${motionShown ?? artShown}
        hole=${v.hole}
        at=${{ x: v.holeX, y: v.holeY }}
        size=${220}
        limits=${limits}
        onChange=${limits.holeAtMin ? (o) => setV((s) => ({ ...s, ...(o.hole !== undefined ? { hole: o.hole } : { holeX: o.x, holeY: o.y }) })) : undefined}
      />
      <div class="stack" style="flex:1;min-width:220px">
        <label class="field"><span>Çerçeve resmi * (durağan; saydam, kare PNG ya da WebP, ${limits.framePxMin}–${limits.framePxMax} px)</span><input type="file" accept="image/png,image/webp" onChange=${(e) => pickArt(e.target.files[0])} /></label>
        ${limits.motionPxMin &&
        html`<label class="field"><span>Hareketli hali (isteğe bağlı): hareketli WebP, kare, ${limits.motionPxMin}–${limits.motionPxMax} px, en çok ${Math.round(limits.motionBytes / 1024 / 1024)} MB</span>
            <input type="file" accept="image/webp" onChange=${(e) => pickMotion(e.target.files[0])} /></label>
          ${motionShown && html`<div><${Button} kind="ghost" onClick=${() => (setMotion(null), setMotionShown(null))}>Hareketli halini kaldır</${Button}></div>`}
          <small class="muted">Yeni APK hareketli halini oynatır. Eski APK'lar, Düşük veri modu ve listelerdeki küçük fotoğraflar durağan resmi gösterir; ikisi aynı çerçeve olmalı. Durağan resim seçilmezse hareketlinin ilk karesi durağan resim olur.</small>`}
        <label class="field"><span>Fotoğraf alanı: resmin %${pct(v.hole * 2)}'i</span>
          <input type="range" min=${limits.holeMin} max=${limits.holeMax} step="0.005" value=${v.hole} onInput=${(e) => set('hole', Number(e.target.value))} /></label>
        ${limits.holeAtMin &&
        html`<label class="field"><span>Fotoğrafın yeri, yatay: %${pct(v.holeX)}</span>
            <input type="range" min=${limits.holeAtMin} max=${limits.holeAtMax} step="0.005" value=${v.holeX} onInput=${(e) => set('holeX', Number(e.target.value))} /></label>
          <label class="field"><span>Fotoğrafın yeri, dikey: %${pct(v.holeY)}</span>
            <input type="range" min=${limits.holeAtMin} max=${limits.holeAtMax} step="0.005" value=${v.holeY} onInput=${(e) => set('holeY', Number(e.target.value))} /></label>
          ${artShown && html`<div><${Button} kind="ghost" onClick=${() => measure(artShown).catch((e) => alert(e.message))}>Resimden yeniden ölç</${Button}></div>`}`}
        <small class="muted">Resim seçilince fotoğrafın yeri ve büyüklüğü, resmin halkasından ölçülür: halka resmin ortasında değilse (üstte taç, altta isim levhası) fotoğraf halkaya kayar. Oturmadıysa fotoğrafı önizlemede fareyle sürükleyin; kenarındaki noktayla ya da fare tekerleğiyle büyütüp küçültün, ok tuşlarıyla ince ayar yapın. Kaydırıcılar da aynı işi görür.</small>
      </div>
    </div>`}
    ${own &&
    kind === 'entry' &&
    html`<div class="row gap wrap" style="align-items:flex-start;margin-top:10px">
      <${PlateStage} src=${preview} plate=${v.plate} name=${sample} onPlate=${patchPlate} limits=${limits} />
      <div class="stack" style="flex:1;min-width:240px">
        <label class="field"><span>Video${item ? ' (değiştirmek için)' : ' *'}: hazır yığılmış MP4, saydam WebM, ProRes 4444 .mov ya da SVGA</span>
          <input type="file" accept=".mp4,.webm,.mov,.svga,video/mp4,video/webm,video/quicktime" onChange=${(e) => pickVideo(e.target.files[0])} /></label>
        ${video?.kind === 'source' && html`<small class="muted">Kaydedince uygulamanın sunucusu videoyu çevirir (birkaç dakika). Çevrilene kadar eskisi oynar.</small>`}
        ${icons &&
        html`<div class="row gap" style="align-items:center">
          ${iconShown ? html`<img class="shop-icon" src=${iconShown} alt="İkon" />` : html`<span class="shop-icon empty" aria-hidden="true">✨</span>`}
          <label class="field" style="flex:1"><span>İkon (isteğe bağlı): mağazada efektin bandının üstünde görünür. PNG ya da WebP, ${limits.iconPxMin}–${limits.iconPxMax} px; kare 192 px önerilir</span>
            <input type="file" accept="image/png,image/webp" onChange=${(e) => pickIcon(e.target.files[0])} /></label>
          ${iconShown && html`<${Button} kind="ghost" onClick=${() => (setIcon(null), setIconShown(null))}>İkonu kaldır</${Button}>`}
        </div>`}
        <h3>İsim plakası</h3>
        ${rich && html`<label class="field inline"><span>Odaya girenin adı videonun üstüne yazılsın</span><input type="checkbox" checked=${v.plate.show} onChange=${(e) => setPlate('show', e.target.checked)} /></label>`}
        ${!v.plate.show && html`<small class="muted">Kapalı: telefonda yalnız video oynar. Plakanın ayarları saklanır; açınca aynı yerde çıkar. Eski APK'lar adı yine yazar.</small>`}
        ${v.plate.show &&
        html`<small class="muted">Adı önizlemede sürükleyin ya da videoda bir yere tıklayıp oraya koyun. Köşedeki tutamaç plakayı genişletir ve yazıyı büyütür; ok tuşları ince ayar yapar (Shift ile büyük adım). Animasyonda isim alanını boş bırakın; uzun adlar plakaya sığacak kadar küçülür.</small>
          <label class="field"><span>Örnek ad</span><input value=${sample} maxlength="24" onInput=${(e) => setSample(e.target.value)} /></label>
          ${slider('x', 'Yatay yer', 0, 1, 0.005)}
          ${slider('y', 'Dikey yer', 0, 1, 0.005)}
          ${slider('w', 'Plaka genişliği', P.wMin, P.wMax, 0.005)}
          ${slider('size', 'Yazı boyu', P.sizeMin, P.sizeMax, 0.001)}
          <div class="row gap wrap">
            <label class="field inline"><span>Renk</span><input type="color" value=${v.plate.color} onInput=${(e) => setPlate('color', e.target.value.toUpperCase())} /></label>
            <label class="field inline"><span>Kalın</span><input type="checkbox" checked=${v.plate.bold} onChange=${(e) => setPlate('bold', e.target.checked)} /></label>
            ${rich && html`<label class="field inline"><span>Büyük harf</span><input type="checkbox" checked=${v.plate.upper} onChange=${(e) => setPlate('upper', e.target.checked)} /></label>`}
          </div>
          ${rich &&
          html`${slider('spacing', 'Harf aralığı', 0, P.spacingMax, 0.01)}
            ${paintRow('shadow', 'Gölge / parlama', 'size', 'Yayılma', P.shadowMin, P.shadowMax)}
            ${paintRow('outline', 'Kontur', 'size', 'Kalınlık', P.outlineMin, P.outlineMax)}
            ${paintRow('back', 'Arkasında bant', 'alpha', 'Koyuluk', P.backMin, 1)}
            <h3>Zamanı</h3>
            <div class="row gap wrap">
              <label class="field"><span>Görünsün (sn)</span><input type="number" min="0" max=${P.secondsMax} step="0.1" value=${v.plate.from} onInput=${(e) => setPlate('from', Number(e.target.value) || 0)} /></label>
              <label class="field"><span>Kaybolsun (sn; 0 = video bitene kadar)</span><input type="number" min="0" max=${P.secondsMax} step="0.1" value=${v.plate.to} onInput=${(e) => setPlate('to', Number(e.target.value) || 0)} /></label>
              <label class="field"><span>Belirme</span>
                <select value=${v.plate.anim} onChange=${(e) => setPlate('anim', e.target.value)}>${P.anims.map((k) => html`<option value=${k}>${ANIM_TR[k] ?? k}</option>`)}</select></label>
            </div>
            <small class="muted">Videoyu önizlemede istediğiniz anda durdurup "görünsün" ya da "kaybolsun"a basınca saniye o an olur.</small>`}`}
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

// --- Toplu çerçeve ekle ----------------------------------------------------------------------------------------
/** Turkish words a designer's file name writes in plain letters ("altin_tac" → "Altın Taç"). */
const TR_WORDS = { altin: 'Altın', tac: 'Taç', kralice: 'Kraliçe', aslani: 'Aslanı', buyu: 'Büyü', kusu: 'Kuşu', ejderhasi: 'Ejderhası', ask: 'Aşk', melegi: 'Meleği', tatli: 'Tatlı', gumus: 'Gümüş', yildiz: 'Yıldız', isik: 'Işık', gul: 'Gül', cicek: 'Çiçek', ates: 'Ateş', gunes: 'Güneş', guc: 'Güç', kis: 'Kış', vip: 'VIP' };
/** A file's frame name: its number gone, Turkish capitals ("02_imparator" → "İmparator"), the shop's length. */
const frameNameOf = (key) =>
  key
    .replace(/^\d+[\s_-]*/, '')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => TR_WORDS[w] ?? w.charAt(0).toLocaleUpperCase('tr') + w.slice(1))
    .join(' ')
    .slice(0, 24);
/**
 * A picked file's frame and type: the name the still and the moving file of one frame share (without the preview
 * word, and without the combining dot a Turkish "İ" leaves when a name is lowered: "02_i̇mparator"). File names are
 * written in plain Latin letters ("02_Imparator", "18_Cyber_VIP"), so an "I" is lowered to "i", not to the Turkish "ı".
 */
function frameFileOf(file) {
  const m = /^(.+)\.(png|webp|gif|svga)$/i.exec(file.name.normalize('NFC'));
  if (!m) return null;
  const key = m[1].normalize('NFD').replace(/̇/g, '').normalize('NFC').toLowerCase().replace(/[\s_-]*(onizleme|önizleme|preview|still)$/, '');
  return { key, ext: m[2].toLowerCase(), file };
}
/** A designer's folder as frames: each one's still picture and moving WebP, in their numbers' order; GIF and SVGA counted, not used. */
async function framesOf(files) {
  const by = new Map();
  let skipped = 0;
  for (const f of files) {
    const x = frameFileOf(f);
    if (!x) continue;
    if (x.ext === 'gif' || x.ext === 'svga') {
      skipped++;
      continue;
    }
    const row = by.get(x.key) ?? { key: x.key, still: null, motion: null };
    if (x.ext === 'webp' && (await webpFlags(f))?.animated) row.motion ??= f;
    else row.still ??= f;
    by.set(x.key, row);
  }
  return { rows: [...by.values()].sort((a, b) => a.key.localeCompare(b.key, 'tr', { numeric: true })), skipped };
}
/** One frame of a set checked as the app's server will check it, with its pictures to show and its hole measured. */
async function readyFrame(r, limits) {
  const out = { key: r.key, name: frameNameOf(r.key), on: true, hole: limits.holeDefault, at: { x: 0.5, y: 0.5 }, still: r.still, motion: r.motion, stillUrl: null, motionUrl: null, problem: null, state: null };
  const mb = (n) => `${Math.round((n / 1024 / 1024) * 10) / 10} MB`;
  try {
    // A set of moving WebPs alone: each one's first frame becomes its still picture.
    if (!r.still && r.motion) {
      out.still = await stillOf(r.motion);
      out.made = true;
    }
    const still = out.still;
    if (!still) throw new Error('Durağan resmi (PNG önizleme) yok: onu da seçin');
    if (!typeOf('shopframe', still)) throw new Error('Durağan resim PNG ya da WebP olmalı');
    if (still.size > limits.frameBytes) throw new Error(`Durağan resim en fazla ${mb(limits.frameBytes)} olabilir`);
    out.stillUrl = URL.createObjectURL(still);
    const d = await sizeOf(out.stillUrl);
    if (Math.abs(d.w - d.h) > Math.max(2, d.w * 0.02)) throw new Error(`Durağan resim kare olmalı (bu ${d.w} × ${d.h})`);
    if (d.w < limits.framePxMin || d.w > limits.framePxMax) throw new Error(`Durağan resim ${limits.framePxMin}–${limits.framePxMax} piksel olmalı (bu ${d.w})`);
    const m = await measureHole(out.stillUrl, limits);
    out.hole = m.hole;
    out.at = { x: m.x, y: m.y };
    if (r.motion) {
      if (r.motion.size > limits.motionBytes) throw new Error(`Hareketli WebP en fazla ${mb(limits.motionBytes)} olabilir`);
      out.motionUrl = URL.createObjectURL(r.motion);
      const m = await sizeOf(out.motionUrl);
      if (Math.abs(m.w - m.h) > Math.max(2, m.w * 0.02) || m.w < limits.motionPxMin || m.w > limits.motionPxMax)
        throw new Error(`Hareketli WebP kare ve ${limits.motionPxMin}–${limits.motionPxMax} piksel olmalı (bu ${m.w} × ${m.h})`);
    }
  } catch (e) {
    out.problem = e.message;
    out.on = false;
  }
  return out;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Runs `fn` again after half a minute when the app's server says "too many" (uploads: a minute's limit), up to 3 times. */
async function patiently(fn, onWait) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= 3 || !(e.status === 429 || /Çok fazla/.test(e.message ?? ''))) throw e;
      onWait('Çok hızlı gitti: yarım dakika bekleniyor…');
      await sleep(30_000);
    }
  }
}

/**
 * A designer's set of frames added at once: the folder (or its files) is read here, each frame's still picture and
 * moving WebP paired by name, checked, its hole measured; the names are made from the file names (editable), the
 * price, days, VIP level and shelf go for all. Each is added as "Yeni çerçeve" would (uploads, then the app's
 * POST /api/admin/shop), one after another, last first so the set keeps its numbers' order at the top of the shop. A
 * frame refused (a name taken) says why and the others go on; adding again sends only those not added.
 */
function BulkFrames({ limits, taken, onClose, onDone }) {
  const [rows, setRows] = useState([]);
  const [skipped, setSkipped] = useState(0);
  const [common, setCommon] = useState({ price: '', days: 30, minVip: 0, enabled: true });
  const [busy, setBusy] = useState(null);
  const urls = useRef([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);
  const setRow = (key, o) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...o } : r)));
  const setAll = (k, x) => setCommon((c) => ({ ...c, [k]: x }));
  const pick = async (list) => {
    const files = [...(list ?? [])];
    if (!files.length) return;
    setBusy('Dosyalar okunuyor…');
    try {
      const found = await framesOf(files);
      const ready = [];
      for (const r of found.rows) ready.push(await readyFrame(r, limits));
      urls.current.push(...ready.flatMap((r) => [r.stillUrl, r.motionUrl]).filter(Boolean));
      setRows(ready);
      setSkipped(found.skipped);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  };
  const low = (s) => s.trim().toLocaleLowerCase('tr');
  const clash = (r) => taken.some((t) => low(t) === low(r.name)) || rows.some((o) => o !== r && o.on && o.state !== 'done' && low(o.name) === low(r.name));
  const todo = rows.filter((r) => r.on && !r.problem && r.state !== 'done');
  const run = async () => {
    const price = Number(common.price);
    if (!Number.isSafeInteger(price) || price < 1) return alert('Fiyatı yazın (jeton, hepsi için)');
    let added = 0;
    let failed = 0;
    setBusy('Ekleniyor…');
    for (const r of [...todo].reverse()) {
      const say = (state) => setRow(r.key, { state });
      say('Yükleniyor…');
      try {
        const art = await patiently(() => upload('shopframe', r.still), say);
        const motion = r.motion ? await patiently(() => upload('shopframe', r.motion), say) : null;
        say('Kaydediliyor…');
        const body = {
          kind: 'frame',
          name: r.name.trim(),
          price,
          days: Number(common.days),
          minVip: Number(common.minVip),
          enabled: common.enabled,
          art,
          hole: r.hole,
          ...(limits.holeAtMin ? { holeX: r.at.x, holeY: r.at.y } : {}),
          ...(motion ? { motion } : {}),
        };
        await patiently(() => post('/api/app/shop', body), say);
        say('done');
        added++;
      } catch (e) {
        say(`Eklenmedi: ${e.message}`);
        failed++;
      }
    }
    setBusy(null);
    toast(failed ? `${added} çerçeve eklendi, ${failed} eklenemedi: sebebi kartında` : `${added} çerçeve eklendi`, failed ? 'warn' : 'ok');
    onDone();
  };
  return html`<${Modal} title="Toplu çerçeve ekle" onClose=${busy ? () => {} : onClose} wide>
    <p class="note">Tasarımcının klasörünü seçin. Her çerçevenin durağan PNG'si (önizleme) ve hareketli WebP'si adından eşleştirilir; PNG'si olmayanın durağan resmi hareketli WebP'nin ilk karesinden yapılır. Fotoğraf alanı resmin saydam ortasından ölçülür. GIF ve SVGA kullanılmaz: hareketli WebP aynı çerçevedir ve telefon onu oynatır.</p>
    <div class="row gap wrap">
      <label class="field"><span>Klasör</span><input type="file" webkitdirectory multiple disabled=${!!busy} onChange=${(e) => pick(e.target.files)} /></label>
      <label class="field"><span>ya da dosyalar</span><input type="file" multiple accept=".png,.webp,image/png,image/webp" disabled=${!!busy} onChange=${(e) => pick(e.target.files)} /></label>
    </div>
    ${rows.length > 0 &&
    html`<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px;margin-top:8px">
        <label class="field"><span>Fiyat (jeton) *: hepsi</span><input type="number" min="1" value=${common.price} onInput=${(e) => setAll('price', e.target.value)} /></label>
        <label class="field"><span>Süre (gün; 0 = süresiz)</span><input type="number" min="0" max=${limits.daysMax} value=${common.days} onInput=${(e) => setAll('days', e.target.value)} /></label>
        <label class="field"><span>VIP seviyesi (0 = herkes)</span><input type="number" min="0" max=${limits.vipMax} value=${common.minVip} onInput=${(e) => setAll('minVip', e.target.value)} /></label>
        <label class="field inline" style="align-self:end"><span>Satışta</span><input type="checkbox" checked=${common.enabled} onChange=${(e) => setAll('enabled', e.target.checked)} /></label>
      </div>
      <small class="muted">${rows.length} çerçeve bulundu${skipped ? `; ${skipped} GIF ya da SVGA dosyası kullanılmadı` : ''}. Adları tek tek düzeltebilirsiniz; fotoğraf oturmadıysa kartında fareyle sürükleyin, noktadan ya da tekerlekle büyütün. İşaretsizler eklenmez. İlk numara mağazada başta durur.</small>
      <div class="bulk-grid">
        ${rows.map(
          (r) => html`<div class=${`bulk-card${r.state === 'done' ? ' done' : ''}`} key=${r.key}>
            <${FramePreview}
              src=${r.motionUrl ?? r.stillUrl}
              hole=${r.hole}
              at=${r.at}
              size=${140}
              limits=${limits}
              onChange=${!r.problem && r.state !== 'done' && !busy && limits.holeAtMin ? (o) => setRow(r.key, o.hole !== undefined ? { hole: o.hole } : { at: { x: o.x, y: o.y } }) : undefined}
            />
            <label class="field inline"><span>Ekle</span><input type="checkbox" checked=${r.on} disabled=${!!r.problem || r.state === 'done' || !!busy} onChange=${(e) => setRow(r.key, { on: e.target.checked })} /></label>
            <input value=${r.name} maxlength=${limits.nameMax} aria-label="Ad" disabled=${r.state === 'done' || !!busy} onInput=${(e) => setRow(r.key, { name: e.target.value })} />
            ${!r.problem &&
            html`<label class="field"><span>Fotoğraf alanı: %${pct(r.hole * 2)}</span>
              <input type="range" min=${limits.holeMin} max=${limits.holeMax} step="0.005" value=${r.hole} disabled=${r.state === 'done' || !!busy} onInput=${(e) => setRow(r.key, { hole: Number(e.target.value) })} /></label>`}
            <small class=${r.problem ? 'bad' : 'muted'}>${r.problem ?? (r.motion ? (r.made ? 'Hareketli; durağan resmi ilk karesinden' : 'Hareketli ve durağan') : 'Yalnız durağan (hareketli WebP yok)')}</small>
            ${r.on && !r.problem && r.state !== 'done' && clash(r) && html`<small class="bad">Bu ad zaten var: değiştirin</small>`}
            ${r.state && html`<small class=${r.state === 'done' ? 'good' : r.state.startsWith('Eklenmedi') ? 'bad' : 'muted'}>${r.state === 'done' ? '✓ Eklendi' : r.state}</small>`}
          </div>`,
        )}
      </div>
      <div class="row gap end" style="margin-top:10px">
        ${busy && html`<small class="muted">${busy}</small>`}
        <${Button} onClick=${onClose} disabled=${!!busy}>Kapat</${Button}>
        <${Button} kind="primary" onClick=${run} disabled=${!!busy || !todo.length}>${todo.length} çerçeveyi ekle</${Button}>
      </div>`}
  </${Modal}>`;
}
