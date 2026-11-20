// Uygulama › Hediyeler › İz türleri (Muzip hediyeler): the kinds of profile mark a gift leaves on its receiver's photo
// and the gifts that clean it share (Kaka İzi, Kırık Cam, …), kept by the app's mark-kinds.mjs (server/app-admin.ts
// passes the calls on as the signed-in panel user; permission app.gifts). A list (picture, name and key, time, what the
// same kind again does, on/off, the gifts that use it, how many photos show it now), a new kind, changing one (its key
// never changes), turning it off (its gifts go as plain gifts, its marks don't show), deleting one no gift uses. Its
// overlay picture is uploaded as markart and checked by the app's server when the kind is saved; the page checks it
// the same way first (web/mark-kinds.js) and shows the server's sentence when it refuses. A preview draws the overlay
// over a sample photo (or one picked from this computer, never uploaded) at the app's real sizes, without a frame,
// with a VIP ring and with a shop frame (Mağaza's FramePreview), on a light and a dark ground, as the app's own
// Yönetim › Hediyeler › "İz türlerini önizle" does.
import { Badge, Button, Loading, Modal, Table, act, dateTimeTr, html, num, post, showError, toast, useApi, useApp, useEffect, useState } from '../lib.js';
import { durationText } from '../gift-fields.js';
import { FACES, GROUNDS, LIMITS, OTHER_KIND_TEXT, STACK_HELP, STACK_TEXT, VIP_RING, artInfo, artLine, artProblem, artRules, artStats, badgeBox, frameBox, keyFromName, kindBody, kindForm, kindSummary, kindTime, kindsMissing, layerOf, pctOf } from '../mark-kinds.js';
import { upload } from './app-gifts.js';
import { FramePreview } from './app-shop.js';

const SAMPLE_PHOTO = '/img/ornek-yuz.svg';

/** The leaving gift's picture for a kind's badge (the gift list's icon, else its emoji). */
function badgeOf(k, gifts) {
  const id = k?.gifts?.find((g) => g.role === 'leave')?.id;
  const g = id ? gifts?.find((x) => x.id === id) : null;
  return { icon: g?.icon ?? null, emoji: g?.emoji ?? (k?.kind === 'kaka' ? '💩' : '🎁') };
}

/**
 * İz türleri, Hediyeler's second tab. `state`: GET /api/app/mark-kinds (useApi); `gifts`: Hediyeler's list (the
 * leaving gifts' pictures for a badge); `storage`: whether the app can take uploads; `adding`: the "Yeni tür" button was
 * pressed (the page header's), `onAdded` puts it back.
 */
