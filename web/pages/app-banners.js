// Banner Yönetimi (the owners' design, 25 Nov 2026): the banners at the top of the app's Odalar screen, before the
// ranking boards. The app keeps them (server/api/banners.mjs, admin routes through app-admin.ts, permission
// app.notices). A live preview as the phones show it; then the list (search, state filter, drag to order, on/off,
// edit, remove), the plan of the next weeks and the views and taps.
import { Button, Loading, Modal, Page, Tabs, act, html, post, showError, toast, useApi, useApp, useEffect, useState } from '../lib.js';

/** The app's own example pictures (app/assets/banners/ornek-*), copied here for the previews. */
export const READY_ART = [
  ['ornek-hediye-alanlar', 'En Çok Hediye Alanlar', '/img/banners/ornek-hediye-alanlar.webp'],
  ['ornek-hediye-gonderenler', 'En Çok Hediye Gönderenler', '/img/banners/ornek-hediye-gonderenler.webp'],
  ['ornek-zirvedeki-ajanslar', 'Zirvedeki Ajanslar', '/img/banners/ornek-zirvedeki-ajanslar.webp'],
  ['ajans-basvurusu', 'Ajans Başvurusu', '/img/banners/ajans-basvurusu.webp'],
];
/** Who sees a banner (the app's banners.mjs AUDIENCES, 26 Nov 2026). */
export const AUDIENCES = [
  ['all', 'Herkes'],
  ['no_agency', 'Ajansı olmayanlar'],
];
const artUrl = (k) => READY_ART.find(([a]) => a === k)?.[2] ?? null;
const picOf = (b) => b.imageUrl ?? artUrl(b.art);

/** The colours a banner's button and rim take (the app's ACCENT). */
export const ACCENTS = [
  ['mor', 'Mor', ['#C14DFF', '#7B2FF7'], '#fff'],
  ['pembe', 'Pembe', ['#FF5FA8', '#D61F78'], '#fff'],
  ['altin', 'Altın', ['#FFE08A', '#F2B635'], '#3A2400'],
  ['turkuaz', 'Turkuaz', ['#6FF3FF', '#22B8D6'], '#06303A'],
];
const accentOf = (k) => ACCENTS.find(([a]) => a === k) ?? ACCENTS[0];

/** Where a banner can lead in the app. */
const LINKS = [
  ['', 'Bağlantı yok'],
  ['/siralama?board=yayinci&period=weekly', 'Sıralama › En çok hediye alanlar'],
  ['/siralama?board=zengin&period=weekly', 'Sıralama › En çok hediye gönderenler'],
  ['/siralama?board=ajans&period=weekly', 'Sıralama › Zirvedeki ajanslar'],
  ['/magaza', 'Çarşı'],
  ['/vip', 'VIP'],
  ['/cuzdan', 'Cüzdan (jeton yükle)'],
  ['/oyunlar', 'Oyun merkezi'],
  ['/eslesme', 'Hemen Tanış'],
  ['/gorevler', 'Görevler'],
  ['/aile', 'Aile'],
  ['/davet', 'Arkadaşını getir'],
];

export const STATE = {
  live: ['Yayında', 'live'],
  scheduled: ['Planlandı', 'scheduled'],
  draft: ['Taslak', 'draft'],
  off: ['Pasif', 'off'],
  expired: ['Süresi doldu', 'expired'],
};
const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const dayText = (iso) => {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};
/** "15 Kas – 30 Kas", "15 Kas'tan", "30 Kas'a kadar" or "Süresiz". */
export function rangeText(b) {
  if (b.startsAt && b.endsAt) return `${dayText(b.startsAt)} – ${dayText(b.endsAt)}`;
  if (b.startsAt) return `${dayText(b.startsAt)} başlar`;
  if (b.endsAt) return `${dayText(b.endsAt)} biter`;
  return 'Süresiz';
}
const pct = (a, b) => (b ? `%${((a * 100) / b).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}` : '—');
const num = (n) => Number(n ?? 0).toLocaleString('tr-TR');
/** A datetime-local value (the browser's time) from an ISO time, and back. */
const toLocal = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocal = (v) => (v ? new Date(v).toISOString() : null);

