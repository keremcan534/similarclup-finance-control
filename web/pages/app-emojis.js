// Uygulama › Emojiler: the Similar Club app's emoji panel, its sticker packs and their stickers, changed without an app
// update (the app's server/api/emoji.mjs; server/app-admin.ts passes the calls on as the signed-in panel user). The
// app's own packs and stickers change (a pack's name, price, VIP level, on/off and order; a sticker's name, emoji, pack,
// picture, on/off and order) and go back to the app's values ("Orijinale dön"); the team adds packs and stickers of its
// own, with a transparent PNG/WebP or a Lottie animation as the picture. Each pack is a card with its stickers.
import { Badge, Button, Card, Loading, Modal, Page, act, html, num, post, showError, toast, useApi, useApp, useState } from '../lib.js';

const kb = (n) => `${Math.max(1, Math.round(n / 1024))} KB`;
const ending = (name) => (/\.([A-Za-z0-9]{1,8})$/.exec(name ?? '')?.[1] ?? '').toLowerCase();
const PACK_TR = { name: 'ad', price: 'fiyat', minVip: 'VIP', enabled: 'rafta / kapalı' };
const STICKER_TR = { pack: 'paket', name: 'ad', emoji: 'emoji', enabled: 'rafta / kapalı', art: 'resim' };
const listOf = (fields, tr) => (fields ?? []).map((f) => tr[f] ?? f).join(', ');
/** Stickers shown in a closed pack's card. */
const PEEK = 12;

/** What a picked picture is uploaded as (the app's stickerart kind), or null. */
function artType(file) {
  const t = (file.type || '').toLowerCase();
  const e = ending(file.name);
  if (t === 'image/png' || e === 'png') return 'image/png';
  if (t === 'image/webp' || e === 'webp') return 'image/webp';
  if (t === 'application/json' || e === 'json') return 'application/json';
  return null;
}
/** Uploads a picked picture through this server to the app's storage; resolves with the address to save. */
async function upload(file) {
  const type = artType(file);
  if (!type) throw new Error('Resim PNG, WebP ya da Lottie (JSON) olmalı');
  const res = await fetch('/api/app/upload?kind=stickerart', { method: 'POST', headers: { 'content-type': type }, body: file, credentials: 'same-origin' });
  let d = null;
  try {
    d = await res.json();
  } catch {}
  if (!res.ok || !d?.url) throw new Error(d?.error ?? `Yükleme başarısız (${res.status})`);
  return d.url;
}

/** A sticker as the panel can draw it: its picture, or its emoji (a Lottie animation, an app sticker that moves). */
const Face = ({ s, size = 48 }) =>
  s.picture
    ? html`<img src=${s.picture} width=${size} height=${size} alt="" loading="lazy" style="object-fit:contain" />`
    : html`<span class="sticker-emoji" style=${`font-size:${Math.round(size * 0.7)}px;line-height:${size}px`}>${s.emoji}</span>`;

const packLine = (p) =>
  p.roomOnly ? 'odanın kendi paketi (satılmaz)' : p.price > 0 ? `🪙 ${num(p.price)}${p.minVip ? ` · VIP ${p.minVip}+` : ''}` : p.minVip ? `VIP ${p.minVip} ile açılır` : 'ücretsiz';

