// Uygulama › Hediyeler › Bağ işaretleri: the mark drawn between two bonded people (when they sit side by side on the
// mics, and on the profile's Bağlar row), designed level by level for each bond kind, kept by the app's bond-looks.mjs
// (server/app-admin.ts passes the calls on as the signed-in panel user; permission app.gifts). A kind's 20 levels in a
// list: what each shows now (its own design, the nearest lower level's, or the app's own mark), and an editor for one
// level: a still picture (a transparent PNG or WebP) and/or a moving one (an animated WebP, or an SVGA the app's server
// turns into both, as Mağaza's frames), how big it is drawn, and a preview between two sample seats. The rules are in
// web/bond-looks.js.
import { Badge, Button, Loading, Modal, Table, act, dateTimeTr, html, post, toast, useApi, useApp, useEffect, useRef, useState } from '../lib.js';
import { LIMITS, SIZES, designedCount, levelRows, saveBody, showsText, sizeText } from '../bond-looks.js';
import { upload } from './app-gifts.js';
import { sizeOf, stillOf, webpFlags } from './app-shop.js';

const SAMPLE_PHOTO = '/img/ornek-yuz.svg';
const SEAT = 64;
/** The mark's size between two seats in the app (components/room: about half a face). */
const MARK = 30;

/** A design's picture as this panel shows it (the moving one when there is one). */
const shown = (x) => x?.motion?.url ?? x?.art?.url ?? null;

/** Two sample seats with the mark between them, as the app draws it (`src` null: a plain ring for the app's own). */
function SeatsPreview({ src, size = 1, dark = true }) {
  const side = Math.round(MARK * size);
  return html`<div style=${`display:flex;align-items:center;justify-content:center;gap:${MARK + 6}px;padding:22px 14px;border-radius:12px;background:${dark ? '#1d0f24' : '#f6eef6'};position:relative`}>
    <img src=${SAMPLE_PHOTO} alt="" style=${`width:${SEAT}px;height:${SEAT}px;border-radius:50%`} />
    <div style=${`position:absolute;left:50%;top:50%;width:${side}px;height:${side}px;transform:translate(-50%,-50%);display:flex;align-items:center;justify-content:center`}>
      ${src ? html`<img src=${src} alt="" style="width:100%;height:100%;object-fit:contain" />` : html`<div style=${`width:${MARK}px;height:${MARK}px;border-radius:50%;border:3px solid #ff5fa2;background:#2a1631`}></div>`}
    </div>
    <img src=${SAMPLE_PHOTO} alt="" style=${`width:${SEAT}px;height:${SEAT}px;border-radius:50%`} />
  </div>`;
}