export function MarkKinds({ state, gifts, storage, adding, onAdded }) {
  const { can } = useApp();
  const [edit, setEdit] = useState(null);
  const [look, setLook] = useState(null);
  useEffect(() => {
    if (adding && state.data) setEdit({});
  }, [adding, !!state.data]);
  const close = () => (setEdit(null), onAdded?.());
  if (state.error && kindsMissing(state.error))
    return html`<div class="empty">Uygulamanın sunucusu İz türlerini henüz taşımıyor (Muzip hediyelerle gelen sunucu güncellemesinden sonra açılır). O zamana kadar hediyenin iz türü formda elle yazılır.</div>`;
  const toggle = async (k) => {
    const s = kindSummary(k);
    const names = k.gifts.map((g) => g.name).join(', ');
    const text = k.enabled
      ? `“${k.name}” kapatılsın mı? ${names ? `Hediyeleri (${names}) düz hediye gibi gider: iz bırakmaz, temizlemez. ` : ''}Görünen ${num(k.showing)} iz görünmez olur; açınca süresi dolmamış olanlar geri gelir.`
      : `“${k.name}” açılsın mı? ${s.leave.length ? 'Hediyeleri yeniden iz bırakır ve temizler; ' : ''}süresi dolmamış izler geri görünür.`;
    if (!confirm(text)) return;
    (await act(() => post('/api/app/mark-kinds/update', { kind: k.kind, enabled: !k.enabled }), k.enabled ? 'Tür kapatıldı' : 'Tür açıldı')) && state.reload();
  };
  const remove = async (k) => {
    if (!confirm(`“${k.name}” (${k.kind}) silinsin mi? Hiçbir hediye kullanmıyor. Eski izler ve kayıtlar adını korur; yüklenen resmi silinir.`)) return;
    (await act(() => post('/api/app/mark-kinds/delete', { kind: k.kind }), 'Tür silindi')) && state.reload();
  };
  return html`<${Loading} state=${state}>${(d) => html`
    ${!d.on && html`<p class="note warn">Profil izleri şu an kapalı (Canlı ayarlar › Profil izleri › süre 0): hiçbir hediye iz bırakmıyor, hiçbir iz görünmüyor.</p>`}
    <p class="muted">Bir tür, iz bırakan hediyeyle onu temizleyen hediyelerin paylaştığı anahtardır. Yeni bir şaka çifti için: önce burada türü ekleyin (resmiyle), sonra Hediyeler'de iz bırakan ve ondan pahalı temizleyen hediyeyi bu türle kurun. Kendi süresi olmayan türün izi Canlı ayardaki süre kadar kalır${d.hours > 0 ? ` (şu an ${durationText(d.hours * 60)})` : ''}. Profilde aynı anda tek iz olur. ${OTHER_KIND_TEXT}</p>
    <p class="muted">Yüklenen resmi yalnız yeni APK (1.1.0) çizer. Ondan önceki APK Kaka İzi'ni kendi resmiyle, öteki türleri hediyenin rozetiyle gösterir; Profil izinden önceki APK'lar iz kurallı hediyeleri hiç göstermez. Telefonda bakmak için: Yönetim › Hediyeler › İz türlerini önizle.</p>
    <${Table}
      empty="Henüz iz türü yok."
      columns=${[
        { key: 'art', label: 'Resim', render: (k) => html`<${ArtThumb} k=${k} />` },
        {
          key: 'name',
          label: 'Tür',
          render: (k) => html`<div class="cell-wrap" style="min-width:150px;max-width:240px"><strong>${k.name}</strong>${!k.enabled ? html` <${Badge} s="passive" label="Kapalı" />` : ''}<br /><small class="muted"><code>${k.kind}</code>${k.updatedAt ? ` · ${dateTimeTr(k.updatedAt)}` : ''}</small></div>`,
        },
        { key: 'minutes', label: 'Süre', render: (k) => html`${kindTime(k, d.hours)}` },
        { key: 'stack', label: 'Aynı iz yeniden gelince', render: (k) => html`<div class="cell-wrap" style="max-width:170px">${STACK_TEXT[k.stack] ?? k.stack}</div>` },
        {
          key: 'gifts',
          label: 'Hediyeler',
          render: (k) => {
            const s = kindSummary(k);
            const list = (role, gs) => gs.length ? html`<div>${role}: ${gs.map((g, i) => html`${i ? ', ' : ''}<span class=${g.enabled ? '' : 'muted'} title=${g.enabled ? '' : 'rafta değil'}>${g.name}${g.role === 'leave' && g.minutes ? ` (${durationText(g.minutes)})` : ''}${g.enabled ? '' : ' (rafta değil)'}</span>`)}</div>` : '';
            return html`<div class="cell-wrap" style="min-width:180px;max-width:320px">
              ${list('Bırakan', s.leave)}${list('Temizleyen', s.clean)}${!k.gifts.length ? html`<span class="muted">Hediye yok</span>` : ''}
              ${s.warn.map((w) => html`<div><${Badge} s="warning" label=${w} /></div>`)}
            </div>`;
          },
        },
        { key: 'showing', label: 'Şu an', align: 'right', render: (k) => html`${num(k.showing)} kişide` },
        {
          key: 'a',
          label: '',
          render: (k) => html`<span class="row gap wrap actions">
            <${Button} kind="ghost" onClick=${() => setLook(k)}>Önizle</${Button}>
            ${can('app.gifts') && html`<${Button} onClick=${() => setEdit({ kind: k })}>Düzenle</${Button}>
              <${Button} kind="ghost" onClick=${() => toggle(k)}>${k.enabled ? 'Kapat' : 'Aç'}</${Button}>
              <${Button} kind="danger" disabled=${!kindSummary(k).deletable} title=${kindSummary(k).deletable ? '' : 'Bu türü kullanan hediye var: önce onların profil izi kuralını değiştirin'} onClick=${() => remove(k)}>Sil</${Button}>`}
          </span>`,
        },
      ]}
      rows=${d.kinds}
    />
    ${edit && html`<${KindEditor} kind=${edit.kind} all=${d.kinds} limits=${{ ...LIMITS, ...(d.limits ?? {}) }} hours=${d.hours} gifts=${gifts} storage=${storage} onClose=${close} onSaved=${(text) => (close(), toast(text), state.reload())} />`}
    ${look && html`<${Modal} title=${`Önizleme: ${look.name}`} wide onClose=${() => setLook(null)}>
      <${MarkPreview} layer=${layerOf(look)} badge=${badgeOf(look, gifts)} />
    </${Modal}>`}
  `}</${Loading}>`;
}