/** A banner card as the app draws it: the picture, and with "Yazıları göster" its words and button on a dark sweep. */
export function BannerArt({ b, small = false }) {
  const [, , btn, ink] = accentOf(b.accent);
  const pic = picOf(b);
  return html`<div class=${`bm-art${small ? ' small' : ''}`} style=${`--rim:${btn[0]}`}>
    ${pic ? html`<img src=${pic} alt="" />` : html`<div class="bm-art-empty">Görsel yok</div>`}
    ${!small &&
    html`<div class=${`bm-art-body${b.showText ? ' text' : ''}`}>
      ${b.showText && html`<div class="bm-art-words"><strong>${b.title}</strong>${b.subtitle && html`<span>${b.subtitle}</span>`}</div>`}
      ${b.cta && b.link && html`<span class="bm-cta" style=${`background:linear-gradient(135deg,${btn[0]},${btn[1]});color:${ink}`}>${b.cta} ›</span>`}
    </div>`}
  </div>`;
}

/** The phones' slider: the live banners in order, a dot each, moving on by itself. */
function Preview({ live }) {
  const [i, setI] = useState(0);
  const n = live.length;
  useEffect(() => {
    if (n < 2) return;
    const t = setTimeout(() => setI((x) => (x + 1) % n), 4500);
    return () => clearTimeout(t);
  }, [i, n]);
  if (!n) return html`<div class="bm-preview empty">Şu an yayında banner yok. Odalar'da yalnız sıralamalar görünür.</div>`;
  const at = Math.min(i, n - 1);
  return html`<div class="bm-preview">
    <div class="bm-stage">
      ${n > 1 && html`<button class="bm-nav left" aria-label="Önceki" onClick=${() => setI((at - 1 + n) % n)}>‹</button>`}
      <${BannerArt} b=${live[at]} />
      ${n > 1 && html`<button class="bm-nav right" aria-label="Sonraki" onClick=${() => setI((at + 1) % n)}>›</button>`}
    </div>
    <div class="bm-dots">${live.map((b, k) => html`<button key=${b.id} class=${k === at ? 'on' : ''} aria-label=${b.title} onClick=${() => setI(k)}></button>`)}</div>
    <p class="bm-hint">Telefonlarda böyle görünür: Odalar'ın üstünde, sıralamalardan önce.</p>
  </div>`;
}

export function AppBanners() {
  const { can } = useApp();
  const list = useApi('/api/app/banners');
  const [tab, setTab] = useState('list');
  const [edit, setEdit] = useState(null);
  const editable = can('app.notices');
  return html`<${Page}
    title="Banner Yönetimi"
    subtitle="Uygulamanın Odalar ekranındaki kaydırmalı alan: bannerlar sırayla, sonra sıralamalar."
    actions=${editable && html`<${Button} kind="primary" onClick=${() => setEdit({})}>+ Yeni Banner Ekle</${Button}>`}
  >
    <div class="bm">
      <${Loading} state=${list}>${(d) => html`
        <${Preview} live=${d.banners.filter((b) => b.state === 'live').slice(0, d.maxLive ?? 10)} />
        <${Tabs} tabs=${[['list', '☰ Banner Listesi'], ['plan', '📅 Yayın Planı'], ['stats', '📊 Performans']]} value=${tab} onChange=${setTab} />
        ${tab === 'list' && html`<${BannerList} banners=${d.banners} editable=${editable} onEdit=${setEdit} reload=${list.reload} />`}
        ${tab === 'plan' && html`<${Plan} banners=${d.banners} onEdit=${editable ? setEdit : null} />`}
        ${tab === 'stats' && html`<${Stats} banners=${d.banners} />`}
      `}</${Loading}>
    </div>
    ${edit && html`<${BannerEditor} banner=${edit.id ? edit : null} onClose=${() => setEdit(null)} onSaved=${(msg) => (setEdit(null), toast(msg), list.reload())} />`}
  </${Page}>`;
}

const FILTERS = [['all', 'Tümü'], ...Object.entries(STATE).map(([k, [l]]) => [k, l])];