/** Bağ işaretleri, Hediyeler's third tab. `state`: GET /api/app/bond-looks (useApi). */
export function BondLooks({ state }) {
  const { can } = useApp();
  const [kind, setKind] = useState('cift');
  const [edit, setEdit] = useState(null);
  if (state.error && /404|bulunamad|Not found/i.test(state.error.message))
    return html`<div class="empty">Uygulamanın sunucusu Bağ işaretlerini henüz taşımıyor (bu özelliğin sunucu güncellemesinden sonra açılır).</div>`;
  const clear = async (r) => {
    if (!confirm(`Lv${r.level} tasarımı kaldırılsın mı? Bu seviye ${r.level > 1 ? 'bir alttaki tasarımı ya da ' : ''}uygulamanın kendi işaretini gösterir. Yüklenen dosyalar silinir.`)) return;
    (await act(() => post('/api/app/bond-looks/clear', { kind, level: r.level }), 'Tasarım kaldırıldı')) && state.reload();
  };
  return html`<${Loading} state=${state}>${(d) => {
    const count = designedCount(d.looks);
    const rows = levelRows(d.looks, kind, d.levels);
    const label = d.kinds.find((k) => k.kind === kind)?.label ?? kind;
    return html`
      <p class="muted">Bağlı iki kişi mikrofonda yan yana oturunca aralarında ve profilin Bağlar satırında görünen işaret. Her bağ türü için seviye seviye tasarım yükleyin: bir seviyeye yüklenen tasarım, kendi tasarımı olan bir üst seviyeye kadar devam eder. Hiç tasarım yoksa uygulama kendi işaretini çizer (türün resmi, beş seviyede bir değişen halka). Değişiklik uygulama güncellemesi olmadan telefonlara gider.</p>
      <p class="muted">Hareketli hali varsa telefon onu, yoksa durağan resmi çizer. SVGA yüklerseniz uygulamanın sunucusu ondan ikisini de yapar. Bu tasarımları yalnız yeni APK çizer; eski APK'lar kendi işaretini göstermeye devam eder.</p>
      ${!d.storage && html`<p class="note warn">Uygulamanın dosya deposu ayarlı değil: resim yüklenemez.</p>`}
      <div class="row gap wrap" style="margin:10px 0">
        ${d.kinds.map((k) => html`<button class=${`chip ${kind === k.kind ? 'on' : ''}`} onClick=${() => setKind(k.kind)}>${k.label}${count[k.kind] ? ` (${count[k.kind]})` : ''}</button>`)}
      </div>
      <${Table}
        rows=${rows}
        columns=${[
          { key: 'level', label: 'Seviye', render: (r) => html`<strong>Lv${r.level}</strong>` },
          {
            key: 'shows',
            label: 'Görünen',
            render: (r) => html`<div class="row gap" style="align-items:center">
              <div style="width:44px;height:44px;border-radius:10px;background:#1d0f24;display:flex;align-items:center;justify-content:center;opacity:${r.own ? 1 : 0.55}">
                ${shown(r.shows) ? html`<img src=${shown(r.shows)} alt="" style="width:40px;height:40px;object-fit:contain" />` : html`<div style="width:22px;height:22px;border-radius:50%;border:2px solid #ff5fa2"></div>`}
              </div>
              <div class="cell-wrap" style="max-width:260px">${showsText(r)}${r.own?.updatedAt ? html`<br /><small class="muted">${dateTimeTr(r.own.updatedAt)}</small>` : ''}</div>
            </div>`,
          },
          {
            key: 'files',
            label: 'Dosyalar',
            render: (r) => (r.own ? html`${r.own.art ? html`<${Badge} s="ok" label="Durağan" /> ` : ''}${r.own.motion ? html`<${Badge} s="ok" label="Hareketli" />` : ''}` : html`<span class="muted">—</span>`),
          },
          { key: 'size', label: 'Boyut', render: (r) => (r.own ? sizeText(r.own.size) : r.shows ? html`<span class="muted">${sizeText(r.shows.size)}</span>` : '—') },
          {
            key: 'act',
            label: '',
            render: (r) =>
              can('app.gifts') &&
              html`<div class="row gap">
                <${Button} kind=${r.own ? '' : 'primary'} disabled=${!d.storage} onClick=${() => setEdit({ level: r.level, own: r.own, from: r.shows })}>${r.own ? 'Değiştir' : 'Tasarım yükle'}</${Button}>
                ${r.own && html`<${Button} kind="danger" onClick=${() => clear(r)}>Kaldır</${Button}>`}
              </div>`,
          },
        ]}
      />
      ${edit && html`<${LookEditor} kind=${kind} label=${label} level=${edit.level} own=${edit.own} from=${edit.from} limits=${{ ...LIMITS, ...(d.limits ?? {}) }} svga=${d.svga} onClose=${() => setEdit(null)} onSaved=${() => (setEdit(null), state.reload())} />`}
    `;
  }}</${Loading}>`;
}