/** A kind's picture in the list, on a checkerboard (its transparency seen), or what phones draw instead. */
function ArtThumb({ k }) {
  const layer = layerOf(k);
  if (k.art?.url)
    return html`<div class="mk-thumb" title=${artLine(k.art)}><img src=${k.art.url} alt="" loading="lazy" /></div>${k.art.checked === false ? html`<br /><small class="muted">denetlenmedi</small>` : ''}`;
  return html`<div class="mk-thumb empty" title=${layer.text}><small>${layer.compiled ? 'Uygulama\u00adnın resmi' : 'Rozet'}</small></div>`;
}

/**
 * Checks a picked overlay in the browser as the app's server will (its header, then its pixels): { info, stats,
 * problem } (problem: the server's sentence, null when it passes here).
 */
async function checkArt(file, url, L) {
  if (file.size > L.bytes) return { problem: artProblem({ bytes: file.size, info: null }, L) };
  const info = artInfo(new Uint8Array(await file.arrayBuffer()));
  const early = artProblem({ bytes: file.size, info }, L);
  if (early) return { info, problem: early };
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = info.width;
    c.height = info.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, info.width, info.height);
    const stats = artStats(g.getImageData(0, 0, info.width, info.height).data, info.width, info.height, L.faceRadius);
    return { info, stats, problem: artProblem({ bytes: file.size, info, stats }, L) };
  } catch {
    return { info, problem: 'İz resmi okunamadı: bozuk ya da yarım bir PNG veya WebP' };
  }
}

const pct = (x) => `%${Math.round(x * 100)}`;

