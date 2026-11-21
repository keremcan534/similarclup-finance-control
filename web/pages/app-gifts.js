// Uygulama › Hediyeler: the Similar Club app's gifts, changed without an app update (the app's Yönetim › Hediyeler
// does the same; server/app-admin.ts passes the calls on as the signed-in panel user): the ones the team adds, and the
// app's own (?builtin=1), whose every value (name, price, shelf, VIP, emoji, on/off, order, icon, video) can change
// and go back to the app's ("Orijinale dön"). A list per shelf in the phones' order, an editor, and a preview: the
// shelf tile, the icon, and the transparent video drawn over a stage the way the phones draw it. Files go through this
// server to the app's storage; the app checks them when the gift is saved and converts a WebM / MOV / SVGA itself.
// Nothing removes a background: the editor says so before a file is picked. Global hediye (announced in every room of
// the country) and Profil izi (the gift leaves or cleans a mark on its receiver's photo, Muzip hediyeler) are fields
// of the gift (web/gift-fields.js has their rules); the mark's kind is one of the second tab's, İz türleri
// (app-mark-kinds.js). The gift's form opens a kind's editor over itself ("+ Yeni iz türü", "Resim yükle" for a kind
// without its picture) and selects what was saved; "İz türlerini yönet" shows the tab with the form kept, hidden, as
// typed. An app server from before kinds answers none: the tab says so and the kind is typed, in hours, as before. The
// upload parts are shared with Şanslı hediye ayarı (app-lucky.js).
import { Badge, Button, Loading, Modal, Page, Table, Tabs, act, dateTimeTr, get, html, num, post, searchable, showError, toast, useApi, useApp, useEffect, useRef, useState } from '../lib.js';
import { SORTS, SortBar, sortedIds, useDragOrder } from '../order.js';
import { SHELVES, durationText, extraFields, globalBox, globalNote, globalProblem, kindOptions, markForm, markOf, markPriceProblem, markText, markWarnings, plainOnly, sameMark, unknownKind } from '../gift-fields.js';
import { LIMITS as KIND_LIMITS, artNote, kindsMissing, layerOf, pendingKinds, withKinds } from '../mark-kinds.js';
import { KindEditor, MarkKinds } from './app-mark-kinds.js';
import { BondLooks } from './app-bond-looks.js';

const CATS = SHELVES;
const CAT = Object.fromEntries(CATS);
/**
 * A bond gift (Aile ve Dost): it stays on its shelf; its name, icon, video and price change here. Its price is what a bond
 * request costs (the app's bonds.mjs charges it; older APKs, which show the app's own price, are asked to update while it
 * differs).
 */
