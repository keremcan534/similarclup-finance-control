// Uygulama › Şanslı hediye ayarı: the app's Şanslı packages (its lucky.mjs; server/app-admin.ts passes the calls on as
// the signed-in panel user). Each package's name, emoji, price, odds (out of %100, "Ödül yok" takes what is left) and
// on/off; a new package (up to 20, its id lkN or typed); the daily payout limit and the announcement; each package's own
// icon and video (the app's lucky-art.mjs), uploaded and converted as a gift's (the Hediyeler parts, app-gifts.js).
// Every save sends the whole settings with the version they were read at: a save on an older copy is refused (409)
// and the page reads them again. A chance feature paid with bought coins: the owners' legal question is open
// (cix docs/DENETIM.md §1), the page says so.
import { Badge, Button, Card, Kpi, Loading, Modal, Page, Table, act, dateTimeTr, get, html, num, post, showError, toast, useApi, useApp, useEffect, useState } from '../lib.js';
import { KIND_TEXT, LinkHelp, Stage, VideoChoices, VideoRules, mb, size, specOf, typeOf, upload, videoKindOf, videoLine, IMAGE_LINK, VIDEO_LINK, linkName } from './app-gifts.js';
import { LIMIT_MAX, MULTS, PACKAGES_MAX, PRICE, draftOf, nextId, oddsOf, packageOf, packageProblems, pctOf, rtpOf, savable, topOf, withPackage } from '../lucky-odds.js';

const oddsLine = (tiers) => tiers.filter((t) => t.weight > 0).map((t) => `${t.mult ? `${t.mult}x` : 'ödül yok'} %${pctOf(t.weight)}`).join(' · ');
/** The picture a package shows: its own icon, the app's (lk1–lk4), or none (its emoji). */
const pictureOf = (art) => art?.icon ?? art?.original?.icon ?? null;
const Picture = ({ art, emoji, big = false }) => {
  const src = pictureOf(art);
  return src ? html`<img class=${big ? 'gift-big' : 'gift-icon'} src=${src} alt="" loading="lazy" />` : html`<span class="gift-emoji">${emoji}</span>`;
};