/** A new kind (`kind` none) or one to change: name, key (new only), time, what the same kind again does, on/off, the overlay. */
function KindEditor({ kind, all, limits: L, hours, gifts, storage, onClose, onSaved }) {
  const [v, setV] = useState(() => kindForm(kind));
  // A new kind's key follows its name until it is typed.
  const [keyTyped, setKeyTyped] = useState(false);
  // The overlay: { mode: 'keep' } (as it is), 'none' (taken off), 'file' ({ file, url, info, stats, problem, at }).
  const [art, setArt] = useState({ mode: 'keep' });
  const [step, setStep] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => () => art.url && URL.revokeObjectURL(art.url), [art.url]);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const fail = (m) => (setErr(m), showError(new Error(m)));

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErr(null);
    const url = URL.createObjectURL(file);
    setArt({ mode: 'file', file, url, checking: true });
    const check = await checkArt(file, url, L);
    setArt({ mode: 'file', file, url, ...check });
  };

  const save = async () => {
    setErr(null);
    const out = kindBody(v, kind, { nameMax: L.nameMax, taken: all });
    if (out.error) return fail(out.error);
    if (art.mode === 'file' && art.checking) return;
    if (art.mode === 'file' && art.problem) return fail(art.problem);
    const body = { ...out.body };
    try {
      if (art.mode === 'file') {
        let at = art.at;
        if (!at) {
          setStep('Resim yükleniyor…');
          at = await upload('markart', art.file);
          // A refused save keeps the upload: trying again (after changing the name, say) doesn't send it twice.
          setArt((a) => ({ ...a, at }));
        }
        body.art = at;
      }
      if (art.mode === 'none' && kind?.art) body.art = null;
      if (kind && !out.changed && body.art === undefined) return onClose();
      setStep(body.art ? 'Resim denetleniyor…' : 'Kaydediliyor…');
      const r = await post(kind ? '/api/app/mark-kinds/update' : '/api/app/mark-kinds', body);
      onSaved(kind ? `“${r?.kind?.name ?? kind.name}” kaydedildi` : `“${r?.kind?.name ?? body.name}” türü eklendi`);
    } catch (e) {
      fail(e.message);
    } finally {
      setStep(null);
    }
  };

  // What the preview draws: the picked picture, the one kept, or (taken off / none) what phones draw instead.
  const shown = art.mode === 'file' ? { ...(kind ?? { kind: v.kind }), art: { url: art.url, checked: true } } : art.mode === 'none' ? { ...kind, art: null } : (kind ?? { kind: v.kind });
  const timeHint = `1–168 saat ya da ${L.minutes?.min ?? 5}–${num(L.minutes?.max ?? 10_080)} dakika. Boş: Canlı ayardaki süre${hours > 0 ? ` (şu an ${durationText(hours * 60)})` : ''}. Hediyenin kendi süresi varsa o geçer.`;
  return html`<${Modal} title=${kind ? `İz türü: ${kind.name}` : 'Yeni iz türü'} wide onClose=${onClose}>
    <div class="form"><div class="grid2">
      <label class="field"><span>Ad *</span><input value=${v.name} maxlength=${L.nameMax} placeholder="Ör. Çamur" onInput=${(e) => setV({ ...v, name: e.target.value, ...(!kind && !keyTyped ? { kind: keyFromName(e.target.value) } : {}) })} /><small class="muted">Uygulamada görünen ad, 1–${L.nameMax} harf (ör. Kırık Cam).</small></label>
      <label class="field"><span>Anahtar *</span><input value=${v.kind} maxlength="24" disabled=${!!kind} placeholder="ör. camur" onInput=${(e) => (setKeyTyped(true), setV({ ...v, kind: e.target.value.toLowerCase() }))} /><small class="muted">${kind ? 'Anahtar sonradan değişmez.' : 'Küçük harf, rakam ve tire (ör. kirik-cam); Türkçe harf, boşluk ve alt çizgi olmaz. Sonradan değişmez.'}</small></label>
      <label class="field"><span>Süre (isteğe bağlı)</span><div class="row gap">
        <input inputmode="numeric" style="flex:1" value=${v.amount} placeholder="Canlı ayardaki süre" aria-label="Süre" onInput=${(e) => setV({ ...v, amount: e.target.value.replace(/[^\d]/g, '') })} />
        <select value=${v.unit} aria-label="Süre birimi" onChange=${set('unit')}><option value="hours">saat</option><option value="minutes">dakika</option></select>
      </div><small class="muted">${timeHint}</small></label>
      <label class="field"><span>Aynı iz yeniden gelince</span><select value=${v.stack} onChange=${set('stack')}>${Object.entries(STACK_TEXT).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select><small class="muted">${STACK_HELP[v.stack]} ${OTHER_KIND_TEXT}</small></label>
      <label class="field inline wide"><span><b>Açık</b>: kapalı türün hediyeleri düz hediye gibi gider (iz bırakmaz, temizlemez), görünen izleri görünmez; açınca süresi dolmamış izler geri gelir. Bir türü hemen durdurmanın yolu bu.</span><input type="checkbox" checked=${v.enabled} onChange=${set('enabled')} /></label>
    </div></div>

    <h3>İz resmi</h3>
    <p class="muted">${artRules(L)} Resmi uygulamanın sunucusu kaydederken piksel piksel denetler; uymayanı nedeniyle reddeder. Boşsa ${layerOf({ kind: v.kind }).compiled ? 'uygulamanın kendi resmi' : 'hediyenin küçük resmi (rozet)'} çizilir.</p>
    <div class="row gap wrap">
      <input type="file" accept="image/png,image/webp" aria-label="İz resmi dosyası" disabled=${!storage} onChange=${pick} />
      ${!storage && html`<span class="bad">Uygulamanın dosya deposu açık değil: resim yüklenemez.</span>`}
      ${art.mode === 'keep' && kind?.art && html`<span class="muted">Şimdiki resim: ${artLine(kind.art) || 'yüklü'}${kind.art.checked === false ? ' · denetlenmedi (telefonlara gitmez)' : ''}</span> <${Button} kind="ghost" onClick=${() => setArt({ mode: 'none' })}>Resmi kaldır</${Button}>`}
      ${art.mode === 'none' && html`<span class="muted">Kaydedince resim kalkar: ${layerOf({ kind: kind?.kind }).compiled ? 'uygulamanın kendi resmi' : 'hediyenin rozeti'} çizilir.</span> <${Button} kind="ghost" onClick=${() => setArt({ mode: 'keep' })}>Vazgeç</${Button}>`}
      ${art.mode === 'file' && html`<span class="muted">${art.file.name}${art.info ? ` · ${art.info.width} × ${art.info.height}` : ''}${art.stats ? ` · ${pct(art.stats.clear)} saydam · yüz ${pct(art.stats.face)} dolu` : ''}</span> <${Button} kind="ghost" onClick=${() => setArt({ mode: 'keep' })}>Vazgeç</${Button}>`}
    </div>
    ${art.mode === 'file' && art.checking && html`<p class="muted">Resim denetleniyor…</p>`}
    ${art.mode === 'file' && !art.checking && (art.problem
      ? html`<p class="note bad">${art.problem}</p>`
      : html`<p class="note">Bu tarayıcıdaki denetimden geçti${art.stats ? ` (${pct(art.stats.clear)} saydam, yüz dairesinin ${pctOf(art.stats.face)} dolu)` : ''}. Son sözü kaydederken uygulamanın sunucusu söyler.${art.info?.width > L.servePx ? ` Telefonlar için ${L.servePx} piksele küçültülür.` : ''}</p>`)}

    <h3>Önizleme</h3>
    <${MarkPreview} layer=${layerOf(shown)} badge=${badgeOf(kind, gifts)} />

    ${err && html`<p class="note bad" role="alert" style="margin-top:12px">${err}</p>`}
    <div class="row end gap" style="margin-top:12px">
      <${Button} onClick=${onClose} disabled=${!!step}>Vazgeç</${Button}>
      <${Button} kind="primary" disabled=${!!step || (art.mode === 'file' && art.checking)} onClick=${save}>${step ?? (kind ? 'Kaydet' : 'Türü ekle')}</${Button}>
    </div>
  </${Modal}>`;
}