/** One level's design: its pictures (uploaded as picked), its size, a preview; saves what changed. */
function LookEditor({ kind, label, level, own, from, limits, svga, onClose, onSaved }) {
  const [art, setArt] = useState(own?.art?.url ?? null);
  const [motion, setMotion] = useState(own?.motion?.url ?? null);
  const [artShown, setArtShown] = useState(own?.art?.url ?? null);
  const [motionShown, setMotionShown] = useState(own?.motion?.url ?? null);
  const [size, setSize] = useState(own?.size ?? from?.size ?? 1);
  const [busy, setBusy] = useState(null);
  const locals = useRef([]);
  useEffect(() => () => locals.current.forEach((u) => URL.revokeObjectURL(u)), []);
  const local = (file) => {
    const u = URL.createObjectURL(file);
    locals.current.push(u);
    return u;
  };
  const mb = (n) => `${Math.round(n / 1024 / 1024)} MB`;

  const pickArt = async (file) => {
    if (!file) return;
    if (!/\.(png|webp)$/i.test(file.name) && !/^image\/(png|webp)$/.test(file.type)) return alert('Durağan resim PNG ya da WebP olmalı');
    if ((await webpFlags(file))?.animated) return alert('Bu resim hareketli: onu "Hareketli hali"ne yükleyin');
    if (file.size > limits.artBytes) return alert(`Resim en fazla ${mb(limits.artBytes)} olabilir`);
    setBusy('Resim yükleniyor…');
    try {
      const u = local(file);
      const s = await sizeOf(u);
      if (Math.abs(s.w - s.h) > Math.max(2, s.w * 0.02)) throw new Error(`Resim kare olmalı (bu ${s.w} × ${s.h})`);
      if (s.w < limits.artPxMin || s.w > limits.artPxMax) throw new Error(`Resim ${limits.artPxMin}–${limits.artPxMax} piksel olmalı (bu ${s.w})`);
      setArt(await upload('shopframe', file));
      setArtShown(u);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  };
  const pickSvga = async (file) => {
    if (!svga) return alert('Uygulamanın sunucusu SVGA çeviremiyor: hareketli WebP yükleyin');
    setBusy('SVGA yükleniyor…');
    try {
      const source = await upload('giftsource', file, (p) => setBusy(`SVGA yükleniyor… %${Math.round(p * 100)}`));
      setBusy('SVGA çevriliyor… (bir dakika sürebilir)');
      const out = await post('/api/app/bond-looks/svga', { source });
      setArt(out.art);
      setArtShown(out.artPreview);
      setMotion(out.motion);
      setMotionShown(out.motionPreview);
      toast('SVGA çevrildi: durağan resim ve hareketli hali hazır');
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  };
  const pickMotion = async (file) => {
    if (!file) return;
    if (/\.svga$/i.test(file.name)) return pickSvga(file);
    const flags = await webpFlags(file);
    if (!flags?.animated) return alert('Hareketli hali hareketli bir WebP ya da SVGA olmalı (GIF olmaz)');
    if (!flags.alpha) return alert('Hareketli halde saydamlık yok: işaretin çevresi saydam olmalı');
    if (file.size > limits.motionBytes) return alert(`Hareketli hali en fazla ${mb(limits.motionBytes)} olabilir`);
    setBusy('Hareketli hali yükleniyor…');
    try {
      const u = local(file);
      const s = await sizeOf(u);
      if (Math.abs(s.w - s.h) > Math.max(2, s.w * 0.02)) throw new Error(`Hareketli hali kare olmalı (bu ${s.w} × ${s.h})`);
      if (s.w < limits.motionPxMin || s.w > limits.motionPxMax) throw new Error(`Hareketli hali ${limits.motionPxMin}–${limits.motionPxMax} piksel olmalı (bu ${s.w})`);
      setMotion(await upload('shopframe', file));
      setMotionShown(u);
      // No still picture yet: the moving one's first frame becomes it (the profile's small badge and older screens).
      if (!art) {
        const first = await stillOf(file);
        setArt(await upload('shopframe', first));
        setArtShown(local(first));
      }
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  };
  const save = async () => {
    const body = saveBody(kind, level, own, { art, motion, size });
    if (!body) return onClose();
    if (body.error) return alert(body.error);
    (await act(() => post('/api/app/bond-looks/save', body), `${label} Lv${level} kaydedildi`)) && onSaved();
  };
  const file = (accept, onPick) => html`<input type="file" accept=${accept} disabled=${!!busy} onChange=${(e) => (onPick(e.target.files?.[0]), (e.target.value = ''))} />`;

  return html`<${Modal} title=${`${label} · Lv${level} işareti`} onClose=${onClose} wide>
    ${!own && from && html`<p class="note">Bu seviye şu an Lv${from.level} tasarımını gösteriyor. Buraya yüklenen tasarım Lv${level}'den başlar.</p>`}
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px">
      <div>
        <label class="field"><span>Durağan resim (saydam, kare PNG ya da WebP, ${limits.artPxMin}–${limits.artPxMax} px)</span>${file('image/png,image/webp', pickArt)}</label>
        ${art && html`<div class="row gap" style="align-items:center;margin:6px 0"><img src=${artShown} alt="" style="width:56px;height:56px;object-fit:contain;background:#1d0f24;border-radius:8px" /><button type="button" class="btn link" onClick=${() => (setArt(null), setArtShown(null))}>Kaldır</button></div>`}
        <label class="field"><span>Hareketli hali (saydam, kare hareketli WebP ${limits.motionPxMin}–${limits.motionPxMax} px${svga ? ' ya da SVGA' : ''})</span>${file(svga ? 'image/webp,.svga' : 'image/webp', pickMotion)}</label>
        ${motion && html`<div class="row gap" style="align-items:center;margin:6px 0"><img src=${motionShown} alt="" style="width:56px;height:56px;object-fit:contain;background:#1d0f24;border-radius:8px" /><button type="button" class="btn link" onClick=${() => (setMotion(null), setMotionShown(null))}>Kaldır</button></div>`}
        <label class="field"><span>Boyut (uygulamanın kendi işaretine göre)</span>
          <select value=${size} onChange=${(e) => setSize(Number(e.target.value))}>${SIZES.map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select>
        </label>
        <p class="muted" style="font-size:12px">Kalp, ışık gibi çevreye taşan efektler için boyutu büyütün. Resim ortalanır; iki koltuğun arasına sığmazsa yüzlerin üstüne taşar.</p>
      </div>
      <div>
        <div class="muted" style="font-size:12px;margin-bottom:6px">Önizleme (odada iki koltuk arası)</div>
        <${SeatsPreview} src=${motionShown ?? artShown} size=${size} />
        <div style="height:8px"></div>
        <${SeatsPreview} src=${motionShown ?? artShown} size=${size} dark=${false} />
      </div>
    </div>
    ${busy && html`<p class="note">${busy}</p>`}
    <div class="row gap" style="justify-content:flex-end;margin-top:12px">
      <${Button} onClick=${onClose}>Vazgeç</${Button}>
      <${Button} kind="primary" disabled=${!!busy || (!art && !motion)} onClick=${save}>Kaydet</${Button}>
    </div>
  </${Modal}>`;
}