export function AppLucky() {
  const { can, meta } = useApp();
  const data = useApi(meta.app_link ? '/api/app/lucky' : null);
  const [pkg, setPkg] = useState(null);
  const [general, setGeneral] = useState(false);
  const [artOf, setArtOf] = useState(null);
  const [playing, setPlaying] = useState(null);
  const d = data.data;
  // A video converts on the app's server: the settings are read again every few seconds until it is done.
  const processing = !!d?.art?.some((a) => a.job?.status === 'processing');
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(data.reload, 4000);
    return () => clearInterval(t);
  }, [processing]);
  if (!meta.app_link)
    return html`<${Page} title="Şanslı hediyeler"><div class="empty bad">Uygulama bağlantısı ayarlı değil: sunucuda FC_APP_API_URL ve FC_APP_API_KEY gerekli.</div></${Page}>`;

  const editing = can('app.lucky');
  /** The whole settings saved; true when it went through. A save on an older copy reads the settings again. */
  const save = async (config, text) => {
    try {
      await post('/api/app/lucky/config', { config: savable(config), version: d.version });
      toast(text);
      data.reload();
      return true;
    } catch (e) {
      if (e.status === 409) data.reload();
      showError(e);
      return false;
    }
  };
  const toggle = (g) =>
    confirm(g.enabled ? `“${g.name}” satıştan kalksın mı? Kimse gönderemez; ayarları burada kalır.` : `“${g.name}” herkesin Şanslı rafında görünsün mü?`) &&
    save({ ...d.config, gifts: d.config.gifts.map((x) => (x.id === g.id ? { ...x, enabled: !g.enabled } : x)) }, g.enabled ? `${g.name} kapatıldı` : `${g.name} açıldı`);
  const remove = (g) =>
    confirm(`“${g.name}” paketlerden çıkarılsın mı? Kimse gönderemez; geçmiş gönderimler kalır. Çoğu zaman kapatmak yeterlidir. İkonu ve videosu silinmez: aynı kimlikle (${g.id}) yeniden eklenirse geri gelir.`) &&
    save({ ...d.config, gifts: d.config.gifts.filter((x) => x.id !== g.id) }, `${g.name} çıkarıldı`);
  const artFor = (id) => d.art?.find((a) => a.id === id) ?? null;

  return html`<${Page}
    title="Şanslı hediyeler"
    subtitle="Uygulamadaki Şanslı hediye paketleri: fiyat, olasılık tablosu (toplam %100), açık/kapalı, ikon ve video; günlük ödül limiti ve duyuru çarpanı. Kayıt anında herkes için geçer; ödülü uygulamanın sunucusu çeker. Alıcı her gönderimde fiyatın %20'sini elmas olarak alır."
    actions=${editing && d && html`<${Button} onClick=${() => setGeneral(true)}>Limit ve duyuru</${Button}>
      <${Button} kind="primary" disabled=${d.config.gifts.length >= PACKAGES_MAX} title=${d.config.gifts.length >= PACKAGES_MAX ? `En çok ${PACKAGES_MAX} paket olur` : ''} onClick=${() => setPkg({})}>Yeni paket</${Button}>`}
  >
    <p class="note bad">Şans özelliği: hukuk görüşü açık (sahip kararı 19.11.2026). Satın alınan jetonla oynanır, kazanç nakde dönebilir; yayından önce avukat görüşü alınmalı, gerekirse paketler buradan kapatılır.</p>
    <${Loading} state=${data}>${(d) => html`
      <div class="kpis">
        ${[['Bugün', d.stats.today], ['Toplam', d.stats.total]].map(([l, s]) => html`
          <${Kpi} label=${`${l}: gönderim`} value=${num(s.sends)} />
          <${Kpi} label=${`${l}: harcanan jeton`} value=${num(s.spent)} />
          <${Kpi} label=${`${l}: ödenen oyun jetonu`} value=${num(s.paid)} sub=${s.spent ? `geri ödeme %${num((s.paid / s.spent) * 100, 1)}` : ''} />
          <${Kpi} label=${`${l}: alıcılara elmas`} value=${num(s.shared)} />`)}
      </div>
      ${d.art && !d.storage && html`<div class="empty bad">Uygulamanın dosya deposu açık değil: ikon ve video yüklenemez.</div>`}
      <${Card} title=${`Paketler (${d.config.gifts.length}/${PACKAGES_MAX} · sürüm ${d.version}${d.updatedAt ? ` · ${dateTimeTr(d.updatedAt)}` : ''})`}>
        <p class="muted">Günlük ödül limiti ${num(d.config.dailyPayoutLimit)} oyun jetonu · ${d.config.announceFrom}x ve üstü odada duyurulur.</p>
        <${Table} dense columns=${[
          { key: 'icon', label: '', render: (g) => html`<${Picture} art=${artFor(g.id)} emoji=${g.emoji} />` },
          { key: 'name', label: 'Paket', render: (g) => html`<strong>${g.emoji} ${g.name}</strong><br /><small class="muted">${g.id}${artFor(g.id)?.iconLink || artFor(g.id)?.videoLink ? ' · 🔗 bağlantıdan' : ''}</small>` },
          { key: 'price', label: 'Fiyat', align: 'right', render: (g) => num(g.price) },
          { key: 'enabled', label: 'Durum', render: (g) => html`<${Badge} s=${g.enabled ? 'active' : 'passive'} label=${g.enabled ? 'Açık' : 'Kapalı'} />` },
          { key: 'tiers', label: 'Olasılıklar', render: (g) => html`<div class="cell-wrap" style="min-width:220px;max-width:360px"><small>${oddsLine(g.tiers)}</small></div>` },
          { key: 'rtp', label: 'Ortalama geri ödeme', align: 'right', render: (g) => `%${num(rtpOf(g.tiers) * 100, 2)}` },
          { key: 'top', label: 'En yüksek', align: 'right', render: (g) => `${topOf(g.tiers)}x` },
          ...(d.art ? [{ key: 'video', label: 'Video', render: (g) => html`<div class="cell-wrap" style="max-width:230px">${videoLine(artFor(g.id) ?? {})}</div>` }] : []),
          {
            key: 'a',
            label: '',
            render: (g) => {
              const a = artFor(g.id);
              return html`<span class="row gap wrap actions">
                ${a?.video && html`<${Button} kind="ghost" onClick=${() => setPlaying({ src: a.video.url })}>Oynat</${Button}>`}
                ${a?.job?.status === 'failed' && a.job.preview && html`<${Button} kind="ghost" onClick=${() => setPlaying({ src: a.job.preview, refused: true })}>Önizle</${Button}>`}
                ${editing && html`<${Button} onClick=${() => setPkg({ gift: g })}>Düzenle</${Button}>
                  ${d.art && html`<${Button} disabled=${!d.storage} onClick=${() => setArtOf(g.id)}>İkon ve video</${Button}>`}
                  <${Button} kind="ghost" onClick=${() => toggle(g)}>${g.enabled ? 'Kapat' : 'Aç'}</${Button}>
                  ${d.config.gifts.length > 1 && html`<${Button} kind="danger" onClick=${() => remove(g)}>Çıkar</${Button}>`}`}
              </span>`;
            },
          },
        ]} rows=${d.config.gifts} />
      </${Card}>
      <${Card} title="Son gönderimler"><${Table} dense empty="Gönderim yok" columns=${[
        { key: 'at', label: 'Zaman', render: (s) => dateTimeTr(s.at) },
        { key: 'sender', label: 'Gönderen', render: (s) => s.sender.name },
        { key: 'giftId', label: 'Paket', render: (s) => d.config.gifts.find((g) => g.id === s.giftId)?.name ?? s.giftId },
        { key: 'count', label: 'Adet', align: 'right' },
        { key: 'cost', label: 'Harcanan', align: 'right', render: (s) => num(s.cost) },
        { key: 'payout', label: 'Ödül', align: 'right', render: (s) => num(s.payout) },
        { key: 'best', label: 'En iyi', align: 'right', render: (s) => (s.best ? `${s.best}x` : '—') },
      ]} rows=${d.recent} /></${Card}>`}</${Loading}>
    ${pkg && d && html`<${PackageEditor}
      gift=${pkg.gift}
      config=${d.config}
      onClose=${() => setPkg(null)}
      onSave=${async (p) => {
        if (!(await save(withPackage(d.config, p, pkg.gift?.id ?? null), pkg.gift ? `${p.name} kaydedildi` : `${p.name} eklendi`))) return;
        setPkg(null);
        // A new package: its icon and video next (one with this id before it keeps its old ones: they show there).
        if (!pkg.gift && d.art && d.storage) setArtOf(p.id);
      }}
    />`}
    ${general && d && html`<${GeneralEditor} config=${d.config} onClose=${() => setGeneral(false)} onSave=${async (c) => (await save(c, 'Limit ve duyuru kaydedildi')) && setGeneral(false)} />`}
    ${artOf && d?.config.gifts.some((g) => g.id === artOf) && html`<${ArtEditor}
      key=${artOf}
      gift=${d.config.gifts.find((g) => g.id === artOf)}
      art=${artFor(artOf)}
      admin=${d}
      onClose=${() => setArtOf(null)}
      onSaved=${(text) => (setArtOf(null), toast(text), data.reload())}
    />`}
    ${playing && html`<${Modal} title="Önizleme" onClose=${() => setPlaying(null)}>
      ${playing.refused && html`<p class="note bad">Kullanılmayan video: odada böyle, arka planıyla kutu gibi görünürdü. Paketteki video değişmedi.</p>`}
      <${Stage} src=${playing.src} onEnd=${() => setPlaying(null)} />
    </${Modal}>`}
  </${Page}>`;
}