function BannerList({ banners, editable, onEdit, reload }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  // The order being dragged into place; saved with "Sıralamayı kaydet".
  const [order, setOrder] = useState(null);
  const [drag, setDrag] = useState(null);
  const byId = new Map(banners.map((b) => [b.id, b]));
  const rows = (order ?? banners.map((b) => b.id)).map((id) => byId.get(id)).filter(Boolean);
  const shown = rows.filter((b) => (filter === 'all' || b.state === filter) && (!q.trim() || b.title.toLocaleLowerCase('tr-TR').includes(q.trim().toLocaleLowerCase('tr-TR'))));
  const canDrag = editable && filter === 'all' && !q.trim();
  const move = (from, to) => {
    if (from === to) return;
    const ids = rows.map((b) => b.id);
    const [x] = ids.splice(ids.indexOf(from), 1);
    ids.splice(ids.indexOf(to) + (ids.indexOf(to) >= rows.findIndex((b) => b.id === from) ? 1 : 0), 0, x);
    setOrder(ids);
  };
  const saveOrder = async () => (await act(() => post('/api/app/banners/order', { ids: order }))) && (toast('Sıralama kaydedildi'), setOrder(null), reload());
  const toggle = async (b) => (await act(() => post('/api/app/banners/toggle', { id: b.id, enabled: !b.enabled }))) && (toast(b.enabled ? 'Banner kapatıldı' : 'Banner açıldı'), reload());
  const remove = async (b) =>
    confirm(`“${b.title}” kaldırılır: telefonlardan hemen kalkar, sayıları kayıtta kalır. Geri alınamaz.`) &&
    (await act(() => post('/api/app/banners/remove', { id: b.id }))) &&
    (toast('Banner kaldırıldı'), reload());
  const counts = Object.fromEntries(FILTERS.map(([k]) => [k, k === 'all' ? banners.length : banners.filter((b) => b.state === k).length]));
  return html`<div class="bm-list">
    <div class="bm-tools">
      <input class="bm-search" placeholder="🔍 Banner ara…" value=${q} onInput=${(e) => setQ(e.target.value)} />
      <div class="bm-filters">${FILTERS.map(([k, l]) => html`<button class=${filter === k ? 'on' : ''} onClick=${() => setFilter(k)}>${l} <small>${counts[k]}</small></button>`)}</div>
    </div>
    ${order && html`<div class="bm-orderbar"><span>Sıralama değişti; kaydedince telefonlarda yeni sırayla görünür.</span><${Button} onClick=${() => setOrder(null)}>Vazgeç</${Button}><${Button} kind="primary" onClick=${saveOrder}>Sıralamayı kaydet</${Button}></div>`}
    ${!shown.length && html`<div class="empty">${banners.length ? 'Bu filtrede banner yok' : 'Henüz banner yok. “Yeni Banner Ekle” ile başlayın.'}</div>`}
    ${shown.map(
      (b) => html`<div
        key=${b.id}
        class=${`bm-row${drag === b.id ? ' dragging' : ''}`}
        draggable=${canDrag}
        onDragStart=${(e) => (setDrag(b.id), e.dataTransfer.setData('text/plain', b.id))}
        onDragEnd=${() => setDrag(null)}
        onDragOver=${(e) => canDrag && e.preventDefault()}
        onDrop=${(e) => (e.preventDefault(), drag && move(drag, b.id), setDrag(null))}
      >
        <span class=${`bm-grip${canDrag ? '' : ' off'}`} title=${canDrag ? 'Sürükleyerek sırala' : 'Sıralamak için filtreyi ve aramayı kaldırın'}>⋮⋮</span>
        <${BannerArt} b=${b} small />
        <div class="bm-info">
          <strong>${b.title}</strong>
          <div class="row gap wrap">
            <span class=${`bm-state ${STATE[b.state][1]}`}>${b.state === 'live' ? '● ' : ''}${STATE[b.state][0]}</span>
            <span class="bm-when">📅 ${rangeText(b)}</span>
            ${b.audience === 'no_agency' && html`<span class="bm-when">👥 Ajansı olmayanlar</span>`}
          </div>
          <small class="muted">${b.link ? `→ ${b.link}` : 'Bağlantı yok'} · 7 gün: ${num(b.views7)} görüntülenme, ${num(b.clicks7)} tıklama</small>
        </div>
        ${editable &&
        html`<div class="bm-actions">
          <label class="bm-switch" title=${b.enabled ? 'Kapat' : 'Aç'}><input type="checkbox" checked=${b.enabled} disabled=${b.state === 'expired'} onChange=${() => toggle(b)} /><span></span></label>
          <div class="row gap">
            <button class="bm-icon" title="Düzenle" onClick=${() => onEdit(b)}>✎</button>
            <button class="bm-icon bad" title="Kaldır" onClick=${() => remove(b)}>🗑</button>
          </div>
        </div>`}
      </div>`,
    )}
    ${canDrag && banners.length > 1 && html`<p class="bm-tip">ⓘ <strong>İpucu:</strong> Bannerları sürükleyerek sıralamasını değiştirebilirsin. Telefonda yalnız yayında olanlar, bu sırayla görünür.</p>`}
  </div>`;
}