const isBondGift = (g) => !!g?.id?.startsWith('bag-');
export const FILLS = { 0.45: 'Küçük', 0.6: 'Orta', 0.8: 'Büyük', 1: 'Tam ekran' };
export const mb = (n) => (n / 1024 / 1024).toLocaleString('tr-TR', { maximumFractionDigits: 1 });
export const sec = (ms) => (ms / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 1 });
/** A file's size as people read it: KB under a megabyte. */
export const size = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${mb(n)} MB`);
const ending = (name) => (/\.([A-Za-z0-9]{1,8})$/.exec(name ?? '')?.[1] ?? '').toLowerCase();
/** What "Değiştirildi" names, as the app answers it (`changed`). */
const FIELD_TR = { name: 'ad', emoji: 'emoji', price: 'fiyat', cat: 'raf / VIP', enabled: 'rafta / kapalı', icon: 'ikon', video: 'video', mark: 'profil izi', global: 'global' };
const changedText = (g) => (g.changed ?? []).map((f) => FIELD_TR[f] ?? f).join(', ');
const KINDS = [
  ['all', 'Hepsi'],
  ['app', 'Uygulamanın'],
  ['mine', 'Eklenenler'],
  ['changed', 'Değiştirilenler'],
];
const kindOk = (k, g) => k === 'all' || (k === 'app' && g.builtin) || (k === 'mine' && !g.builtin) || (k === 'changed' && g.builtin && g.changed?.length > 0);

/** What a picked file is uploaded as (the app's upload kinds), or null when the app won't take it. */
export function typeOf(kind, file) {
  const t = (file.type || '').toLowerCase();
  const e = ending(file.name);
  if (kind === 'gifticon' || kind === 'shopframe' || kind === 'markart') return t === 'image/png' || e === 'png' ? 'image/png' : t === 'image/webp' || e === 'webp' ? 'image/webp' : null;
  if (kind === 'giftvideo') return t === 'video/mp4' || e === 'mp4' ? 'video/mp4' : null;
  if (e === 'svga') return 'application/x-svga';
  if (t === 'video/webm' || e === 'webm') return 'video/webm';
  if (t === 'video/quicktime' || e === 'mov') return 'video/quicktime';
  return null;
}
/** A picked video: a ready stacked MP4, a transparent source the app converts, or an SVGA. */
export const videoKindOf = (file) => (ending(file.name) === 'svga' ? 'svga' : typeOf('giftsource', file) ? 'source' : typeOf('giftvideo', file) ? 'stacked' : null);

/** Uploads a picked file through this server to the app's storage; resolves with the address to save. */
export function upload(kind, file, onProgress) {
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

/** An app's gift put on the shelves (paused in the app) or taken off them, said plainly apart from the other changes. */
const shelfNote = (g) => (g.builtin && g.changed?.includes('enabled') ? (g.enabled ? "Rafa kondu (uygulamada kapalıydı) · yeni APK'da görünür" : 'Raftan kaldırıldı') : null);
const otherChanges = (g) => (g.changed ?? []).filter((f) => !(g.builtin && f === 'enabled'));

/** A link plainly to a video or to a picture, by its file name (the app's server checks the file itself anyway). */
export const VIDEO_LINK = /\.(mp4|m4v|webm|mov|svga)(?:[?#]|$)/i;
export const IMAGE_LINK = /\.(png|webp|jpe?g|gif)(?:[?#]|$)/i;

/** A gift's (or a Şanslı package's) video in a few words: converting, refused with the reason, ready, none. */
export function videoLine(g) {
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

export function AppGifts({ query }) {
  const { can, meta } = useApp();
  // Hediyeler, İz türleri (#/app-gifts?tab=kinds) or Bağ işaretleri (#/app-gifts?tab=bonds).
  const [tab, setTab] = useState(['kinds', 'bonds'].includes(query?.get?.('tab')) ? query.get('tab') : 'gifts');
  const [addKind, setAddKind] = useState(false);
  const [shelf, setShelf] = useState('all');
  const [kind, setKind] = useState('all');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);
  const [playing, setPlaying] = useState(null);
  // builtin=1: the app's own gifts too, with their values in the app and what was changed.
  const list = useApi(meta.app_link ? '/api/app/gifts?builtin=1' : null);
  // İz türleri: the kinds a gift's mark names. 'list' (the kinds read), 'missing' (an app server before them) or
  // 'unknown' (not read yet, or failed): the form then has the kind typed.
  const kinds = useApi(meta.app_link ? '/api/app/mark-kinds' : null);
  // Bağ işaretleri (the app's bond-looks.mjs): read when its tab opens.
  const bondLooks = useApi(meta.app_link && tab === 'bonds' ? '/api/app/bond-looks' : null);
  const kindsMode = kinds.data?.kinds ? 'list' : kinds.error && kindsMissing(kinds.error) ? 'missing' : 'unknown';
  const processing = !!list.data?.gifts.some((g) => g.job?.status === 'processing');
  // An app server with Profil izi answers each gift's `mark` (null: none); one before it answers none.
  const marksOn = !!list.data?.gifts.some((g) => g.mark !== undefined);
  // A video converts on the app's server: the list is read again every few seconds until it is done.
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(list.reload, 4000);
    return () => clearInterval(t);
  }, [processing]);
  // The order is a shelf's: the arrows, dragging a row onto another of its shelf, or a quick sort of the shelf (of every
  // shelf, each in itself, under Tümü).
  const order = async (shelves) => (await act(async () => { for (const ids of shelves) await post('/api/app/gifts/order', { ids }); return true; }, 'Sıra kaydedildi')) && list.reload();
  const shelfIds = (gifts, cat) => gifts.filter((x) => x.cat === cat).map((x) => x.id);
  const drag = useDragOrder((cat, ids) => order([ids]));

  if (!meta.app_link)
    return html`<${Page} title="Uygulama hediyeleri"><div class="empty bad">Uygulama bağlantısı ayarlı değil: sunucuda FC_APP_API_URL ve FC_APP_API_KEY gerekli.</div></${Page}>`;

  const move = (gifts, g, by) => {
    const ids = shelfIds(gifts, g.cat);
    const i = ids.indexOf(g.id);
    const j = i + by;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    order([ids]);
  };
  const sortShelves = (gifts, sort) =>
    order((shelf === 'all' ? CATS.map(([c]) => c) : [shelf]).map((c) => sortedIds(gifts.filter((x) => x.cat === c), sort)).filter((ids) => ids.length > 1));
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
    subtitle="Değişiklikler uygulama güncellemesi olmadan telefonlara gider; uygulamanın kendi hediyeleri Orijinale dön ile geri alınır. Fiyatı değişen uygulama hediyesini eski APK'lar göstermez."
    actions=${can('app.gifts') &&
    tab !== 'bonds' &&
    (tab === 'kinds'
      ? kinds.data && html`<${Button} kind="primary" onClick=${() => setAddKind(true)}>Yeni tür</${Button}>`
      : html`<${Button} kind="primary" disabled=${!list.data?.storage} onClick=${() => setEdit({})}>Yeni hediye</${Button}>`)}
  >
    <${Tabs} tabs=${[['gifts', 'Hediyeler'], ['kinds', `İz türleri${kinds.data?.kinds ? ` (${kinds.data.kinds.length})` : ''}`], ['bonds', 'Bağ işaretleri']]} value=${tab} onChange=${setTab} />
    ${tab === 'kinds' && edit && html`<p class="note warn" style="margin-top:10px">${edit.gift ? `“${edit.gift.name}” hediyesinin formu` : 'Yeni hediye formu'} açık bekliyor: yazdıklarınız duruyor, henüz kaydedilmedi. <button type="button" class="btn link" onClick=${() => setTab('gifts')}>Hediye formuna dön</button></p>`}
    ${tab === 'bonds' && html`<div style="margin-top:10px"><${BondLooks} state=${bondLooks} /></div>`}
    ${tab === 'kinds' && html`<div style="margin-top:10px"><${MarkKinds} state=${kinds} gifts=${list.data?.gifts} storage=${list.data?.storage !== false} adding=${addKind} onAdded=${() => setAddKind(false)} /></div>`}
    ${tab === 'gifts' && marksOn && kindsMode !== 'missing' && html`<p class="note" style="margin:10px 0 0">İz bırakan / temizleyen hediyelerin iz resimleri ve süreleri İz türleri sekmesinde. <button type="button" class="btn link" onClick=${() => setTab('kinds')}>İz türleri sekmesini aç</button></p>`}
    ${tab === 'gifts' && html`<div class="row gap wrap" style="margin:10px 0 6px">
      ${[['all', 'Tümü'], ...CATS].map(([k, l]) => html`<button class=${`chip ${shelf === k ? 'on' : ''}`} onClick=${() => setShelf(k)}>${l}</button>`)}
    </div>
    <div class="row gap wrap" style="margin-bottom:10px">
      ${KINDS.map(([k, l]) => html`<button class=${`chip ${kind === k ? 'on' : ''}`} onClick=${() => setKind(k)}>${l}</button>`)}
      <input type="search" class="list-search" placeholder="Hediye ara: ad, emoji ya da kimlik" aria-label="Hediye ara" value=${q} onInput=${(e) => setQ(e.target.value)} />
    </div>
    <${Loading} state=${list}>${(d) => html`
      ${!d.storage && html`<div class="empty bad">Uygulamanın dosya deposu açık değil: ikon ve video yüklenemez, yeni hediye eklenemez.</div>`}
      ${can('app.gifts') && html`<${SortBar} sorts=${[SORTS.cheap, SORTS.dear, SORTS.sent, SORTS.name]} what=${shelf === 'all' ? 'Her raf kendi içinde' : `${CAT[shelf]} rafı`} onSort=${(s) => sortShelves(d.gifts, s)} />`}
      <${Table}
        rowProps=${can('app.gifts') ? (g) => drag(g.cat, shelfIds(d.gifts, g.cat), g.id) : undefined}
        empty="Bu süzgeçte hediye yok."
        columns=${[
          { key: 'icon', label: '', render: (g) => (g.icon ? html`<img class="gift-icon" src=${g.icon} alt="" loading="lazy" />` : html`<span class="gift-emoji">${g.emoji}</span>`) },
          {
            key: 'name',
            label: 'Ad',
            render: (g) => html`<div class="cell-wrap" style="min-width:170px;max-width:290px"><strong>${g.name}</strong> ${g.builtin ? html`<${Badge} s="info" label="Uygulamanın" />` : ''}
              ${shelfNote(g) ? html` <${Badge} s=${g.enabled ? 'active' : 'passive'} label=${shelfNote(g)} />` : ''}
              ${otherChanges(g).length > 0 ? html` <${Badge} s="warning" label=${`Değiştirildi: ${otherChanges(g).map((f) => FIELD_TR[f] ?? f).join(', ')}`} />` : ''}
              ${g.global ? html` <${Badge} s=${globalNote(g, d.globalMinPrice) ? 'warning' : 'info'} label="Global" />` : ''}
              ${globalNote(g, d.globalMinPrice) ? html` <small class="muted">${globalNote(g, d.globalMinPrice)}</small>` : ''}
              <br /><small class="muted">${g.id}${g.iconLink || g.videoLink ? ' · 🔗 bağlantıdan' : ''}${g.builtin && g.changed?.includes('name') ? ` · uygulamada: ${g.original.name}` : ''}${markText(g.mark, kinds.data?.kinds) ? ` · ${markText(g.mark, kinds.data?.kinds)}` : ''}</small></div>`,
          },
          {
            key: 'cat',
            label: 'Raf ve sıra',
            render: (g) => {
              const row = d.gifts.filter((x) => x.cat === g.cat);
              const i = row.findIndex((x) => x.id === g.id);
              return html`<span class="row gap">${CAT[g.cat]}${g.cat === 'privilege' ? ` · VIP ${g.minSvip}+` : ''} · ${i + 1}.
                ${can('app.gifts') && html`<button class="btn ghost tiny" aria-label="Bir üste" disabled=${i === 0} onClick=${() => move(d.gifts, g, -1)}>↑</button><button class="btn ghost tiny" aria-label="Bir alta" disabled=${i === row.length - 1} onClick=${() => move(d.gifts, g, 1)}>↓</button>`}</span>`;
            },
          },
          {
            key: 'price',
            label: 'Fiyat (jeton)',
            align: 'right',
            render: (g) => html`${num(g.price)}${g.builtin && g.price !== g.original.price ? html`<br /><small class="muted">uygulamada <s>${num(g.original.price)}</s></small>` : ''}${g.sent.count ? html`<br /><small class="muted" title=${`${num(g.sent.coins)} jeton${g.sent.days ? `, son ${g.sent.days} gün` : ''}`}>${num(g.sent.count)} gönderim</small>` : ''}`,
          },
          {
            key: 'enabled',
            label: 'Durum',
            render: (g) =>
              html`<${Badge} s=${g.enabled ? 'active' : 'passive'} label=${g.enabled ? 'Rafta' : 'Kapalı'} />${g.builtin && !g.enabled && !g.original.enabled && !g.changed?.includes('enabled') ? html`<br /><small class="muted">uygulamada duraklatılmış</small>` : ''}`,
          },
          { key: 'video', label: 'Video', render: (g) => html`<div class="cell-wrap" style="max-width:230px">${videoLine(g)}</div>` },
          {
            key: 'a',
            label: '',
            render: (g) => html`<span class="row gap wrap actions">
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
        rows=${d.gifts.filter((g) => (shelf === 'all' || g.cat === shelf) && kindOk(kind, g) && (!q.trim() || [g.name, g.id, g.emoji, g.original?.name].some((t) => t && searchable(t).includes(searchable(q.trim())))))}
      />`}</${Loading}>`}
    ${edit && list.data && html`<${Editor} gift=${edit.gift} admin=${list.data} kinds=${kinds.data} kindsMode=${kindsMode} hidden=${tab !== 'gifts'} onClose=${() => setEdit(null)} onSaved=${(text) => (setEdit(null), toast(text), list.reload(), kinds.reload())} onManageKinds=${() => setTab('kinds')} onKindsChanged=${kinds.reload} />`}
    ${playing && html`<${Modal} title="Önizleme" onClose=${() => setPlaying(null)}>
      ${playing.refused && html`<p class="note bad">Kullanılmayan video: odada böyle, arka planıyla kutu gibi görünürdü. Hediyedeki video değişmedi.</p>`}
      <${Stage} src=${playing.src} onEnd=${() => setPlaying(null)} />
    </${Modal}>`}
  </${Page}>`;
}

/**
 * A stacked video (colour on top, alpha below) drawn transparent over a stage, as the phones draw it. `loop` plays it
 * again and again, `muted` starts it without sound, and `onVideo` hands the caller the video to play, pause, seek and
 * time (null when it goes).
 */
export function Stage({ src, onEnd, loop = false, muted = false, onVideo }) {
  const canvas = useRef(null);
  const video = useRef(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const v = document.createElement('video');
    v.src = src;
    v.playsInline = true;
    v.loop = loop;
    v.muted = muted;
    video.current = v;
    onVideo?.(v);
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
      onVideo?.(null);
      video.current = null;
      cancelAnimationFrame(raf);
      v.pause();
      v.removeAttribute('src');
      v.load();
    };
  }, [src]);
  useEffect(() => {
    if (video.current) video.current.loop = loop;
  }, [loop]);
  useEffect(() => {
    if (video.current) video.current.muted = muted;
  }, [muted]);
  return html`<div class="alpha-stage"><canvas ref=${canvas} class="alpha-video"></canvas>${blocked && !muted && html`<small class="muted">Tarayıcı sesi kapattı</small>`}</div>`;
}

/** The file name at the end of a link, for the line under the field. */
export const linkName = (link) => {
  try {
    return decodeURIComponent(new URL(link).pathname.split('/').filter(Boolean).pop() ?? '') || link;
  } catch {
    return link;
  }
};

/** A picked or fetched video in words. */
export const KIND_TEXT = { stacked: 'hazır video', svga: 'SVGA, çevrilecek', source: 'saydam kaynak, çevrilecek' };

/**
 * What a video file may be (`L`: the app's limits for it), said before one is picked. `what`: whose video it is, as
 * the sentences name it (a gift's, a Şanslı package's). An older app server gives no output size: the converter's.
 */
export function VideoRules({ L, what = 'hediye' }) {
  const [w, h, fps] = [L.width ?? 540, L.height ?? 960, L.fps ?? 20];
  return html`<p class="note bad">Arka plan silme yapılmaz: ${what} videosu odanın üstünde oynar, saydam (arka planı silinmiş) olmalı. Video arka planıyla bir sahneyse (ör. gece yolunda araba) aşağıda <b>Arka planlı tam ekran</b>'ı seçin; o zaman bütün ekranı kaplar.</p>
    <ul class="muted">
      <li>Hazır yığılmış MP4: üst yarı renk, alt yarı alfa (ör. 540 × 1920), ${sec(L.videoMinMs)}–${sec(L.videoMaxMs)} sn, en çok ${mb(L.videoBytes)} MB. Olduğu gibi kullanılır.</li>
      <li>Saydam WebM (VP8/VP9 alfa) ya da ProRes 4444 .mov, en çok ${mb(L.sourceBytes)} MB: ${w} × ${h}, ${fps} fps, sesli videoya çevrilir. <b>Dosya küçük olsun:</b> videoyu bu boyutta (${w} × ${h}, ${fps} fps) dışa aktarın; uygulamada görüntü aynı kalır, dosya kabaca dörtte birine iner.</li>
      <li>SVGA 2.x, en çok ${mb(L.svgaBytes ?? L.sourceBytes)} MB: aynı biçime çevrilir, sesi korunur; vektör şekiller ve maskeler çizilmez.</li>
      <li>Çevirme birkaç dakika sürebilir; bu sürede ${what} videosuz gönderilir (ikonu uçar), eski video varsa o oynar.</li>
    </ul>`;
}

/** A new video's choices: an SVGA's size on the screen, and playing full screen with its background. */
export function VideoChoices({ video, fills, onChange }) {
  if (video.mode !== 'file' && video.mode !== 'link') return null;
  return html`<div class="video-choices">
    ${video.kind === 'svga' && !video.opaque && html`<label class="field" style="max-width:280px"><span>Ekrandaki boyutu</span><select value=${String(video.fill)} onChange=${(e) => onChange({ ...video, fill: Number(e.target.value) })}>${fills.map((f) => html`<option value=${String(f)}>${FILLS[f] ?? ''} (%${Math.round(f * 100)})</option>`)}</select></label>`}
    <label class="field inline"><span><b>Arka planlı tam ekran</b>: video bir sahne, arka planıyla bütün ekranı kaplasın (saydamlık aranmaz; oda video bitene kadar görünmez).</span><input type="checkbox" checked=${!!video.opaque} onChange=${(e) => onChange({ ...video, opaque: e.target.checked })} /></label>
  </div>`;
}

/** What a pasted link must be, under the link fields. */
export const LinkHelp = () => html`<p class="muted">
  Bağlantı, dosyayı <b>doğrudan indiren</b> adres olmalı: tarayıcıda açınca dosyanın kendisi görünmeli ya da hemen inmeli (ör. sitenizin
  <code>/hediyeler/</code> klasörüne koyduğunuz dosyanın adresi). Google Drive ya da Dropbox paylaşım sayfası, GoDaddy dosya yöneticisi
  olmaz. Dosyayı uygulamanın sunucusu bir kez indirir, denetler ve kendisi sunar; telefonlar sizin sitenize bağlanmaz. Dosyayı aynı
  adreste değiştirirseniz <b>Bağlantıdan yeniden çek</b> ve <b>Kaydet</b> ile yenilenir.
