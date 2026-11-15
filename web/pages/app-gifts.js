// Uygulama › Hediyeler: the Similar Club app's gifts, changed without an app update (the app's Yönetim › Hediyeler
// does the same; server/app-admin.ts passes the calls on as the signed-in panel user): the ones the team adds, and the
// app's own (?builtin=1), whose every value (name, price, shelf, VIP, emoji, on/off, order, icon, video) can change
// and go back to the app's ("Orijinale dön"). A list per shelf in the phones' order, an editor, and a preview: the
// shelf tile, the icon, and the transparent video drawn over a stage the way the phones draw it. Files go through this
// server to the app's storage; the app checks them when the gift is saved and converts a WebM / MOV / SVGA itself.
// Nothing removes a background: the editor says so before a file is picked.
import { Badge, Button, Loading, Modal, Page, Table, act, dateTimeTr, html, num, post, showError, toast, useApi, useApp, useEffect, useRef, useState } from '../lib.js';

const CATS = [
  ['hot', 'Popüler'],
  ['couple', 'İkili'],
  ['gameplay', 'Kutlama'],
  ['privilege', 'Özel'],
];
const CAT = Object.fromEntries(CATS);
const FILLS = { 0.45: 'Küçük', 0.6: 'Orta', 0.8: 'Büyük', 1: 'Tam ekran' };
const mb = (n) => (n / 1024 / 1024).toLocaleString('tr-TR', { maximumFractionDigits: 1 });
const sec = (ms) => (ms / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 1 });
/** A file's size as people read it: KB under a megabyte. */
const size = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${mb(n)} MB`);
const ending = (name) => (/\.([A-Za-z0-9]{1,8})$/.exec(name ?? '')?.[1] ?? '').toLowerCase();
/** What "Değiştirildi" names, as the app answers it (`changed`). */
const FIELD_TR = { name: 'ad', emoji: 'emoji', price: 'fiyat', cat: 'raf / VIP', enabled: 'rafta / kapalı', icon: 'ikon', video: 'video' };
const changedText = (g) => (g.changed ?? []).map((f) => FIELD_TR[f] ?? f).join(', ');
const KINDS = [
  ['all', 'Hepsi'],
  ['app', 'Uygulamanın'],
  ['mine', 'Eklenenler'],
  ['changed', 'Değiştirilenler'],
];
const kindOk = (k, g) => k === 'all' || (k === 'app' && g.builtin) || (k === 'mine' && !g.builtin) || (k === 'changed' && g.builtin && g.changed?.length > 0);

/** What a picked file is uploaded as (the app's upload kinds), or null when the app won't take it. */
function typeOf(kind, file) {
  const t = (file.type || '').toLowerCase();
  const e = ending(file.name);
  if (kind === 'gifticon') return t === 'image/png' || e === 'png' ? 'image/png' : t === 'image/webp' || e === 'webp' ? 'image/webp' : null;
  if (kind === 'giftvideo') return t === 'video/mp4' || e === 'mp4' ? 'video/mp4' : null;
  if (e === 'svga') return 'application/x-svga';
  if (t === 'video/webm' || e === 'webm') return 'video/webm';
  if (t === 'video/quicktime' || e === 'mov') return 'video/quicktime';
  return null;
}
/** A picked video: a ready stacked MP4, a transparent source the app converts, or an SVGA. */
const videoKindOf = (file) => (ending(file.name) === 'svga' ? 'svga' : typeOf('giftsource', file) ? 'source' : typeOf('giftvideo', file) ? 'stacked' : null);

/** Uploads a picked file through this server to the app's storage; resolves with the address to save. */
function upload(kind, file, onProgress) {
  return new Promise((resolve, reject) => {
    const type = typeOf(kind, file);
    if (!type) return reject(new Error('Bu dosya türü yüklenemez'));
    const x = new XMLHttpRequest();
    x.open('POST', `/api/app/upload?kind=${kind}`);
    x.setRequestHeader('content-type', type);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    x.onload = () => {
      let d = null;
      try {
        d = JSON.parse(x.responseText);
      } catch {}
      if (x.status === 200 && d?.url) resolve(d.url);
      else reject(new Error(d?.error ?? `Yükleme başarısız (${x.status})`));
    };
    x.onerror = () => reject(new Error('Yükleme başarısız: bağlantınızı kontrol edin'));
    x.send(file);
  });
}

/** A link plainly to a video or to a picture, by its file name (the app's server checks the file itself anyway). */
const VIDEO_LINK = /\.(mp4|m4v|webm|mov|svga)(?:[?#]|$)/i;
const IMAGE_LINK = /\.(png|webp|jpe?g|gif)(?:[?#]|$)/i;

function videoLine(g) {
  if (g.job?.status === 'processing') return html`<${Badge} s="pending" label=${g.video ? 'Yeni video çevriliyor' : 'Video çevriliyor'} />`;
  // The whole sentence (what is wrong and how to export it), wrapped: the cell would otherwise cut it off.
  if (g.job?.status === 'failed')
    return html`<div style="white-space:normal;min-width:240px;max-width:420px"><${Badge} s="error" label="Çevrilemedi" /> <small class="muted">${g.job.error}</small>${g.job.preview ? html`<br /><small>Nasıl göründüğü: <strong>Önizle</strong></small>` : ''}</div>`;
  // The app's own clip, as long as nobody replaced or stopped it.
  const own = g.builtin && !g.changed?.includes('video');
  if (g.video) return html`<${Badge} s="active" label=${`${own ? 'Uygulamanın videosu' : 'Hazır'} · ${sec(g.video.ms)} sn · ${size(g.video.bytes)}`} />`;
  if (g.videoOff) return html`<span class="muted">Kapatıldı (ikon uçar)</span>`;
  return html`<span class="muted">Yok (ikon uçar)</span>`;
}

export function AppGifts() {
  const { can, meta } = useApp();
  const [shelf, setShelf] = useState('all');
  const [kind, setKind] = useState('all');
  const [edit, setEdit] = useState(null);
  const [playing, setPlaying] = useState(null);
  // builtin=1: the app's own gifts too, with their values in the app and what was changed.
  const list = useApi(meta.app_link ? '/api/app/gifts?builtin=1' : null);
  const processing = !!list.data?.gifts.some((g) => g.job?.status === 'processing');
  // A video converts on the app's server: the list is read again every few seconds until it is done.
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(list.reload, 4000);
    return () => clearInterval(t);
  }, [processing]);

  if (!meta.app_link)
    return html`<${Page} title="Uygulama hediyeleri"><div class="empty bad">Uygulama bağlantısı ayarlı değil: sunucuda FC_APP_API_URL ve FC_APP_API_KEY gerekli.</div></${Page}>`;

  const move = async (gifts, g, by) => {
    const row = gifts.filter((x) => x.cat === g.cat);
    const i = row.findIndex((x) => x.id === g.id);
    const j = i + by;
    if (j < 0 || j >= row.length) return;
    const ids = row.map((x) => x.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    (await act(() => post('/api/app/gifts/order', { ids }), 'Sıra kaydedildi')) && list.reload();
  };
  const toggle = async (g) => {
    const off = g.builtin
      ? `“${g.name}” raflardan kalksın mı? Hediye panelinde görünmez; çantasında olan (ya da eski bir telefon) yine gönderebilir. Burada kalır ve yeniden rafa konabilir.`
      : `“${g.name}” raflardan kalksın mı? Gönderilemez; burada kalır ve yeniden rafa konabilir.`;
    if (!confirm(g.enabled ? off : `“${g.name}” herkesin hediye panelinde görünsün mü?`)) return;
    (await act(() => post('/api/app/gifts/update', { id: g.id, enabled: !g.enabled }), g.enabled ? 'Raftan kaldırıldı' : 'Rafa kondu')) && list.reload();
  };
  const remove = async (g) => {
    if (!confirm(`“${g.name}” raflardan ve bu listeden kalksın mı? İkonu ve videosu silinir; gönderim geçmişi kalır. Geri alınamaz.`)) return;
    (await act(() => post('/api/app/gifts/delete', { id: g.id }), 'Hediye silindi')) && list.reload();
  };
  /** One of the app's gifts back to the app's values (its place on the shelf stays). */
  const reset = async (g) => {
    if (!confirm(`“${g.name}” uygulamadaki haline dönsün mü? Geri alınacak: ${changedText(g)}. Yüklenen ikon ve video silinir; raftaki yeri değişmez.`)) return;
    (await act(() => post('/api/app/gifts/reset', { id: g.id }), 'Orijinaline döndü')) && list.reload();
  };

  return html`<${Page}
    title="Uygulama hediyeleri"
    subtitle="Buradan eklenen hediye uygulama güncellemesi olmadan herkesin hediye panelinde, rafının başında görünür. Uygulamanın kendi hediyelerinin de adı, fiyatı, rafı, VIP'i, sırası, rafta olup olmadığı, ikonu ve videosu buradan değişir ve istenince orijinaline döner. Fiyatı uygulamanın sunucusu belirler; fiyatı değişen uygulama hediyesini eski APK'lar göstermez. Her işlem hem burada hem uygulamada denetim kaydına adınızla yazılır."
    actions=${can('app.gifts') && html`<${Button} kind="primary" disabled=${!list.data?.storage} onClick=${() => setEdit({})}>Yeni hediye</${Button}>`}
  >
    <div class="row gap wrap" style="margin-bottom:6px">
      ${[['all', 'Tümü'], ...CATS].map(([k, l]) => html`<button class=${`chip ${shelf === k ? 'on' : ''}`} onClick=${() => setShelf(k)}>${l}</button>`)}
    </div>
    <div class="row gap wrap" style="margin-bottom:10px">
      ${KINDS.map(([k, l]) => html`<button class=${`chip ${kind === k ? 'on' : ''}`} onClick=${() => setKind(k)}>${l}</button>`)}
    </div>
    <${Loading} state=${list}>${(d) => html`
      ${!d.storage && html`<div class="empty bad">Uygulamanın dosya deposu açık değil: ikon ve video yüklenemez, yeni hediye eklenemez.</div>`}
      <${Table}
        empty="Bu süzgeçte hediye yok."
        columns=${[
          { key: 'icon', label: '', render: (g) => (g.icon ? html`<img class="gift-icon" src=${g.icon} alt="" loading="lazy" />` : html`<span class="gift-emoji">${g.emoji}</span>`) },
          {
            key: 'name',
            label: 'Ad',
            render: (g) => html`<strong>${g.name}</strong> ${g.builtin ? html`<${Badge} s="info" label="Uygulamanın" />` : ''}
              ${g.changed?.length > 0 ? html` <${Badge} s="warning" label=${`Değiştirildi: ${changedText(g)}`} />` : ''}
              <br /><small class="muted">${g.id}${g.iconLink || g.videoLink ? ' · 🔗 bağlantıdan' : ''}${g.builtin && g.changed?.includes('name') ? ` · uygulamada: ${g.original.name}` : ''}</small>`,
          },
          {
            key: 'cat',
            label: 'Raf ve sıra',
            render: (g) => {
              const row = d.gifts.filter((x) => x.cat === g.cat);
              const i = row.findIndex((x) => x.id === g.id);
              return html`<span class="row gap">${CAT[g.cat]}${g.cat === 'privilege' ? ` · VIP ${g.minSvip}+` : ''} · ${i + 1}.
                ${can('app.gifts') && html`<button class="btn ghost" aria-label="Bir üste" disabled=${i === 0} onClick=${() => move(d.gifts, g, -1)}>↑</button><button class="btn ghost" aria-label="Bir alta" disabled=${i === row.length - 1} onClick=${() => move(d.gifts, g, 1)}>↓</button>`}</span>`;
            },
          },
          {
            key: 'price',
            label: 'Fiyat (jeton)',
            align: 'right',
            render: (g) => html`${num(g.price)}${g.builtin && g.price !== g.original.price ? html`<br /><small class="muted">uygulamada <s>${num(g.original.price)}</s></small>` : ''}`,
          },
          {
            key: 'enabled',
            label: 'Durum',
            render: (g) =>
              html`<${Badge} s=${g.enabled ? 'active' : 'passive'} label=${g.enabled ? 'Rafta' : 'Kapalı'} />${g.builtin && !g.enabled && !g.original.enabled && !g.changed?.includes('enabled') ? html`<br /><small class="muted">uygulamada duraklatılmış</small>` : ''}`,
          },
          { key: 'video', label: 'Video', render: videoLine },
          {
            key: 'sent',
            label: 'Gönderim',
            align: 'right',
            render: (g) => (g.sent.count ? html`${num(g.sent.count)} · ${num(g.sent.coins)} jeton${g.sent.days ? html`<br /><small class="muted">son ${g.sent.days} gün</small>` : ''}` : '—'),
          },
          { key: 'updatedAt', label: 'Son değişiklik', render: (g) => html`${dateTimeTr(g.updatedAt)}<br /><small class="muted">${g.updatedBy?.name ?? ''}</small>` },
          {
            key: 'a',
            label: '',
            render: (g) => html`<span class="row gap">
              ${g.video && html`<${Button} kind="ghost" onClick=${() => setPlaying({ src: g.video.url })}>Oynat</${Button}>`}
              ${g.job?.status === 'failed' && g.job.preview && html`<${Button} kind="ghost" onClick=${() => setPlaying({ src: g.job.preview, refused: true })}>Önizle</${Button}>`}
              ${can('app.gifts') && html`<${Button} onClick=${() => setEdit({ gift: g })}>Düzenle</${Button}>
              <${Button} kind="ghost" onClick=${() => toggle(g)}>${g.enabled ? 'Raftan kaldır' : 'Rafa koy'}</${Button}>
              ${g.builtin
                ? g.changed?.length > 0 && html`<${Button} kind="ghost" onClick=${() => reset(g)}>Orijinale dön</${Button}>`
                : html`<${Button} kind="danger" onClick=${() => remove(g)}>Sil</${Button}>`}`}
            </span>`,
          },
        ]}
        rows=${d.gifts.filter((g) => (shelf === 'all' || g.cat === shelf) && kindOk(kind, g))}
      />`}</${Loading}>
    ${edit && list.data && html`<${Editor} gift=${edit.gift} admin=${list.data} onClose=${() => setEdit(null)} onSaved=${(text) => (setEdit(null), toast(text), list.reload())} />`}
    ${playing && html`<${Modal} title="Önizleme" onClose=${() => setPlaying(null)}>
      ${playing.refused && html`<p class="note bad">Kullanılmayan video: odada böyle, arka planıyla kutu gibi görünürdü. Hediyedeki video değişmedi.</p>`}
      <${Stage} src=${playing.src} onEnd=${() => setPlaying(null)} />
    </${Modal}>`}
  </${Page}>`;
}

/** A stacked video (colour on top, alpha below) drawn transparent over a stage, as the phones draw it. */
function Stage({ src, onEnd }) {
  const canvas = useRef(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const v = document.createElement('video');
    v.src = src;
    v.playsInline = true;
    const c = canvas.current;
    const g = c.getContext('2d', { willReadFrequently: true });
    const off = document.createElement('canvas');
    const og = off.getContext('2d', { willReadFrequently: true });
    let raf = 0;
    const draw = () => {
      if (v.readyState >= 2 && v.videoWidth) {
        const w = v.videoWidth;
        const h = Math.floor(v.videoHeight / 2);
        if (c.width !== w || c.height !== h) {
          c.width = w;
          c.height = h;
          off.width = w;
          off.height = h * 2;
        }
        og.drawImage(v, 0, 0);
        const top = og.getImageData(0, 0, w, h);
        const mask = og.getImageData(0, h, w, h).data;
        const px = top.data;
        for (let i = 0; i < px.length; i += 4) px[i + 3] = mask[i];
        g.putImageData(top, 0, 0);
      }
      raf = requestAnimationFrame(draw);
    };
    v.addEventListener('ended', () => onEnd?.());
    // Sound first; a browser that refuses to start a sounding video starts it muted.
    v.play().catch(() => {
      v.muted = true;
      setBlocked(true);
      v.play().catch(() => {});
    });
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      v.pause();
      v.removeAttribute('src');
      v.load();
    };
  }, [src]);
  return html`<div class="alpha-stage"><canvas ref=${canvas} class="alpha-video"></canvas>${blocked && html`<small class="muted">Tarayıcı sesi kapattı</small>`}</div>`;
}

/** A file's size in words: KB under a megabyte. */
/** The file name at the end of a link, for the line under the field. */
const linkName = (link) => {
  try {
    return decodeURIComponent(new URL(link).pathname.split('/').filter(Boolean).pop() ?? '') || link;
  } catch {
    return link;
  }
};

function Editor({ gift, admin, onClose, onSaved }) {
  const L = admin.limits;
  // One of the app's own gifts: its values in the app (`original`) show under each field that differs.
  const app = !!gift?.builtin;
  const o = gift?.original;
  const [v, setV] = useState({
    name: gift?.name ?? '',
    price: gift ? String(gift.price) : '',
    cat: gift?.cat ?? 'hot',
    minSvip: String(gift?.minSvip || 1),
    emoji: gift?.emoji ?? '',
    enabled: gift ? gift.enabled : true,
  });
  // A picked or fetched icon ({ file, url } / { at, url, link }), or { reset: true }: back to the app's picture.
  const [icon, setIcon] = useState(null);
  const [video, setVideo] = useState(gift?.video || gift?.job ? { mode: 'keep' } : { mode: 'none' });
  const [step, setStep] = useState(null);
  const [preview, setPreview] = useState(null);
  // "ya da bağlantı yapıştır": the links typed (a gift's kept ones to start with) and the one downloading now.
  const [links, setLinks] = useState({ icon: gift?.iconLink ?? '', video: gift?.videoLink ?? '' });
  const [pulling, setPulling] = useState(null);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const iconUrl = icon?.reset ? (o?.icon ?? null) : icon ? icon.url : (gift?.icon ?? null);
  useEffect(() => () => icon?.file && URL.revokeObjectURL(icon.url), [icon]);
  /** The app's value of a field, under it, when the gift's differs. */
  const was = (show, text) => app && show && html`<small class="muted">Uygulamada: ${text}</small>`;

  const pickIcon = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!typeOf('gifticon', file)) return showError(new Error('İkon PNG ya da WebP olmalı'));
    if (file.size > L.iconBytes) return showError(new Error(`İkon en fazla ${mb(L.iconBytes)} MB olabilir`));
    setIcon({ file, url: URL.createObjectURL(file) });
  };
  const pickVideo = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const kind = videoKindOf(file);
    if (!kind) return showError(new Error('Hazır yığılmış MP4, saydam WebM / MOV ya da SVGA seçin'));
    if (kind === 'svga' && !admin.svga) return showError(new Error('Uygulamanın sunucusu şu an SVGA çeviremiyor'));
    if (kind === 'source' && !admin.convert) return showError(new Error('Uygulamanın sunucusu şu an video çeviremiyor'));
    // An SVGA has its own, smaller limit (the app's server reads it whole); older servers give none.
    const max = kind === 'stacked' ? L.videoBytes : kind === 'svga' ? (L.svgaBytes ?? L.sourceBytes) : L.sourceBytes;
    if (file.size > max) return showError(new Error(`Dosya en fazla ${mb(max)} MB olabilir (bu ${mb(file.size)} MB)`));
    setVideo({ mode: 'file', file, kind, fill: L.fill, url: kind === 'stacked' ? URL.createObjectURL(file) : null });
  };

  /**
   * A file from the link typed for `slot`: the app's server downloads it once and keeps it as if uploaded. A link
   * plainly for the other field (a video's in the icon's, a picture's in the video's) moves there and is fetched for it.
   */
  const pull = async (slot, url = links[slot].trim()) => {
    const other = slot === 'icon' && VIDEO_LINK.test(url) ? 'video' : slot === 'video' && IMAGE_LINK.test(url) ? 'icon' : null;
    if (other) {
      setLinks((x) => ({ ...x, [slot]: (slot === 'icon' ? gift?.iconLink : gift?.videoLink) ?? '', [other]: url }));
      toast(other === 'video' ? 'Bu bir video bağlantısı: Video alanına taşındı' : 'Bu bir resim bağlantısı: İkon alanına taşındı');
      return pull(other, url);
    }
    setPulling(slot);
    try {
      const out = await post('/api/app/gifts/fetch', { slot, url });
      if (slot === 'icon') setIcon({ at: out.url, url: out.preview, link: out.link, bytes: out.bytes });
      else {
        const kind = out.svga ? 'svga' : out.video === 'stacked' ? 'stacked' : 'source';
        setVideo({ mode: 'link', at: out.url, link: out.link, bytes: out.bytes, kind, fill: L.fill, url: kind === 'stacked' ? out.preview : null, name: linkName(out.link) });
      }
      setLinks((x) => ({ ...x, [slot]: out.link }));
      toast(`${slot === 'icon' ? 'İkon' : 'Video'} bağlantıdan alındı (${size(out.bytes)}); kaydedince hediyeye geçer`);
    } catch (e) {
      showError(e);
    } finally {
      setPulling(null);
    }
  };
  /** The link field next to a file picker (a plain call, not a component, so typing keeps the focus). */
  const linkRow = (slot, example) => {
    const typed = links[slot].trim();
    const again = !!typed && typed === (slot === 'icon' ? gift?.iconLink : gift?.videoLink);
    return html`<div class="row gap wrap" style="margin-top:6px">
      <input type="url" style="flex:1;min-width:280px" value=${links[slot]} placeholder=${`ya da bağlantı yapıştırın: ${example}`} aria-label=${slot === 'icon' ? 'İkonun bağlantısı' : 'Videonun bağlantısı'}
        onInput=${(e) => setLinks({ ...links, [slot]: e.target.value })} />
      <${Button} disabled=${!!pulling || !!step || !typed} onClick=${() => pull(slot)}>${pulling === slot ? 'İndiriliyor…' : again ? 'Bağlantıdan yeniden çek' : 'Bağlantıdan çek'}</${Button}>
    </div>`;
  };

  /** One of the app's gifts: its video back to the app's own clip (a separate call, nothing else changes). */
  const videoBack = async () => {
    if (!confirm('Video uygulamadaki haline dönsün mü? Yüklenen video silinir.')) return;
    if (await act(() => post('/api/app/gifts/reset', { id: gift.id, fields: ['video'] }))) onSaved('Video orijinaline döndü');
  };

  const save = async () => {
    const name = v.name.replace(/\s+/g, ' ').trim();
    const price = Number(v.price);
    if (name.length < L.nameMin || name.length > L.nameMax) return showError(new Error(`Ad ${L.nameMin}–${L.nameMax} karakter olmalı`));
    if (!Number.isSafeInteger(price) || price < 1 || price > L.priceMax) return showError(new Error(`Fiyat 1–${num(L.priceMax)} jeton arasında bir tam sayı olmalı`));
    if (!gift && !icon) return showError(new Error('İkon seçin'));
    try {
      let iconAt;
      if (icon?.at) iconAt = icon.at;
      else if (icon?.file) {
        setStep('İkon yükleniyor…');
        iconAt = await upload('gifticon', icon.file);
      }
      let videoSpec;
      if (video.mode === 'none') videoSpec = null;
      if (video.mode === 'file') {
        const kind = video.kind === 'stacked' ? 'giftvideo' : 'giftsource';
        const url = await upload(kind, video.file, (p) => setStep(`Video yükleniyor %${Math.round(p * 100)}`));
        videoSpec = video.kind === 'stacked' ? { url, kind: 'stacked' } : { url, kind: 'source', ...(video.kind === 'svga' ? { fill: video.fill } : {}) };
      }
      if (video.mode === 'link') {
        const url = video.at;
        videoSpec = video.kind === 'stacked' ? { url, kind: 'stacked' } : { url, kind: 'source', ...(video.kind === 'svga' ? { fill: video.fill } : {}) };
      }
      // Where a new file came from (null: picked from this computer), kept for "Bağlantıdan yeniden çek".
      const iconLink = icon && !icon.reset ? (icon.link ?? null) : undefined;
      const videoLink = video.mode === 'link' ? video.link : video.mode === 'file' ? null : undefined;
      setStep('Kaydediliyor…');
      const fields = { name, price, cat: v.cat, minSvip: v.cat === 'privilege' ? Number(v.minSvip) : 0, emoji: v.emoji.trim(), enabled: !!v.enabled };
      if (gift) {
        const patch = {};
        for (const k of ['name', 'price', 'cat', 'minSvip', 'enabled']) if (fields[k] !== gift[k]) patch[k] = fields[k];
        if ((fields.emoji || (app ? o.emoji : '🎁')) !== gift.emoji) patch.emoji = fields.emoji;
        if (iconAt) patch.icon = iconAt;
        // Back to the app's picture.
        if (icon?.reset) patch.icon = null;
        if (iconLink !== undefined) patch.iconLink = iconLink;
        if (videoLink !== undefined) patch.videoLink = videoLink;
        if (videoSpec !== undefined && !(videoSpec === null && !gift.video && !gift.job)) patch.video = videoSpec;
        if (!Object.keys(patch).length) return onClose();
        await post('/api/app/gifts/update', { id: gift.id, ...patch });
      } else {
        await post('/api/app/gifts', { ...fields, icon: iconAt, video: videoSpec ?? null, iconLink: iconLink ?? null, videoLink: videoLink ?? null });
      }
      onSaved(videoSpec?.kind === 'source' ? 'Kaydedildi; video uygulamanın sunucusunda çevriliyor' : gift ? 'Kaydedildi' : 'Hediye eklendi');
    } catch (e) {
      showError(e);
    } finally {
      setStep(null);
    }
  };

  const price = Number(v.price);
  return html`<${Modal} title=${gift ? `${gift.name}${app ? ' (uygulamanın hediyesi)' : ''}` : 'Yeni hediye'} wide onClose=${onClose}>
    ${app && html`<p class="note">Uygulamayla gelen bir hediye. Değiştirdiğiniz her şey uygulama güncellemesi olmadan telefonlara gider; listedeki <b>Orijinale dön</b> hepsini geri alır. Fiyatı değişirse eski APK'lar bu hediyeyi göstermez (yanlış fiyat göstermesinler diye).</p>`}
    <div class="form"><div class="grid2">
      <label class="field"><span>Ad *</span><input value=${v.name} maxlength=${L.nameMax} onInput=${set('name')} placeholder="Ör. Altın Yıldız" />${was(v.name.trim() !== o?.name, o?.name)}</label>
      <label class="field"><span>Fiyat (jeton) *</span><input inputmode="numeric" value=${v.price} onInput=${(e) => setV({ ...v, price: e.target.value.replace(/[^\d]/g, '') })} placeholder="Ör. 9999" /><small class="muted">1–${num(L.priceMax)} jeton; değişiklik yeni gönderimlerden itibaren geçer.</small>${was(price !== o?.price, `${num(o?.price)} jeton`)}</label>
      <label class="field"><span>Raf</span><select value=${v.cat} onChange=${set('cat')}>${CATS.map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>${was(v.cat !== o?.cat, `${CAT[o?.cat]}${o?.cat === 'privilege' ? ` · VIP ${o.minSvip}+` : ''}`)}</label>
      ${v.cat === 'privilege' && html`<label class="field"><span>En düşük VIP seviyesi</span><select value=${v.minSvip} onChange=${set('minSvip')}>${Array.from({ length: L.svipMax }, (_, i) => html`<option value=${String(i + 1)}>VIP ${i + 1}</option>`)}</select></label>`}
      <label class="field"><span>Emoji ${app ? '' : '(isteğe bağlı)'}</span><input value=${v.emoji} maxlength="8" onInput=${set('emoji')} placeholder=${app ? o.emoji : '🎁'} /><small class="muted">Sohbet satırlarında ve ikon yüklenmeden önce görünür.</small>${was(v.emoji.trim() && v.emoji.trim() !== o?.emoji, o?.emoji)}</label>
      <label class="field inline"><span>Rafta (herkes görür)</span><input type="checkbox" checked=${v.enabled} onChange=${set('enabled')} />${was(!!v.enabled !== o?.enabled, o?.enabled ? 'rafta' : 'duraklatılmış')}</label>
    </div></div>

    <h3>İkon</h3>
    <p class="muted">Saydam (arka planı silinmiş) PNG ya da WebP, kare, ${L.iconMinPx}–${L.iconMaxPx} piksel (önerilen 512 × 512), en çok ${mb(L.iconBytes)} MB.${app ? ' Seçmezseniz uygulamanın resmi kalır.' : ''}</p>
    <div class="row gap wrap">
      <input type="file" accept="image/png,image/webp" aria-label="İkon dosyası" onChange=${pickIcon} />
      ${app && (gift.changed?.includes('icon') || (icon && !icon.reset)) && !icon?.reset && html`<${Button} kind="ghost" onClick=${() => setIcon({ reset: true })}>Uygulamanın resmine dön</${Button}>`}
      ${icon?.reset && html`<span class="muted">Kaydedince uygulamanın resmi döner.</span> <${Button} kind="ghost" onClick=${() => setIcon(null)}>Vazgeç</${Button}>`}
    </div>
    ${linkRow('icon', 'https://alanadiniz.com/hediyeler/yuzuk.png')}
    ${icon?.at && html`<small class="muted">Bağlantıdan alındı: ${linkName(icon.link)} · ${size(icon.bytes)}</small>`}

    <h3>Video (isteğe bağlı)</h3>
    <p class="note bad">Arka plan silme yapılmaz. Uygulamanın sunucusu yalnız saydam (arka planı silinmiş) videoyu çevirir; siyah ya da renkli zeminli video reddedilir.</p>
    <ul class="muted">
      <li>Hazır yığılmış MP4: üst yarı renk, alt yarı alfa (ör. 540 × 1920), ${sec(L.videoMinMs)}–${sec(L.videoMaxMs)} sn, en çok ${mb(L.videoBytes)} MB. Olduğu gibi kullanılır.</li>
      <li>Saydam WebM (VP8/VP9 alfa) ya da ProRes 4444 .mov, en çok ${mb(L.sourceBytes)} MB: ${L.width} × ${L.height}, ${L.fps} fps, sesli videoya çevrilir. <b>Dosya küçük olsun:</b> videoyu bu boyutta (${L.width} × ${L.height}, ${L.fps} fps) dışa aktarın; uygulamada görüntü aynı kalır, dosya kabaca dörtte birine iner.</li>
      <li>SVGA 2.x, en çok ${mb(L.svgaBytes ?? L.sourceBytes)} MB: aynı biçime çevrilir, sesi korunur; vektör şekiller ve maskeler çizilmez.</li>
      <li>Çevirme birkaç dakika sürebilir; bu sürede hediye videosuz gönderilir (ikonu uçar), eski video varsa o oynar.</li>
    </ul>
    <div class="row gap wrap">
      <input type="file" accept=".mp4,.webm,.mov,.svga,video/mp4,video/webm,video/quicktime" aria-label="Video ya da SVGA dosyası" onChange=${pickVideo} />
      ${video.mode === 'link' && html`<span class="muted">Bağlantıdan: ${video.name} · ${video.kind === 'stacked' ? 'hazır video' : video.kind === 'svga' ? 'SVGA, çevrilecek' : 'saydam kaynak, çevrilecek'} · ${size(video.bytes)}</span>`}
      ${video.mode === 'file' && html`<span class="muted">${video.file.name} · ${video.kind === 'stacked' ? 'hazır video' : video.kind === 'svga' ? 'SVGA, çevrilecek' : 'saydam kaynak, çevrilecek'} · ${mb(video.file.size)} MB</span>`}
      ${video.mode === 'keep' && html`<span>${videoLine(gift)}</span>`}
      ${video.mode === 'keep' && gift?.job?.status === 'failed' && gift.job.preview && html`<${Button} kind="ghost" onClick=${() => setPreview(gift.job.preview)}>Önizle</${Button}>`}
      ${video.mode === 'none' && html`<span class="muted">Video yok: gönderilince ikonu uçar.</span>`}
      ${video.mode !== 'none' && html`<${Button} kind="ghost" onClick=${() => setVideo({ mode: 'none' })}>Videoyu kaldır</${Button}>`}
      ${video.mode === 'none' && (gift?.video || gift?.job) && html`<${Button} kind="ghost" onClick=${() => setVideo({ mode: 'keep' })}>Vazgeç</${Button}>`}
      ${app && gift.changed?.includes('video') && html`<${Button} kind="ghost" disabled=${!!step} onClick=${videoBack}>${o.video ? 'Uygulamanın videosuna dön' : 'Videoyu orijinaline döndür'}</${Button}>`}
    </div>
    ${linkRow('video', 'https://alanadiniz.com/hediyeler/yuzuk.svga')}
    <p class="muted">
      Bağlantı, dosyayı <b>doğrudan indiren</b> adres olmalı: tarayıcıda açınca dosyanın kendisi görünmeli ya da hemen inmeli (ör. sitenizin
      <code>/hediyeler/</code> klasörüne koyduğunuz dosyanın adresi). Google Drive ya da Dropbox paylaşım sayfası, GoDaddy dosya yöneticisi
      olmaz. Dosyayı uygulamanın sunucusu bir kez indirir, denetler ve kendisi sunar; telefonlar sizin sitenize bağlanmaz. Dosyayı aynı
      adreste değiştirirseniz <b>Bağlantıdan yeniden çek</b> ve <b>Kaydet</b> ile hediye yenilenir.
    </p>
    ${(video.mode === 'file' || video.mode === 'link') && video.kind === 'svga' && html`<label class="field" style="max-width:280px"><span>Ekrandaki boyutu</span><select value=${String(video.fill)} onChange=${(e) => setVideo({ ...video, fill: Number(e.target.value) })}>${L.fills.map((f) => html`<option value=${String(f)}>${FILLS[f] ?? ''} (%${Math.round(f * 100)})</option>`)}</select></label>`}

    <h3>Önizleme</h3>
    <div class="gift-preview">
      <div class="gift-tile">
        ${iconUrl ? html`<img src=${iconUrl} alt="" />` : html`<span class="gift-emoji">${v.emoji.trim() || o?.emoji || '🎁'}</span>`}
        <b>${v.name.trim() || 'Hediye adı'}</b>
        <small>${v.cat === 'privilege' ? `VIP ${v.minSvip}` : `🪙 ${Number.isSafeInteger(price) && price > 0 ? num(price) : '—'}`}</small>
      </div>
      ${iconUrl && html`<img class="gift-big" src=${iconUrl} alt="" />`}
      <div class="muted">${CAT[v.cat]} rafı · ${v.enabled ? 'rafta' : 'kapalı'}</div>
      ${((video.mode === 'file' || video.mode === 'link') && video.kind === 'stacked') || (video.mode === 'keep' && gift?.video)
        ? html`<${Button} onClick=${() => setPreview(video.mode === 'keep' ? gift.video.url : video.url)}>Videoyu oynat</${Button}>`
        : (video.mode === 'file' || video.mode === 'link') && html`<small class="muted">Bu dosya uygulamanın sunucusunda çevrildikten sonra listeden oynatılır.</small>`}
    </div>
    ${preview && html`<${Stage} src=${preview} onEnd=${() => setPreview(null)} />`}

    <div class="row end gap" style="margin-top:12px">
      <${Button} onClick=${onClose} disabled=${!!step}>Vazgeç</${Button}>
      <${Button} kind="primary" disabled=${!!step || !!pulling} onClick=${save}>${step ?? (gift ? 'Kaydet' : 'Hediyeyi ekle')}</${Button}>
    </div>
  </${Modal}>`;
}