/** The next weeks: each banner a bar from its start to its end (open ends run to the edge); today marked. */
function Plan({ banners, onEdit }) {
  const DAYS = 35;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 3);
  const t0 = +start;
  const span = DAYS * 86_400_000;
  const at = (ms) => Math.max(0, Math.min(100, ((ms - t0) * 100) / span));
  const rows = banners.filter((b) => b.state !== 'expired' || (b.endsAt && Date.parse(b.endsAt) > t0));
  const ticks = Array.from({ length: DAYS / 7 + 1 }, (_, i) => t0 + i * 7 * 86_400_000);
  return html`<div class="bm-plan">
    <div class="bm-plan-head"><span></span><div class="bm-plan-axis">${ticks.map((t) => html`<span style=${`left:${at(t)}%`}>${dayText(new Date(t).toISOString())}</span>`)}<i class="bm-today" style=${`left:${at(Date.now())}%`}></i></div></div>
    ${!rows.length && html`<div class="empty">Plan boş</div>`}
    ${rows.map((b) => {
      const from = at(b.startsAt ? Date.parse(b.startsAt) : t0);
      const to = at(b.endsAt ? Date.parse(b.endsAt) : t0 + span);
      return html`<div class="bm-plan-row" key=${b.id}>
        <button class="bm-plan-name" disabled=${!onEdit} onClick=${() => onEdit?.(b)}><${BannerArt} b=${b} small /><span>${b.title}</span></button>
        <div class="bm-plan-track"><i class="bm-today" style=${`left:${at(Date.now())}%`}></i><span class=${`bm-bar ${STATE[b.state][1]}`} style=${`left:${from}%;width:${Math.max(1.5, to - from)}%`} title=${`${STATE[b.state][0]} · ${rangeText(b)}`}>${STATE[b.state][0]}</span></div>
      </div>`;
    })}
    <p class="bm-tip">Çubuk bannerın yayında kalacağı günleri gösterir; bitişi olmayanlar sağ kenara uzanır. Pasif ve taslaklar soluk görünür. Bir bannera tıklayıp tarihini değiştirebilirsin.</p>
  </div>`;
}