</p>`;

/** What the app's server is sent for a new video: its size (an SVGA) and whether it plays full screen with its background. */
export const specOf = (x, url) => ({
  url,
  kind: x.kind === 'stacked' ? 'stacked' : 'source',
  ...(x.kind === 'svga' ? { fill: x.opaque ? 1 : x.fill } : {}),
  ...(x.opaque ? { opaque: true } : {}),
});

/** A new gift's id in the price rule's check (it has none until saved). */
const NEW = '\u0000yeni';

/**
 * A gift's editor. `kinds`: İz türleri (GET /api/app/mark-kinds), `kindsMode` 'list' (the mark's kind picked from them,
 * its time in hours or minutes; a kind's editor opens over the form), else typed as before ('missing': an app server
 * before kinds, hours only). `hidden`: kept as typed while the page shows İz türleri (`onManageKinds` goes there);
 * `onKindsChanged`: a kind was saved from here (the page reads the kinds again).
 */
function Editor({ gift, admin, kinds: kindsAnswer, kindsMode = 'unknown', hidden = false, onClose, onSaved, onManageKinds, onKindsChanged }) {
  const L = admin.limits;
  // Kinds saved from this form, in the select (and passing the form's check) until the list read again has them.
  const [savedKinds, setSavedKinds] = useState([]);
  useEffect(() => setSavedKinds((s) => (s.length ? pendingKinds(kindsAnswer?.kinds, s) : s)), [kindsAnswer]);
  const kinds = kindsMode === 'list' ? withKinds(kindsAnswer.kinds, savedKinds) : null;
  // A kind's editor over this form: { kind } (none: a new kind), `art`: opened by "Resim yükle".
  const [kindEdit, setKindEdit] = useState(null);
  const legacy = kindsMode !== 'list';
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
    global: gift?.global === true,
  });
  // Profil izi: { role: 'none'|'leave'|'clean', kind, amount, unit } (amount '': the kind's, else the Canlı ayar's).
  const [mark, setMark] = useState(() => markForm(gift?.mark));
  // An app server without these features answers neither (no globalMinPrice, no gift's `mark`): their fields stay off.
  const globalOn = typeof admin.globalMinPrice === 'number';
  const marksOn = admin.gifts.some((g) => g.mark !== undefined);
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
  // A playing preview stops while the form is hidden.
  useEffect(() => void (hidden && setPreview(null)), [hidden]);
  /** A kind saved over this form: the select names it (a new one, or the one whose picture was uploaded). */
  const kindSaved = (text, saved) => {
    setKindEdit(null);
    toast(text);
    if (saved?.kind) {
      setSavedKinds((s) => [...s.filter((k) => k.kind !== saved.kind), saved]);
      setMark((m) => ({ ...m, kind: saved.kind }));
    }
    onKindsChanged?.();
  };
  /** The app's value of a field, under it, when the gift's differs. */
  const was = (show, text) => app && show && html`<small class="muted">Uygulamada: ${text}</small>`;

  /**
   * The largest file the app's server takes now for `pick` (limits → bytes). A page left open across an update of the
   * app's server keeps the limits it was opened with, so a file over them is checked against fresh ones first.
   */
  const fits = async (file, pick) => {
    if (file.size <= pick(L)) return { ok: true, max: pick(L) };
    const now = (await get('/api/app/gifts').catch(() => null))?.limits;
    const max = now ? pick(now) : pick(L);
    return { ok: file.size <= max, max };
  };
  const pickIcon = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!typeOf('gifticon', file)) return showError(new Error('İkon PNG ya da WebP olmalı'));
    const room = await fits(file, (x) => x.iconBytes);
    if (!room.ok) return showError(new Error(`İkon en fazla ${mb(room.max)} MB olabilir (bu ${mb(file.size)} MB)`));
    setIcon({ file, url: URL.createObjectURL(file) });
  };
  const pickVideo = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const kind = videoKindOf(file);
    if (!kind) return showError(new Error('Hazır yığılmış MP4, saydam WebM / MOV ya da SVGA seçin'));
    if (kind === 'svga' && !admin.svga) return showError(new Error('Uygulamanın sunucusu şu an SVGA çeviremiyor'));
    if (kind === 'source' && !admin.convert) return showError(new Error('Uygulamanın sunucusu şu an video çeviremiyor'));
    // An SVGA has its own, smaller limit (the app's server reads it whole); older servers give none.
    const room = await fits(file, (x) => (kind === 'stacked' ? x.videoBytes : kind === 'svga' ? (x.svgaBytes ?? x.sourceBytes) : x.sourceBytes));
    if (!room.ok) return showError(new Error(`Dosya en fazla ${mb(room.max)} MB olabilir (bu ${mb(file.size)} MB)`));
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
    // Profil izi and Global hediye, checked here as the app's server checks them (its sentence still wins).
    const rule = marksOn && !plainOnly(gift?.id) ? markOf(mark, { legacy }) : { mark: gift?.mark ?? null };
    if (rule.error) return showError(new Error(rule.error));
    const global = globalOn && !plainOnly(gift?.id) ? !!v.global : gift?.global === true;
    const why = globalOn ? globalProblem({ id: gift?.id, price, global, was: gift?.global === true, priceChanged: !gift || price !== gift.price, mark: rule.mark, min: admin.globalMinPrice }) : null;
    if (why) return showError(new Error(why));
    const extra = extraFields(gift, { global, mark: rule.mark });
    if (!globalOn) delete extra.global;
    if (!marksOn) delete extra.mark;
    // A rule that changes names a kind İz türleri has; a cleaning gift dearer than every gift leaving its kind (the
    // app's sentences). Checked on every save, as there: a price change can break the rule too.
    const unknown = extra.mark ? unknownKind(extra.mark, kinds) : null;
    if (unknown) return showError(new Error(unknown));
    if (marksOn) {
      const id = gift?.id ?? NEW;
      const after = [...admin.gifts.filter((g) => g.id !== id), { id, name, price, mark: rule.mark }];
      const dear = markPriceProblem(after, id);
      if (dear) return showError(new Error(dear));
    }
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
        videoSpec = specOf(video, url);
      }
      if (video.mode === 'link') videoSpec = specOf(video, video.at);
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
        Object.assign(patch, extra);
        if (!Object.keys(patch).length) return onClose();
        await post('/api/app/gifts/update', { id: gift.id, ...patch });
      } else {
        await post('/api/app/gifts', { ...fields, ...extra, icon: iconAt, video: videoSpec ?? null, iconLink: iconLink ?? null, videoLink: videoLink ?? null });
      }
      onSaved(videoSpec?.kind === 'source' ? 'Kaydedildi; video uygulamanın sunucusunda çevriliyor' : gift ? 'Kaydedildi' : 'Hediye eklendi');
    } catch (e) {
      showError(e);
    } finally {
      setStep(null);
    }
  };

  const price = Number(v.price);
  const box = globalOn ? globalBox({ id: gift?.id, price, global: v.global, mark: mark.role === 'none' ? null : mark, min: admin.globalMinPrice }) : { hidden: true };
  const ruleNow = markOf(mark, { legacy });
  const kindNow = kinds?.find((k) => k.kind === mark.kind);
  const warnings = ruleNow.mark ? markWarnings(ruleNow.mark, { kinds, gifts: admin.gifts, self: gift?.id }) : [];
  const timeHint =
    kindsMode === 'missing'
      ? "1–168 saat; boş: Canlı ayarlar › Profil izleri'ndeki süre."
      : `1–168 saat ya da 5–10.080 dakika; boş: ${kindNow?.minutes ? `türün süresi (${durationText(kindNow.minutes)})` : `Canlı ayardaki süre${kindsAnswer?.hours > 0 ? ` (${durationText(kindsAnswer.hours * 60)})` : ''}`}.`;
  const kindIntro = kindEdit?.art
    ? `Hediye formu açık kalır, yazdıklarınız durur. Resim türündür: bu türü kullanan bütün hediyelerde görünür. Kaydedince forma dönersiniz; hediyeyi orada Kaydet ile kaydedin.`
    : `Hediye formu açık kalır, yazdıklarınız durur. Türü ekleyince bu hediyenin iz türü olarak seçilir; hediyeyi sonra formda ${gift ? 'Kaydet' : 'Hediyeyi ekle'} ile kaydedin.`;
  return html`<${Modal} title=${gift ? `${gift.name}${app ? ' (uygulamanın hediyesi)' : ''}` : 'Yeni hediye'} wide hidden=${hidden} onClose=${onClose}>
    ${gift?.updatedAt && html`<p class="muted" style="margin-top:-6px">Son değişiklik: ${dateTimeTr(gift.updatedAt)}${gift.updatedBy?.name ? ` · ${gift.updatedBy.name}` : ''}</p>`}
    ${app && html`<p class="note">Uygulamayla gelen bir hediye. Değiştirdiğiniz her şey uygulama güncellemesi olmadan telefonlara gider; listedeki <b>Orijinale dön</b> hepsini geri alır. Fiyatı değişirse eski APK'lar bu hediyeyi göstermez (yanlış fiyat göstermesinler diye).</p>`}
    <div class="form"><div class="grid2">
      <label class="field"><span>Ad *</span><input value=${v.name} maxlength=${L.nameMax} onInput=${set('name')} placeholder="Ör. Altın Yıldız" />${was(v.name.trim() !== o?.name, o?.name)}</label>
      <label class="field"><span>Fiyat (jeton) *</span><input inputmode="numeric" value=${v.price} onInput=${(e) => setV({ ...v, price: e.target.value.replace(/[^\d]/g, '') })} placeholder="Ör. 9999" /><small class="muted">${isBondGift(gift) ? 'Bağ isteğinin fiyatı. Değişiklik yeni isteklerden itibaren geçer; bekleyen istekler kendi fiyatını tutar. Fiyat uygulamanınkinden farklıyken eski APK\'lar bağ isteği gönderemez, güncelleme ister.' : `1–${num(L.priceMax)} jeton; değişiklik yeni gönderimlerden itibaren geçer.`}</small>${was(price !== o?.price, `${num(o?.price)} jeton`)}</label>
      <label class="field"><span>Raf</span><select value=${v.cat} disabled=${isBondGift(gift)} onChange=${set('cat')}>${CATS.map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>${was(v.cat !== o?.cat, `${CAT[o?.cat]}${o?.cat === 'privilege' ? ` · VIP ${o.minSvip}+` : ''}`)}</label>
      ${v.cat === 'privilege' && html`<label class="field"><span>En düşük VIP seviyesi</span><select value=${v.minSvip} onChange=${set('minSvip')}>${Array.from({ length: L.svipMax }, (_, i) => html`<option value=${String(i + 1)}>VIP ${i + 1}</option>`)}</select></label>`}
      <label class="field"><span>Emoji ${app ? '' : '(isteğe bağlı)'}</span><input value=${v.emoji} maxlength="8" onInput=${set('emoji')} placeholder=${app ? o.emoji : '🎁'} /><small class="muted">Sohbet satırlarında ve ikon yüklenmeden önce görünür.</small>${was(v.emoji.trim() && v.emoji.trim() !== o?.emoji, o?.emoji)}</label>
      <label class="field inline"><span>Rafta (herkes görür)</span><input type="checkbox" checked=${v.enabled} onChange=${set('enabled')} />${was(!!v.enabled !== o?.enabled, o?.enabled ? 'rafta' : 'duraklatılmış')}</label>
      ${!box.hidden && html`<label class="field inline wide"><span><b>Global hediye</b> (ülkedeki bütün odalarda duyurulur: gönderenin ve alıcının adıyla)<br /><small class="muted">${box.hint}</small></span><input type="checkbox" checked=${v.global} disabled=${box.disabled} onChange=${set('global')} />${was(!!v.global !== !!o?.global, o?.global ? 'global' : 'global değil')}</label>`}
    </div></div>

    ${marksOn && !plainOnly(gift?.id) && html`<h3>Profil izi</h3>
    <p class="muted">İz bırakan hediye (ör. 💩 Kaka Şakası, 🩴 Terlik Geldi!) alıcının profil fotoğrafına türünün izini bırakır; aynı türü temizleyen hediye (ör. 💧 Temizlik Suyu, Cam Tamiri) onu kaldırır. Temizleyen hediye o türü bırakan her hediyeden pahalı olmalı. Profilde aynı anda tek iz olur: iz varken başka türden bir iz hediyesi düz hediye olarak gider (iz değişmez); aynı tür yeniden gelirse iz en son göndereninki olur, süresi kısalmaz. Kimlerin iz bırakabileceğini alıcı Gizlilik'ten seçer (varsayılan: takip ettikleri); görünen izi kendisi kaldıramaz. Profil izi olan hediye global olamaz. Profil izinden önceki APK'lar iz kurallı hediyeyi rafta göstermez.</p>
    <div class="form"><div class="grid2">
      <label class="field"><span>Profil izi</span><select value=${mark.role} disabled=${v.global && mark.role === 'none'} onChange=${(e) => setMark({ ...mark, role: e.target.value })}>
        <option value="none">Yok</option><option value="leave">Bırakır</option><option value="clean">Temizler</option>
      </select>${v.global && mark.role === 'none' ? html`<small class="muted">Global hediye iz bırakamaz: önce Global'i kaldırın.</small>` : ''}${was(!sameMark(ruleNow.mark, o?.mark) && !ruleNow.error, markText(o?.mark, kinds) ?? 'iz yok')}</label>
      ${mark.role !== 'none' &&
      (kinds
        ? html`<div class="field"><span>İz türü *</span><div class="row gap">
            <select style="flex:1" aria-label="İz türü" value=${mark.kind} onChange=${(e) => setMark({ ...mark, kind: e.target.value })}>
              <option value="">— Tür seçin —</option>${kindOptions(kinds, mark.kind).map((x) => html`<option value=${x.value}>${x.label}</option>`)}
            </select>
            <${Button} onClick=${() => setKindEdit({})}>+ Yeni iz türü</${Button}>
          </div><small class="muted">${mark.role === 'clean' ? 'Temizlediği tür (bir hediye bir tür temizler).' : 'Bıraktığı iz.'} Bırakan ve temizleyen hediye aynı türü seçer. Profilde kalacak şeffaf iz resmi, iz türüne yüklenir: <b>+ Yeni iz türü</b> ya da İz türleri sekmesi. <button type="button" class="btn link" onClick=${onManageKinds}>İz türlerini yönet</button></small></div>`
        : html`<label class="field"><span>İz türü *</span><input value=${mark.kind} maxlength="24" placeholder="ör. kaka" onInput=${(e) => setMark({ ...mark, kind: e.target.value })} /><small class="muted">${kindsMode === 'missing' ? 'Küçük harfle kısa bir kelime; bırakan ve temizleyen hediye aynı türü yazar.' : 'İz türleri listesi alınamadı: türün anahtarını yazın (ör. kaka, kirik-cam).'}</small></label>`)}
      ${mark.role === 'leave' && html`<label class="field"><span>Süre (isteğe bağlı)</span><div class="row gap">
        <input inputmode="numeric" style="flex:1" value=${mark.amount} placeholder=${kindNow?.minutes ? 'Türün süresi' : 'Canlı ayardaki süre'} aria-label="İzin süresi" onInput=${(e) => setMark({ ...mark, amount: e.target.value.replace(/[^\d]/g, '') })} />
        ${kindsMode === 'missing' ? html`<span class="muted">saat</span>` : html`<select value=${mark.unit} aria-label="Süre birimi" onChange=${(e) => setMark({ ...mark, unit: e.target.value })}><option value="hours">saat</option><option value="minutes">dakika</option></select>`}
      </div><small class="muted">${timeHint}</small></label>`}
    </div></div>
    ${mark.role !== 'none' && kindNow && artNote(kindNow) && html`<p class=${`note ${layerOf({ kind: kindNow.kind }).compiled ? '' : 'warn'}`} style="margin:8px 0 0">${artNote(kindNow)} <button type="button" class="btn link" onClick=${() => setKindEdit({ kind: kindNow, art: true })}>Resim yükle</button></p>`}
    ${ruleNow.mark && html`<p class="muted" style="margin-top:6px">Kaydedince: ${markText(ruleNow.mark, kinds)}</p>`}
    ${warnings.map((w) => html`<p class="note warn">${w}</p>`)}`}

    <h3>İkon</h3>
    <p class="muted">Saydam (arka planı silinmiş) PNG ya da WebP, kare, ${L.iconMinPx}–${L.iconMaxPx} piksel (önerilen 512 × 512), en çok ${mb(L.iconBytes)} MB.${L.iconServePx ? ` Daha büyüğü telefonlar için kendiliğinden ${L.iconServePx} piksele ve ${mb(L.iconServeBytes)} MB'a küçültülür.` : ''}${app ? ' Seçmezseniz uygulamanın resmi kalır.' : ''}</p>
    <div class="row gap wrap">
      <input type="file" accept="image/png,image/webp" aria-label="İkon dosyası" onChange=${pickIcon} />
      ${app && (gift.changed?.includes('icon') || (icon && !icon.reset)) && !icon?.reset && html`<${Button} kind="ghost" onClick=${() => setIcon({ reset: true })}>Uygulamanın resmine dön</${Button}>`}
      ${icon?.reset && html`<span class="muted">Kaydedince uygulamanın resmi döner.</span> <${Button} kind="ghost" onClick=${() => setIcon(null)}>Vazgeç</${Button}>`}
    </div>
    ${linkRow('icon', 'https://alanadiniz.com/hediyeler/yuzuk.png')}
    ${icon?.at && html`<small class="muted">Bağlantıdan alındı: ${linkName(icon.link)} · ${size(icon.bytes)}</small>`}

    <h3>Video (isteğe bağlı)</h3>
    <${VideoRules} L=${L} />
    <div class="row gap wrap">
      <input type="file" accept=".mp4,.webm,.mov,.svga,video/mp4,video/webm,video/quicktime" aria-label="Video ya da SVGA dosyası" onChange=${pickVideo} />
      ${video.mode === 'link' && html`<span class="muted">Bağlantıdan: ${video.name} · ${KIND_TEXT[video.kind]} · ${size(video.bytes)}</span>`}
      ${video.mode === 'file' && html`<span class="muted">${video.file.name} · ${KIND_TEXT[video.kind]} · ${mb(video.file.size)} MB</span>`}
      ${video.mode === 'keep' && html`<span>${videoLine(gift)}</span>`}
      ${video.mode === 'keep' && gift?.job?.status === 'failed' && gift.job.preview && html`<${Button} kind="ghost" onClick=${() => setPreview(gift.job.preview)}>Önizle</${Button}>`}
      ${video.mode === 'none' && html`<span class="muted">Video yok: gönderilince ikonu uçar.</span>`}
      ${video.mode !== 'none' && html`<${Button} kind="ghost" onClick=${() => setVideo({ mode: 'none' })}>Videoyu kaldır</${Button}>`}
      ${video.mode === 'none' && (gift?.video || gift?.job) && html`<${Button} kind="ghost" onClick=${() => setVideo({ mode: 'keep' })}>Vazgeç</${Button}>`}
      ${app && gift.changed?.includes('video') && html`<${Button} kind="ghost" disabled=${!!step} onClick=${videoBack}>${o.video ? 'Uygulamanın videosuna dön' : 'Videoyu orijinaline döndür'}</${Button}>`}
    </div>
    <${VideoChoices} video=${video} fills=${L.fills} onChange=${setVideo} />
    ${linkRow('video', 'https://alanadiniz.com/hediyeler/yuzuk.svga')}
    <${LinkHelp} />

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
  </${Modal}>
  ${kindEdit && kinds && html`<${KindEditor}
    kind=${kindEdit.kind}
    all=${kinds}
    limits=${{ ...KIND_LIMITS, ...(kindsAnswer?.limits ?? {}) }}
    hours=${kindsAnswer?.hours ?? 0}
    gifts=${admin.gifts}
    storage=${admin.storage !== false}
    intro=${kindIntro}
    startAt=${kindEdit.art ? 'art' : undefined}
    onClose=${() => setKindEdit(null)}
    onSaved=${kindSaved}
  />`}`;
}