/** One package: a new one (no `gift`: its id lkN, or typed) or one that exists (its id stays). */
function PackageEditor({ gift, config, onClose, onSave }) {
  const others = config.gifts.filter((g) => g.id !== gift?.id);
  const [p, setP] = useState(() => ({
    id: gift?.id ?? nextId(config.gifts),
    name: gift?.name ?? '',
    emoji: gift?.emoji ?? '🍀',
    price: gift ? String(gift.price) : '',
    enabled: gift ? gift.enabled : false,
    draft: draftOf(gift?.tiers ?? []),
  }));
  const [busy, setBusy] = useState(false);
  const odds = oddsOf(p.draft);
  const problems = packageProblems(p, others);
  const set = (k) => (e) => setP({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const setPct = (m) => (e) => setP({ ...p, draft: { ...p.draft, [m]: e.target.value } });
  const changedOdds = gift && JSON.stringify(odds.tiers.filter((t) => t.weight > 0)) !== JSON.stringify([...gift.tiers].sort((a, b) => a.mult - b.mult).filter((t) => t.weight > 0));
  const submit = async () => {
    if (problems.length) return;
    setBusy(true);
    try {
      await onSave(packageOf(p));
    } finally {
      setBusy(false);
    }
  };
  const total = html`<${Badge} s=${odds.ok ? 'active' : 'error'} label=${`Toplam %${pctOf(odds.total)}${odds.ok ? '' : ' · %100 olmalı'}`} />`;
  return html`<${Modal} title=${gift ? `${gift.emoji} ${gift.name}` : 'Yeni Şanslı paket'} wide onClose=${onClose}>
    ${!gift && html`<p class="note">Yeni paket kaydedilince herkesin Şanslı rafına girer (Açık işaretliyse). Eski APK'lar yeni paketi görür ve gönderebilir; ikonunu ve videosunu yalnız yeni APK gösterir.</p>`}
    ${gift && html`<p class="muted" style="margin-top:-6px">Fiyat ya da olasılık değişirse sayfası açık olan yeni APK'lar gönderimden önce yeni değeri görür; eski APK'lar sunucunun o anki değeriyle oynar (yoğun saatlerde değiştirmemek iyi olur).</p>`}
    <div class="form"><div class="grid2">
      <label class="field"><span>Kimlik ${gift ? '' : '*'}</span><input value=${p.id} disabled=${!!gift} maxlength="22" onInput=${(e) => setP({ ...p, id: e.target.value.trim().toLowerCase() })} /><small class="muted">${gift ? 'Değişmez.' : '"lk" ve küçük harf ya da rakam (ör. lk5); sonra değişmez.'}</small></label>
      <label class="field"><span>Ad *</span><input value=${p.name} maxlength="30" placeholder="Ör. Altın Yonca" onInput=${set('name')} /></label>
      <label class="field"><span>Simge (emoji) *</span><input value=${p.emoji} maxlength="8" onInput=${set('emoji')} /><small class="muted">Sohbet satırlarında ve ikon yokken görünür.</small></label>
      <label class="field"><span>Fiyat (jeton, ${num(PRICE.min)}–${num(PRICE.max)}) *</span><input inputmode="numeric" value=${p.price} onInput=${(e) => setP({ ...p, price: e.target.value.replace(/[^\d]/g, '') })} /></label>
      <label class="field inline"><span>Açık (herkes görür ve gönderebilir)</span><input type="checkbox" checked=${p.enabled} onChange=${set('enabled')} /></label>
    </div></div>
    <h3>Olasılıklar ${total}</h3>
    <p class="muted">Her çarpanın çıkma olasılığı yüzde olarak, en çok 3 ondalık (%0,001 adımlarla). <b>Ödül yok</b> kalanı kendiliğinden alır; toplam %100 değilse kaydedilmez.</p>
    <div class="row gap wrap">
      <label class="field" style="width:120px"><span>Ödül yok (kalan)</span><input value=${`%${pctOf(Math.max(0, odds.none))}`} disabled /></label>
      ${MULTS.map((m) => html`<label class="field" style="width:96px"><span>${m}x (%)</span><input inputmode="decimal" value=${p.draft[m]} placeholder="0" aria-invalid=${odds.bad.includes(m)} style=${odds.bad.includes(m) ? 'border-color:var(--bad)' : ''} onInput=${setPct(m)} /></label>`)}
    </div>
    <p class="muted">Ortalama geri ödeme %${num(rtpOf(odds.tiers) * 100, 2)} · en yüksek ${topOf(odds.tiers)}x${changedOdds ? ' · olasılıklar değişti' : ''}</p>
    ${problems.length > 0 && html`<ul class="note bad">${problems.map((x) => html`<li>${x}</li>`)}</ul>`}
    <div class="row end gap"><${Button} onClick=${onClose}>Vazgeç</${Button}><${Button} kind="primary" disabled=${busy || problems.length > 0} onClick=${submit}>${busy ? 'Kaydediliyor…' : gift ? 'Kaydet' : 'Paketi ekle'}</${Button}></div>
  </${Modal}>`;
}

/** The daily payout limit (all packages, the whole platform) and from which multiplier a win is told in the room. */
function GeneralEditor({ config, onClose, onSave }) {
  const [limit, setLimit] = useState(String(config.dailyPayoutLimit));
  const [announce, setAnnounce] = useState(config.announceFrom);
  const n = Number(limit);
  const ok = Number.isSafeInteger(n) && n >= 1 && n <= LIMIT_MAX;
  return html`<${Modal} title="Limit ve duyuru" onClose=${onClose}>
    <div class="form"><div class="grid2">
      <label class="field"><span>Günlük ödül limiti (oyun jetonu, bütün platform)</span><input inputmode="numeric" value=${limit} onInput=${(e) => setLimit(e.target.value.replace(/[^\d]/g, ''))} /><small class="muted">Bugün ödenen ödüller artı bir paketin en yüksek ödülü bunu geçecekse o paket yarına kadar gönderilemez.</small></label>
      <label class="field"><span>Odada duyurulan en düşük çarpan</span><select value=${String(announce)} onChange=${(e) => setAnnounce(Number(e.target.value))}>${MULTS.map((m) => html`<option value=${String(m)}>${m}x</option>`)}</select></label>
    </div></div>
    ${!ok && html`<p class="note bad">Limit 1 ile ${num(LIMIT_MAX)} arası bir tam sayı olmalı.</p>`}
    <div class="row end gap"><${Button} onClick=${onClose}>Vazgeç</${Button}><${Button} kind="primary" disabled=${!ok} onClick=${() => onSave({ ...config, dailyPayoutLimit: n, announceFrom: announce })}>Kaydet</${Button}></div>
  </${Modal}>`;
}

/**
 * A package's own icon and video, as a gift's (Hediyeler's checks, uploads, link fetch, SVGA size, full screen with
 * its background, preview). Saved on their own (POST /api/app/lucky/art); nothing about the package's odds changes.
 */
function ArtEditor({ gift, art, admin, onClose, onSaved }) {
  const A = admin.artLimits;
  // A picked or fetched icon ({ file, url } / { at, url, link, bytes }), or { remove: true }: back to the app's picture or the emoji.
  const [icon, setIcon] = useState(null);
  const [video, setVideo] = useState(art?.video || art?.job ? { mode: 'keep' } : { mode: 'none' });
  const [links, setLinks] = useState({ icon: art?.iconLink ?? '', video: art?.videoLink ?? '' });
  const [pulling, setPulling] = useState(null);
  const [step, setStep] = useState(null);
  const [preview, setPreview] = useState(null);
  useEffect(() => () => icon?.file && URL.revokeObjectURL(icon.url), [icon]);
  const iconUrl = icon?.remove ? (art?.original?.icon ?? null) : icon ? icon.url : pictureOf(art);

  /** The largest file the app's server takes now (a page left open across its update reads the limits again). */
  const fits = async (file, pick) => {
    if (file.size <= pick(A)) return { ok: true, max: pick(A) };
    const now = (await get('/api/app/lucky').catch(() => null))?.artLimits;
    const max = now ? pick(now) : pick(A);
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
    const room = await fits(file, (x) => (kind === 'stacked' ? x.videoBytes : kind === 'svga' ? (x.svgaBytes ?? x.sourceBytes) : x.sourceBytes));
    if (!room.ok) return showError(new Error(`Dosya en fazla ${mb(room.max)} MB olabilir (bu ${mb(file.size)} MB)`));
    setVideo({ mode: 'file', file, kind, fill: A.fill ?? 1, url: kind === 'stacked' ? URL.createObjectURL(file) : null });
  };
  /** A file from the link typed for `slot`, fetched once by the app's server; a link plainly for the other field moves there. */
  const pull = async (slot, url = links[slot].trim()) => {
    const other = slot === 'icon' && VIDEO_LINK.test(url) ? 'video' : slot === 'video' && IMAGE_LINK.test(url) ? 'icon' : null;
    if (other) {
      setLinks((x) => ({ ...x, [slot]: (slot === 'icon' ? art?.iconLink : art?.videoLink) ?? '', [other]: url }));
      toast(other === 'video' ? 'Bu bir video bağlantısı: Video alanına taşındı' : 'Bu bir resim bağlantısı: İkon alanına taşındı');
      return pull(other, url);
    }
    setPulling(slot);
    try {
      const out = await post('/api/app/lucky/fetch', { slot, url });
      if (slot === 'icon') setIcon({ at: out.url, url: out.preview, link: out.link, bytes: out.bytes });
      else {
        const kind = out.svga ? 'svga' : out.video === 'stacked' ? 'stacked' : 'source';
        setVideo({ mode: 'link', at: out.url, link: out.link, bytes: out.bytes, kind, fill: A.fill ?? 1, url: kind === 'stacked' ? out.preview : null, name: linkName(out.link) });
      }
      setLinks((x) => ({ ...x, [slot]: out.link }));
      toast(`${slot === 'icon' ? 'İkon' : 'Video'} bağlantıdan alındı (${size(out.bytes)}); kaydedince pakete geçer`);
    } catch (e) {
      showError(e);
    } finally {
      setPulling(null);
    }
  };
  const linkRow = (slot, example) => {
    const typed = links[slot].trim();
    const again = !!typed && typed === (slot === 'icon' ? art?.iconLink : art?.videoLink);
    return html`<div class="row gap wrap" style="margin-top:6px">
      <input type="url" style="flex:1;min-width:280px" value=${links[slot]} placeholder=${`ya da bağlantı yapıştırın: ${example}`} aria-label=${slot === 'icon' ? 'İkonun bağlantısı' : 'Videonun bağlantısı'} onInput=${(e) => setLinks({ ...links, [slot]: e.target.value })} />
      <${Button} disabled=${!!pulling || !!step || !typed} onClick=${() => pull(slot)}>${pulling === slot ? 'İndiriliyor…' : again ? 'Bağlantıdan yeniden çek' : 'Bağlantıdan çek'}</${Button}>
    </div>`;
  };

  const save = async () => {
    try {
      const body = { id: gift.id };
      if (icon?.remove) body.icon = null;
      else if (icon?.at) body.icon = icon.at;
      else if (icon?.file) {
        setStep('İkon yükleniyor…');
        body.icon = await upload('gifticon', icon.file);
      }
      if (icon && !icon.remove) body.iconLink = icon.link ?? null;
      if (video.mode === 'none' && (art?.video || art?.job)) body.video = null;
      if (video.mode === 'file') {
        const url = await upload(video.kind === 'stacked' ? 'giftvideo' : 'giftsource', video.file, (x) => setStep(`Video yükleniyor %${Math.round(x * 100)}`));
        body.video = specOf(video, url);
        body.videoLink = null;
      }
      if (video.mode === 'link') {
        body.video = specOf(video, video.at);
        body.videoLink = video.link;
      }
      if (Object.keys(body).length === 1) return onClose();
      setStep('Kaydediliyor…');
      await post('/api/app/lucky/art', body);
      onSaved(body.video?.kind === 'source' ? 'Kaydedildi; video uygulamanın sunucusunda çevriliyor' : 'İkon ve video kaydedildi');
    } catch (e) {
      showError(e);
    } finally {
      setStep(null);
    }
  };
  const removeAll = async () => {
    if (!confirm(`“${gift.name}” paketinin ikonu ve videosu kaldırılsın mı? Dosyaları silinir; paket ${art?.original?.icon ? 'uygulamanın resmiyle' : 'emojisiyle'} ve videosuz gönderilir.`)) return;
    if (await act(() => post('/api/app/lucky/art/remove', { id: gift.id }))) onSaved('İkon ve video kaldırıldı');
  };
  const own = !!(art?.icon || art?.video || art?.job);
  return html`<${Modal} title=${`${gift.emoji} ${gift.name}: ikon ve video`} wide onClose=${onClose}>
    ${art?.updatedAt && html`<p class="muted" style="margin-top:-6px">Son değişiklik: ${dateTimeTr(art.updatedAt)}</p>`}
    <h3>İkon</h3>
    <p class="muted">Saydam (arka planı silinmiş) PNG ya da WebP, kare, ${A.iconMinPx}–${A.iconMaxPx} piksel (önerilen 512 × 512), en çok ${mb(A.iconBytes)} MB. ${art?.original?.icon ? 'Yoksa uygulamanın kendi resmi görünür.' : 'Yoksa paketin emojisi görünür.'} Eski APK'lar paketin ikonunu göstermez.</p>
    <div class="row gap wrap">
      <input type="file" accept="image/png,image/webp" aria-label="İkon dosyası" onChange=${pickIcon} />
      ${(art?.icon || (icon && !icon.remove)) && !icon?.remove && html`<${Button} kind="ghost" onClick=${() => (art?.icon ? setIcon({ remove: true }) : setIcon(null))}>İkonu kaldır</${Button}>`}
      ${icon?.remove && html`<span class="muted">Kaydedince ikon kalkar.</span> <${Button} kind="ghost" onClick=${() => setIcon(null)}>Vazgeç</${Button}>`}
    </div>
    ${linkRow('icon', 'https://alanadiniz.com/sansli/yonca.png')}
    ${icon?.at && html`<small class="muted">Bağlantıdan alındı: ${linkName(icon.link)} · ${size(icon.bytes)}</small>`}

    <h3>Video (isteğe bağlı)</h3>
    <${VideoRules} L=${A} what="paket" />
    <div class="row gap wrap">
      <input type="file" accept=".mp4,.webm,.mov,.svga,video/mp4,video/webm,video/quicktime" aria-label="Video ya da SVGA dosyası" onChange=${pickVideo} />
      ${video.mode === 'link' && html`<span class="muted">Bağlantıdan: ${video.name} · ${KIND_TEXT[video.kind]} · ${size(video.bytes)}</span>`}
      ${video.mode === 'file' && html`<span class="muted">${video.file.name} · ${KIND_TEXT[video.kind]} · ${mb(video.file.size)} MB</span>`}
      ${video.mode === 'keep' && html`<span>${videoLine(art)}</span>`}
      ${video.mode === 'keep' && art?.job?.status === 'failed' && art.job.preview && html`<${Button} kind="ghost" onClick=${() => setPreview(art.job.preview)}>Önizle</${Button}>`}
      ${video.mode === 'none' && html`<span class="muted">Video yok: gönderilince ikonu uçar.</span>`}
      ${video.mode !== 'none' && html`<${Button} kind="ghost" onClick=${() => setVideo({ mode: 'none' })}>Videoyu kaldır</${Button}>`}
      ${video.mode === 'none' && (art?.video || art?.job) && html`<${Button} kind="ghost" onClick=${() => setVideo({ mode: 'keep' })}>Vazgeç</${Button}>`}
    </div>
    <${VideoChoices} video=${video} fills=${A.fills} onChange=${setVideo} />
    ${linkRow('video', 'https://alanadiniz.com/sansli/yonca.svga')}
    <${LinkHelp} />

    <h3>Önizleme</h3>
    <div class="gift-preview">
      <div class="gift-tile">
        ${iconUrl ? html`<img src=${iconUrl} alt="" />` : html`<span class="gift-emoji">${gift.emoji}</span>`}
        <b>${gift.name}</b>
        <small>🪙 ${num(gift.price)}</small>
      </div>
      ${iconUrl && html`<img class="gift-big" src=${iconUrl} alt="" />`}
      <div class="muted">Şanslı rafı · ${gift.enabled ? 'açık' : 'kapalı'}</div>
      ${((video.mode === 'file' || video.mode === 'link') && video.kind === 'stacked') || (video.mode === 'keep' && art?.video)
        ? html`<${Button} onClick=${() => setPreview(video.mode === 'keep' ? art.video.url : video.url)}>Videoyu oynat</${Button}>`
        : (video.mode === 'file' || video.mode === 'link') && html`<small class="muted">Bu dosya uygulamanın sunucusunda çevrildikten sonra listeden oynatılır.</small>`}
    </div>
    ${preview && html`<${Stage} src=${preview} onEnd=${() => setPreview(null)} />`}

    <div class="row end gap" style="margin-top:12px">
      ${own && html`<${Button} kind="danger" disabled=${!!step} onClick=${removeAll}>İkonu ve videoyu kaldır</${Button}>`}
      <${Button} onClick=${onClose} disabled=${!!step}>Vazgeç</${Button}>
      <${Button} kind="primary" disabled=${!!step || !!pulling} onClick=${save}>${step ?? 'Kaydet'}</${Button}>
    </div>
  </${Modal}>`;
}