function Stats({ banners }) {
  const [days, setDays] = useState(30);
  const s = useApi(`/api/app/banners/stats?days=${days}`, [days]);
  return html`<div class="bm-stats">
    <${Tabs} tabs=${[[7, 'Son 7 gün'], [30, 'Son 30 gün'], [90, 'Son 90 gün']]} value=${days} onChange=${setDays} />
    <${Loading} state=${s}>${(d) => {
      const by = new Map();
      const daily = new Map();
      for (const r of d.rows) {
        const x = by.get(r.id) ?? { views: 0, clicks: 0 };
        x.views += r.views;
        x.clicks += r.clicks;
        by.set(r.id, x);
        const y = daily.get(r.day) ?? { views: 0, clicks: 0 };
        y.views += r.views;
        y.clicks += r.clicks;
        daily.set(r.day, y);
      }
      const total = [...by.values()].reduce((a, x) => ({ views: a.views + x.views, clicks: a.clicks + x.clicks }), { views: 0, clicks: 0 });
      const top = Math.max(1, ...[...daily.values()].map((x) => x.views));
      const dayList = [...daily.entries()].sort(([a], [b]) => a.localeCompare(b));
      return html`
        <div class="bm-kpis">
          <div><small>Görüntülenme</small><strong>${num(total.views)}</strong></div>
          <div><small>Tıklama</small><strong>${num(total.clicks)}</strong></div>
          <div><small>Tıklama oranı</small><strong>${pct(total.clicks, total.views)}</strong></div>
        </div>
        ${!dayList.length && html`<div class="empty">Bu dönemde henüz görüntülenme yok. Telefonlar bannerı gösterdikçe burada günlük sayılar çıkar.</div>`}
        <div class="bm-chart" hidden=${!dayList.length} aria-label="Günlük görüntülenme">${dayList.map(([day, x]) => html`<div title=${`${day}: ${num(x.views)} görüntülenme, ${num(x.clicks)} tıklama`}><i style=${`height:${(x.views * 100) / top}%`}></i><b style=${`height:${(x.clicks * 100) / top}%`}></b></div>`)}</div>
        <p class="bm-tip">Mor: görüntülenme, pembe: tıklama. Her kişi bir bannerı günde bir kez sayılır.</p>
        <table class="table"><thead><tr><th>Banner</th><th>Durum</th><th class="r">Görüntülenme</th><th class="r">Tıklama</th><th class="r">Oran</th></tr></thead><tbody>
          ${banners.map((b) => {
            const x = by.get(b.id) ?? { views: 0, clicks: 0 };
            return html`<tr key=${b.id}><td><div class="row gap"><${BannerArt} b=${b} small /><strong>${b.title}</strong></div></td><td><span class=${`bm-state ${STATE[b.state][1]}`}>${STATE[b.state][0]}</span></td><td class="r num">${num(x.views)}</td><td class="r num">${num(x.clicks)}</td><td class="r num">${pct(x.clicks, x.views)}</td></tr>`;
          })}
        </tbody></table>`;
    }}</${Loading}>
  </div>`;
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function BannerEditor({ banner, onClose, onSaved }) {
  const [b, setB] = useState(() => ({
    title: banner?.title ?? '',
    subtitle: banner?.subtitle ?? '',
    cta: banner?.cta ?? '',
    link: banner?.link ?? '',
    imageUrl: banner?.imageUrl ?? null,
    art: banner?.art ?? (banner ? null : READY_ART[0][0]),
    showText: banner?.showText ?? true,
    accent: banner?.accent ?? 'mor',
    startsAt: toLocal(banner?.startsAt),
    endsAt: toLocal(banner?.endsAt),
    enabled: banner?.enabled ?? false,
    audience: banner?.audience ?? 'all',
  }));
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (patch) => setB((x) => ({ ...x, ...patch }));
  const pick = (e) => {
    const f = e.target.files?.[0] ?? null;
    if (f && !IMAGE_TYPES.includes(f.type)) return showError(new Error('Görsel JPEG, PNG ya da WebP olmalı'));
    if (f && f.size > 5 * 1024 * 1024) return showError(new Error('Görsel en çok 5 MB olabilir'));
    setFile(f ? { f, url: URL.createObjectURL(f) } : null);
  };
  const preview = { ...b, imageUrl: file?.url ?? b.imageUrl, art: file ? null : b.art };
  const save = async () => {
    setBusy(true);
    try {
      let imageUrl = b.imageUrl;
      if (file) {
        const r = await fetch('/api/app/upload?kind=notice', { method: 'POST', headers: { 'content-type': file.f.type }, body: file.f });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error ?? `Görsel yüklenemedi (${r.status})`);
        imageUrl = j.url;
      }
      await post('/api/app/banners', {
        ...(banner ? { id: banner.id } : {}),
        title: b.title.trim(),
        subtitle: b.subtitle.trim(),
        cta: b.link ? b.cta.trim() : '',
        link: b.link || null,
        ...(file || b.imageUrl ? { imageUrl } : { imageUrl: null, art: b.art }),
        showText: b.showText,
        accent: b.accent,
        startsAt: fromLocal(b.startsAt),
        endsAt: fromLocal(b.endsAt),
        enabled: b.enabled,
        audience: b.audience,
      });
      onSaved(banner ? 'Banner güncellendi' : b.enabled ? 'Banner yayında' : 'Banner taslak olarak kaydedildi');
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  };
  const linkKnown = LINKS.some(([v]) => v === b.link);
  return html`<${Modal} title=${banner ? 'Bannerı düzenle' : 'Yeni banner'} wide onClose=${onClose}>
    <div class="bm-editor">
      <div class="bm-editor-preview">
        <${BannerArt} b=${preview} />
        <small class="muted">Önizleme: telefonda böyle görünür.</small>
      </div>
      <div class="form"><div class="grid2">
        <label class="field wide"><span>Başlık * (2–60; listede ve erişilebilirlikte görünür)</span><input value=${b.title} maxlength="60" onInput=${(e) => set({ title: e.target.value })} /></label>
        <label class="field wide"><span>Alt yazı (en çok 120)</span><input value=${b.subtitle} maxlength="120" onInput=${(e) => set({ subtitle: e.target.value })} /></label>
        <label class="field"><span>Bağlantı (dokununca açılır)</span><select value=${linkKnown ? b.link : '__custom'} onChange=${(e) => set({ link: e.target.value === '__custom' ? '/' : e.target.value })}>${LINKS.map(([v, l]) => html`<option value=${v}>${l}</option>`)}<option value="__custom">Başka bir yol…</option></select></label>
        <label class="field"><span>Düğme yazısı (en çok 24; bağlantı gerekir)</span><input value=${b.cta} maxlength="24" disabled=${!b.link} placeholder="ör. Hemen Katıl" onInput=${(e) => set({ cta: e.target.value })} /></label>
        ${!linkKnown && html`<label class="field wide"><span>Uygulama içi yol (ör. /oda/123456)</span><input class="num" value=${b.link} maxlength="120" onInput=${(e) => set({ link: e.target.value.trim() })} /></label>`}
        <div class="field wide"><span>Görsel</span>
          <div class="bm-art-pick">
            ${READY_ART.map(([k, l, url]) => html`<button type="button" class=${!file && !b.imageUrl && b.art === k ? 'on' : ''} title=${l} onClick=${() => (setFile(null), set({ art: k, imageUrl: null }))}><img src=${url} alt=${l} /></button>`)}
            ${b.imageUrl && !file && html`<button type="button" class="on" title="Yüklenmiş görsel"><img src=${b.imageUrl} alt="" /></button>`}
            <label class="bm-upload"><input type="file" accept="image/jpeg,image/png,image/webp" onChange=${pick} />${file ? '✓ Yeni görsel' : '⬆ Görsel yükle'}</label>
          </div>
          <small class="muted">Yatay görsel (yaklaşık 16:9 ya da 2:1), JPEG/PNG/WebP, en çok 5 MB. Kendi yazısı olan görselde “Yazıları göster”i kapatın.</small>
        </div>
        <div class="field"><span>Renk (düğme ve kenar)</span><div class="bm-swatches">${ACCENTS.map(([k, l, c]) => html`<button type="button" class=${b.accent === k ? 'on' : ''} title=${l} style=${`background:linear-gradient(135deg,${c[0]},${c[1]})`} onClick=${() => set({ accent: k })}></button>`)}</div></div>
        <div class="field"><span>Yazıları göster</span><label class="bm-switch"><input type="checkbox" checked=${b.showText} onChange=${(e) => set({ showText: e.target.checked })} /><span></span></label></div>
        <label class="field"><span>Başlangıç (boş: hemen)</span><input type="datetime-local" value=${b.startsAt} onInput=${(e) => set({ startsAt: e.target.value })} /></label>
        <label class="field"><span>Bitiş (boş: süresiz)</span><input type="datetime-local" value=${b.endsAt} onInput=${(e) => set({ endsAt: e.target.value })} /></label>
        <div class="field"><span>Kimlere</span><select value=${b.audience} onChange=${(e) => set({ audience: e.target.value })}>${AUDIENCES.map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select></div>
        <div class="field"><span>Yayında</span><label class="bm-switch"><input type="checkbox" checked=${b.enabled} onChange=${(e) => set({ enabled: e.target.checked })} /><span></span></label></div>
      </div></div>
    </div>
    <div class="row gap end"><${Button} onClick=${onClose}>Vazgeç</${Button}><${Button} kind="primary" disabled=${busy || b.title.trim().length < 2} onClick=${save}>${busy ? 'Kaydediliyor…' : banner ? 'Kaydet' : b.enabled ? 'Yayınla' : 'Taslak kaydet'}</${Button}></div>
  </${Modal}>`;
}