export function AppEmojis() {
  const { can, meta } = useApp();
  const list = useApi(meta.app_link ? '/api/app/emoji' : null);
  const [open, setOpen] = useState(() => new Set());
  const [packEdit, setPackEdit] = useState(null);
  const [stickerEdit, setStickerEdit] = useState(null);

  if (!meta.app_link)
    return html`<${Page} title="Uygulama emojileri"><div class="empty bad">Uygulama bağlantısı ayarlı değil: sunucuda FC_APP_API_URL ve FC_APP_API_KEY gerekli.</div></${Page}>`;
  const edit = can('app.emojis');
  const done = (text) => (toast(text), list.reload());

  const movePack = async (packs, p, by) => {
    const ids = packs.map((x) => x.id);
    const i = ids.indexOf(p.id);
    const j = i + by;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    (await act(() => post('/api/app/emoji/packs/order', { ids }), 'Sıra kaydedildi')) && list.reload();
  };
  const moveSticker = async (p, s, by) => {
    const ids = p.stickers.map((x) => x.id);
    const i = ids.indexOf(s.id);
    const j = i + by;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    (await act(() => post('/api/app/emoji/stickers/order', { pack: p.id, ids }), 'Sıra kaydedildi')) && list.reload();
  };
  const togglePack = async (p) => {
    if (!confirm(p.enabled ? `“${p.name}” emoji panelinden ve mağazadan kalksın mı? Alanların gönderdiği çıkartmalar mesajlarda görünmeye devam eder.` : `“${p.name}” yeniden açılsın mı?`)) return;
    (await act(() => post('/api/app/emoji/packs/update', { id: p.id, enabled: !p.enabled }), p.enabled ? 'Paket kapatıldı' : 'Paket açıldı')) && list.reload();
  };
  const resetPack = async (p) => {
    if (!confirm(`“${p.name}” uygulamadaki haline dönsün mü? Geri alınacak: ${listOf(p.changed, PACK_TR)}. Sırası değişmez.`)) return;
    (await act(() => post('/api/app/emoji/packs/reset', { id: p.id }), 'Paket orijinaline döndü')) && list.reload();
  };
  const deletePack = async (p) => {
    if (!confirm(`“${p.name}” ve içindeki çıkartmalar silinsin mi? Resimleri depodan silinir; gönderilmiş çıkartmalar mesajlarda emojisiyle görünür. Geri alınamaz.`)) return;
    (await act(() => post('/api/app/emoji/packs/delete', { id: p.id }), 'Paket silindi')) && list.reload();
  };
  const fold = (id) => setOpen((x) => (x.has(id) ? new Set([...x].filter((y) => y !== id)) : new Set([...x, id])));

  return html`<${Page}
    title="Uygulama emojileri"
    subtitle="Emoji panelinin çıkartma paketleri. Uygulamanın kendi paketlerinin adı, fiyatı, VIP'i, sırası ve çıkartmalarının adı, emojisi, resmi ve paketi buradan değişir, istenince orijinaline döner; yeni paket ve çıkartma da eklenir. Değişiklik uygulama güncellemesi olmadan bu sürümden sonraki APK'lara gider. Her işlem hem burada hem uygulamada denetim kaydına adınızla yazılır."
    actions=${edit && html`<${Button} kind="primary" onClick=${() => setPackEdit({})}>Yeni paket</${Button}>`}
  >
    <${Loading} state=${list}>${(d) => html`
      ${!d.storage && html`<div class="empty bad">Uygulamanın dosya deposu açık değil: çıkartma resmi yüklenemez, yeni çıkartma eklenemez.</div>`}
      ${d.packs.map((p, i) => {
        const shown = open.has(p.id) ? p.stickers : p.stickers.slice(0, PEEK);
        return html`<${Card}
          key=${p.id}
          title=${html`<span>${p.name}</span> ${p.builtin ? html`<${Badge} s="info" label="Uygulamanın" />` : html`<${Badge} s="active" label="Eklenen" />`}
            ${!p.enabled && html` <${Badge} s="passive" label="Kapalı" />`}
            ${p.changed?.length > 0 && html` <${Badge} s="warning" label=${`Değiştirildi: ${listOf(p.changed, PACK_TR)}`} />`}
            ${p.emojiTab && html` <${Badge} label="Emoji sekmesinde" />`}`}
          actions=${html`
            <small class="muted">${packLine(p)} · ${p.stickers.length} çıkartma${p.owners ? ` · ${num(p.owners)} kişi aldı` : ''}</small>
            ${edit && html`
              <button class="btn ghost" aria-label="Bir üste" disabled=${i === 0} onClick=${() => movePack(d.packs, p, -1)}>↑</button>
              <button class="btn ghost" aria-label="Bir alta" disabled=${i === d.packs.length - 1} onClick=${() => movePack(d.packs, p, 1)}>↓</button>
              <${Button} onClick=${() => setPackEdit({ pack: p })}>Düzenle</${Button}>
              <${Button} kind="ghost" onClick=${() => togglePack(p)}>${p.enabled ? 'Kapat' : 'Aç'}</${Button}>
              ${p.builtin ? p.changed?.length > 0 && html`<${Button} kind="ghost" onClick=${() => resetPack(p)}>Orijinale dön</${Button}>` : html`<${Button} kind="danger" disabled=${p.owners > 0} title=${p.owners ? 'Alan var: silinemez, kapatılabilir' : ''} onClick=${() => deletePack(p)}>Sil</${Button}>`}
              ${!p.roomOnly && html`<${Button} kind="primary" disabled=${!d.storage} onClick=${() => setStickerEdit({ pack: p })}>Çıkartma ekle</${Button}>`}`}`}
        >
          ${p.builtin && p.changed?.length > 0 && html`<p class="muted">Uygulamada: ${p.original.name} · ${packLine({ ...p, ...p.original })}${p.original.enabled ? '' : ' · kapalı'}</p>`}
          <div class="sticker-grid">
            ${shown.map(
              (s, k) => html`<div class=${`sticker-tile ${s.enabled ? '' : 'off'}`} key=${s.id}>
                <button class="sticker-face" title=${`${s.name} (${s.id})`} disabled=${!edit} onClick=${() => setStickerEdit({ sticker: s, pack: p })}><${Face} s=${s} /></button>
                <small>${s.name}</small>
                <span class="row gap">
                  ${s.art?.kind === 'lottie' && html`<${Badge} label="Lottie" />`}
                  ${!s.enabled && html`<${Badge} s="passive" label="Kapalı" />`}
                  ${s.changed?.length > 0 && html`<${Badge} s="warning" label=${listOf(s.changed, STICKER_TR)} />`}
                  ${!s.builtin && html`<${Badge} s="active" label="Eklenen" />`}
                </span>
                ${edit && open.has(p.id) && html`<span class="row gap">
                  <button class="btn ghost" aria-label="Öne al" disabled=${k === 0} onClick=${() => moveSticker(p, s, -1)}>←</button>
                  <button class="btn ghost" aria-label="Arkaya al" disabled=${k === p.stickers.length - 1} onClick=${() => moveSticker(p, s, 1)}>→</button>
                </span>`}
              </div>`,
            )}
          </div>
          ${p.stickers.length > PEEK || (edit && p.stickers.length > 1)
            ? html`<${Button} kind="ghost" onClick=${() => fold(p.id)}>${open.has(p.id) ? 'Kapat' : p.stickers.length > PEEK ? `Hepsini göster (${p.stickers.length})` : 'Sırala'}</${Button}>`
            : ''}
        </${Card}>`;
      })}`}</${Loading}>
    ${packEdit && list.data && html`<${PackEditor} pack=${packEdit.pack} limits=${list.data.limits} onClose=${() => setPackEdit(null)} onSaved=${(t) => (setPackEdit(null), done(t))} />`}
    ${stickerEdit && list.data && html`<${StickerEditor} sticker=${stickerEdit.sticker} pack=${stickerEdit.pack} packs=${list.data.packs} limits=${list.data.limits} onClose=${() => setStickerEdit(null)} onSaved=${(t) => (setStickerEdit(null), done(t))} />`}
  </${Page}>`;
}