/** The photo with its mark: the overlay over it (cover, inside the circle), else the gift's badge where phones put one. */
function MarkedPhoto({ size, photo, layer, badge }) {
  const b = badgeBox(size);
  return html`<div class="mk-photo">
    <img class="mk-face" src=${photo} alt="" />
    ${layer.art && html`<img class="mk-art" src=${layer.art} alt="" />`}
    ${layer.badge && html`<span class="mk-badge" style=${`width:${b.size}px;height:${b.size}px;left:${b.left}%;top:${b.top}%`}>${badge.icon ? html`<img src=${badge.icon} alt="" />` : html`<i style=${`font-size:${Math.round(b.size * 0.78)}px`}>${badge.emoji}</i>`}</span>`}
  </div>`;
}

/**
 * One face as the app draws it at `size` dp: plain (the photo's circle), in the VIP ring (the app's FramedAvatar: the
 * ring's gradient, a gap of the ground's colour, the mark inside it, the level's badge at the top right) or in a shop
 * frame (Mağaza's FramePreview, its picture over the photo).
 */
function Face({ size, look, frame, ground, ...photo }) {
  if (look === 'vip')
    return html`<div class="mk-vip" style=${`width:${size}px;height:${size}px;background:linear-gradient(180deg, ${VIP_RING.colors[0]}, ${VIP_RING.colors[1]})`}>
      <i class="mk-vip-gap" style=${`background:${ground}`}></i>
      <div class="mk-vip-in"><${MarkedPhoto} size=${size} ...${photo} /></div>
      <span class="mk-vip-badge" style=${`font-size:${Math.round(size * 0.3)}px;top:${-size * 0.14}px;right:${-size * 0.07}px`}>${VIP_RING.emoji}</span>
    </div>`;
  if (look === 'frame' && frame)
    return html`<${FramePreview} src=${frame.art.motion?.url ?? frame.art.url} hole=${frame.art.hole} at=${frame.art.at} size=${frameBox(size, frame.art.hole)}><${MarkedPhoto} size=${size} ...${photo} /></${FramePreview}>`;
  return html`<div style=${`width:${size}px;height:${size}px`}><${MarkedPhoto} size=${size} ...${photo} /></div>`;
}

/**
 * The preview: the mark on a photo at the app's sizes, without a frame, in the VIP ring and in a shop frame (one of
 * Mağaza's own frames with a picture: only with its permission), on the dark and the light ground. `layer`: what phones
 * draw (mark-kinds.js layerOf); `badge`: the leaving gift's picture.
 */
export function MarkPreview({ layer, badge }) {
  const { can } = useApp();
  const [photo, setPhoto] = useState(null);
  const shop = useApi(can('app.shop') ? '/api/app/shop' : null);
  const frames = (shop.data?.items ?? []).filter((x) => x.kind === 'frame' && x.art?.url && x.art.hole);
  const [frameId, setFrameId] = useState(null);
  const frame = frames.find((x) => x.id === frameId) ?? frames[0] ?? null;
  useEffect(() => () => photo && URL.revokeObjectURL(photo), [photo]);
  const looks = [
    ['plain', 'Çerçevesiz'],
    ['vip', `VIP ${VIP_RING.level} halkası`],
    ...(frame ? [['frame', `Mağaza çerçevesi: ${frame.name}`]] : []),
  ];
  const own = { photo: photo ?? SAMPLE_PHOTO, layer, badge };
  return html`<div class="mk-preview">
    <div class="row gap wrap" style="margin-bottom:8px">
      <label class="field inline"><span>Kendi fotoğrafınızla bakın (yüklenmez, yalnız bu sayfada)</span><input type="file" accept="image/*" aria-label="Önizleme fotoğrafı" onChange=${(e) => { const f = e.target.files?.[0]; if (f) setPhoto(URL.createObjectURL(f)); }} /></label>
      ${photo && html`<${Button} kind="ghost" onClick=${() => setPhoto(null)}>Örnek fotoğrafa dön</${Button}>`}
      ${frames.length > 1 && html`<label class="field inline"><span>Mağaza çerçevesi</span><select value=${frame?.id} onChange=${(e) => setFrameId(e.target.value)}>${frames.map((f) => html`<option value=${f.id}>${f.name}</option>`)}</select></label>`}
    </div>
    <p class="muted">Uygulamanın boylarında (1 dp = 1 piksel): ${layer.text}.${layer.compiled && !layer.art ? ' Uygulamanın kendi resmi burada çizilmez; telefonda Yönetim › Hediyeler › İz türlerini önizle’den bakın ya da kendi resminizi yükleyin.' : ''}${layer.badge ? ' Rozet: iz bırakan hediyenin küçük resmi.' : ''}${!frame && can('app.shop') && shop.data ? ' Mağazada resmi olan çerçeve yok: çerçeveli hali gösterilmez.' : ''}</p>
    <div class="mk-grounds">${GROUNDS.map((g) => html`<div class="mk-ground" style=${`background:${g.bg};color:${g.ink}`}>
      <b>${g.label}</b>
      ${looks.map(([key, label]) => html`<div class="mk-look">
        <small>${label}</small>
        <div class="mk-row">${FACES.map((f) => html`<div class="mk-cell" title=${`${f.label}: ${f.size} dp`}>
          <${Face} size=${f.size} look=${key} frame=${frame} ground=${g.bg} ...${own} />
          <small>${f.size}</small>
        </div>`)}</div>
      </div>`)}
    </div>`)}</div>
    <small class="muted">${FACES.map((f) => `${f.size}: ${f.label}`).join(' · ')}</small>
  </div>`;
}