function PackEditor({ pack, limits: L, onClose, onSaved }) {
  const app = !!pack?.builtin;
  const o = pack?.original;
  const [v, setV] = useState({ name: pack?.name ?? '', price: String(pack?.price ?? 0), minVip: String(pack?.minVip ?? 0), enabled: pack ? pack.enabled : true });
  const [busy, setBusy] = useState(false);
  const was = (show, text) => app && show && html`<small class="muted">Uygulamada: ${text}</small>`;
  const save = async () => {
    const name = v.name.replace(/\s+/g, ' ').trim();
    const price = Number(v.price);
    const minVip = Number(v.minVip);
    if (name.length < L.packNameMin || name.length > L.packNameMax) return showError(new Error(`Ad ${L.packNameMin}–${L.packNameMax} karakter olmalı`));
    if (!Number.isSafeInteger(price) || price < 0 || price > L.priceMax) return showError(new Error(`Fiyat 0–${num(L.priceMax)} jeton olmalı (0: ücretsiz)`));
    const fields = { name, price, minVip, enabled: !!v.enabled };
    setBusy(true);
    try {
      if (pack) {
        const patch = {};
        for (const k of Object.keys(fields)) if (fields[k] !== pack[k]) patch[k] = fields[k];
        if (!Object.keys(patch).length) return onClose();
        await post('/api/app/emoji/packs/update', { id: pack.id, ...patch });
        onSaved('Paket kaydedildi');
      } else {
        await post('/api/app/emoji/packs', fields);
        onSaved('Paket eklendi; şimdi çıkartmalarını ekleyin');
      }
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  };
  return html`<${Modal} title=${pack ? `${pack.name}${app ? ' (uygulamanın paketi)' : ''}` : 'Yeni paket'} onClose=${onClose}>
    <div class="form"><div class="grid2">
      <label class="field"><span>Ad *</span><input value=${v.name} maxlength=${L.packNameMax} onInput=${(e) => setV({ ...v, name: e.target.value })} placeholder="Ör. Kedi Sarayı" />${was(v.name.trim() !== o?.name, o?.name)}</label>
      <label class="field"><span>Fiyat (jeton)</span><input inputmode="numeric" value=${v.price} disabled=${pack?.roomOnly} onInput=${(e) => setV({ ...v, price: e.target.value.replace(/[^\d]/g, '') })} /><small class="muted">0: ücretsiz (ya da yalnız VIP ile açılır). Mağazada bu fiyatla satılır.</small>${was(Number(v.price) !== o?.price, `${num(o?.price)} jeton`)}</label>
      <label class="field"><span>En düşük VIP seviyesi</span><select value=${v.minVip} onChange=${(e) => setV({ ...v, minVip: e.target.value })}>${Array.from({ length: L.vipMax + 1 }, (_, i) => html`<option value=${String(i)}>${i ? `VIP ${i}` : 'Herkes'}</option>`)}</select>${was(Number(v.minVip) !== o?.minVip, o?.minVip ? `VIP ${o.minVip}` : 'herkes')}</label>
      <label class="field inline"><span>Açık (panelde ve mağazada)</span><input type="checkbox" checked=${v.enabled} onChange=${(e) => setV({ ...v, enabled: e.target.checked })} />${was(!!v.enabled !== o?.enabled, o?.enabled ? 'açık' : 'kapalı')}</label>
    </div></div>
    ${pack?.owners > 0 && html`<p class="note">Bu paketi ${num(pack.owners)} kişi aldı. Fiyat değişikliği yeni alımlardan itibaren geçer; kapatılsa da aldıkları çıkartmalar mesajlarda görünür.</p>`}
    <div class="row end gap" style="margin-top:12px">
      <${Button} onClick=${onClose} disabled=${busy}>Vazgeç</${Button}>
      <${Button} kind="primary" disabled=${busy} onClick=${save}>${busy ? 'Kaydediliyor…' : pack ? 'Kaydet' : 'Paketi ekle'}</${Button}>
    </div>
  </${Modal}>`;
}

function StickerEditor({ sticker, pack, packs, limits: L, onClose, onSaved }) {
  const app = !!sticker?.builtin;
  const o = sticker?.original;
  const [v, setV] = useState({ name: sticker?.name ?? '', emoji: sticker?.emoji ?? '', pack: sticker?.pack ?? pack.id, enabled: sticker ? sticker.enabled : true });
  // A picked file ({ file, url, kind }), a fetched one ({ at, url, kind, link, bytes }) or { reset: true }: the app's own.
  const [art, setArt] = useState(null);
  const [link, setLink] = useState(sticker?.artLink ?? '');
  const [busy, setBusy] = useState(null);
  const was = (show, text) => app && show && html`<small class="muted">Uygulamada: ${text}</small>`;
  // A Hamle sticker stays in Hamle; nothing else goes there.
  const choices = packs.filter((p) => (pack.roomOnly ? p.id === pack.id : !p.roomOnly));
  const face = art?.reset ? { picture: o?.picture, emoji: v.emoji || o?.emoji } : art ? { picture: art.kind === 'image' ? art.url : null, emoji: v.emoji || '🙂' } : { picture: sticker?.picture, emoji: v.emoji || sticker?.emoji || '🙂' };

  const pick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const type = artType(file);
    if (!type) return showError(new Error('Resim PNG, WebP ya da Lottie (JSON) olmalı'));
    if (file.size > L.artBytes) return showError(new Error(`Resim en fazla ${kb(L.artBytes)} olabilir (bu ${kb(file.size)})`));
    setArt({ file, url: URL.createObjectURL(file), kind: type === 'application/json' ? 'lottie' : 'image' });
  };
  const pull = async () => {
    setBusy('İndiriliyor…');
    try {
      const out = await post('/api/app/emoji/fetch', { url: link.trim() });
      setArt({ at: out.url, url: out.preview, kind: out.kind, link: out.link, bytes: out.bytes });
      setLink(out.link);
      toast(`Resim bağlantıdan alındı (${kb(out.bytes)}); kaydedince çıkartmaya geçer`);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(null);
    }
  };
  const save = async () => {
    const name = v.name.replace(/\s+/g, ' ').trim();
    if (name.length < L.nameMin || name.length > L.nameMax) return showError(new Error(`Ad ${L.nameMin}–${L.nameMax} karakter olmalı`));
    if (!sticker && !art) return showError(new Error('Resim seçin'));
    try {
      let at;
      if (art?.at) at = art.at;
      else if (art?.file) {
        setBusy('Resim yükleniyor…');
        at = await upload(art.file);
      }
      setBusy('Kaydediliyor…');
      if (sticker) {
        const patch = {};
        if (name !== sticker.name) patch.name = name;
        if ((v.emoji.trim() || (app ? o.emoji : sticker.emoji)) !== sticker.emoji) patch.emoji = v.emoji.trim();
        if (v.pack !== sticker.pack) patch.pack = v.pack;
        if (!!v.enabled !== sticker.enabled) patch.enabled = !!v.enabled;
        if (at) Object.assign(patch, { art: at, artLink: art.link ?? null });
        if (art?.reset) patch.art = null;
        if (!Object.keys(patch).length) return onClose();
        await post('/api/app/emoji/stickers/update', { id: sticker.id, ...patch });
        onSaved('Çıkartma kaydedildi');
      } else {
        await post('/api/app/emoji/stickers', { pack: v.pack, name, emoji: v.emoji.trim(), enabled: !!v.enabled, art: at, artLink: art.link ?? null });
        onSaved('Çıkartma eklendi');
      }
    } catch (e) {
      showError(e);
    } finally {
      setBusy(null);
    }
  };
  const reset = async () => {
    if (!confirm(`“${sticker.name}” uygulamadaki haline dönsün mü? Geri alınacak: ${listOf(sticker.changed, STICKER_TR)}. Yüklenen resim silinir.`)) return;
    if (await act(() => post('/api/app/emoji/stickers/reset', { id: sticker.id }))) onSaved('Çıkartma orijinaline döndü');
  };
  const remove = async () => {
    if (!confirm(`“${sticker.name}” silinsin mi? Resmi depodan silinir; gönderildiği mesajlarda emojisiyle görünür. Geri alınamaz.`)) return;
    if (await act(() => post('/api/app/emoji/stickers/delete', { id: sticker.id }))) onSaved('Çıkartma silindi');
  };

  return html`<${Modal} title=${sticker ? `${sticker.name}${app ? ' (uygulamanın çıkartması)' : ''}` : `${pack.name}: yeni çıkartma`} wide onClose=${onClose}>
    <div class="form"><div class="grid2">
      <label class="field"><span>Ad *</span><input value=${v.name} maxlength=${L.nameMax} onInput=${(e) => setV({ ...v, name: e.target.value })} placeholder="Ör. Mırnav" />${was(v.name.trim() !== o?.name, o?.name)}</label>
      <label class="field"><span>Emoji</span><input value=${v.emoji} maxlength="8" onInput=${(e) => setV({ ...v, emoji: e.target.value })} placeholder=${app ? o.emoji : '🙂'} /><small class="muted">Yazı satırlarında ve resmin çizilemediği yerde görünür.</small>${was(v.emoji.trim() && v.emoji.trim() !== o?.emoji, o?.emoji)}</label>
      <label class="field"><span>Paket</span><select value=${v.pack} onChange=${(e) => setV({ ...v, pack: e.target.value })}>${choices.map((p) => html`<option value=${p.id}>${p.name}</option>`)}</select>${was(v.pack !== o?.pack, packs.find((p) => p.id === o?.pack)?.name ?? o?.pack)}</label>
      <label class="field inline"><span>Açık (panelde görünür)</span><input type="checkbox" checked=${v.enabled} onChange=${(e) => setV({ ...v, enabled: e.target.checked })} /></label>
    </div></div>

    <h3>Resim</h3>
    <p class="muted">Saydam (arka planı silinmiş) PNG ya da WebP, kare, ${L.artMinPx}–${L.artMaxPx} piksel (önerilen 256 × 256), ya da en çok ${num(L.lottieMaxMs / 1000)} saniyelik bir Lottie animasyonu (JSON, resimleri dosyanın içinde); en çok ${kb(L.artBytes)}. Lottie telefonda oynar; burada emojisi görünür.${app ? ' Seçmezseniz uygulamanın resmi kalır.' : ''}</p>
    <div class="row gap wrap">
      <input type="file" accept="image/png,image/webp,application/json,.json" aria-label="Çıkartma resmi" onChange=${pick} />
      ${app && sticker.changed?.includes('art') && !art?.reset && html`<${Button} kind="ghost" onClick=${() => setArt({ reset: true })}>Uygulamanın resmine dön</${Button}>`}
      ${art?.reset && html`<span class="muted">Kaydedince uygulamanın resmi döner.</span> <${Button} kind="ghost" onClick=${() => setArt(null)}>Vazgeç</${Button}>`}
    </div>
    <div class="row gap wrap" style="margin-top:6px">
      <input type="url" style="flex:1;min-width:280px" value=${link} placeholder="ya da bağlantı yapıştırın: https://alanadiniz.com/emoji/kedi.png" aria-label="Resmin bağlantısı" onInput=${(e) => setLink(e.target.value)} />
      <${Button} disabled=${!!busy || !link.trim()} onClick=${pull}>${busy === 'İndiriliyor…' ? busy : 'Bağlantıdan çek'}</${Button}>
    </div>
    ${art?.file && html`<small class="muted">${art.file.name} · ${art.kind === 'lottie' ? 'Lottie animasyonu' : 'resim'} · ${kb(art.file.size)}</small>`}
    ${art?.at && html`<small class="muted">Bağlantıdan alındı · ${art.kind === 'lottie' ? 'Lottie animasyonu' : 'resim'} · ${kb(art.bytes)}</small>`}

    <h3>Önizleme</h3>
    <div class="gift-preview">
      <div class="gift-tile"><${Face} s=${face} size=${56} /><b>${v.name.trim() || 'Çıkartma adı'}</b></div>
      <div class="muted">${packs.find((p) => p.id === v.pack)?.name ?? ''} · ${v.enabled ? 'açık' : 'kapalı'}${(art?.kind ?? sticker?.art?.kind) === 'lottie' ? ' · Lottie' : ''}</div>
    </div>

    <div class="row gap" style="margin-top:12px;justify-content:space-between">
      <span class="row gap">
        ${app && sticker.changed?.length > 0 && html`<${Button} kind="ghost" disabled=${!!busy} onClick=${reset}>Orijinale dön</${Button}>`}
        ${sticker && !app && html`<${Button} kind="danger" disabled=${!!busy} onClick=${remove}>Sil</${Button}>`}
      </span>
      <span class="row gap">
        <${Button} onClick=${onClose} disabled=${!!busy}>Vazgeç</${Button}>
        <${Button} kind="primary" disabled=${!!busy} onClick=${save}>${busy && busy !== 'İndiriliyor…' ? busy : sticker ? 'Kaydet' : 'Çıkartmayı ekle'}</${Button}>
      </span>
    </div>
  </${Modal}>`;
}
