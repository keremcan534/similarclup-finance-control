// Uygulama › operations pages: the Similar Club app's moderation and community work, through its admin API
// (server/app-admin.ts passes each call on as the signed-in panel user; the app checks and records every one).
// Kullanıcılar (with a person's profile marks: Kaka and the like, taken off with a reason; and their profile voice clip,
// listened to and taken off with a reason), Şikâyetler (with a reported room's own pictures, and a reported person's
// profile marks and voice clip), Destek, Duyurular, Etkinlikler. The full sanction
// system (evidence, approvals, appeals, staff permissions) is Uygulama › Yaptırımlar (app-sanctions.js).
import { Badge, Button, Card, ID_HINT, Kpi, Loading, Modal, Page, Table, Tabs, accountOf, act, dateTimeTr, html, num, post, showError, toast, useApi, useApp, usePrompt, useState } from '../lib.js';
import { Chips } from './app-finance.js';

/** The app's ban lengths (admin-format.ts BAN_OPTIONS); 'Süresiz' is a lifetime ban. */
const PERMANENT = 3650;
const BAN_OPTIONS = [
  ['1', '1 gün'],
  ['3', '3 gün'],
  ['7', '7 gün'],
  ['30', '30 gün'],
  [String(PERMANENT), 'Süresiz'],
];
const banBody = (days) => (days >= PERMANENT ? { days: PERMANENT, permanent: true } : { days });
const banText = (days) => (days >= PERMANENT ? 'süresiz' : `${days} gün`);
/** What a ban is for (the app's sanction_reasons, 014_sanctions.sql). */
const BAN_REASONS = [
  ['other', 'Diğer'],
  ['insult', 'Hakaret ve küfür'],
  ['threat', 'Tehdit'],
  ['harassment', 'Taciz'],
  ['spam', 'Spam'],
  ['fraud', 'Dolandırıcılık girişimi'],
  ['advertising', 'Reklam ve izinsiz tanıtım'],
  ['fake_account', 'Sahte hesap'],
  ['impersonation', 'Başka kullanıcıyı taklit etme'],
  ['inappropriate', 'Uygunsuz içerik'],
  ['hate', 'Nefret söylemi'],
  ['disruption', 'Oda düzenini bozma'],
  ['ban_evasion', 'Ban aşma girişimi'],
  ['security', 'Güvenlik ihlali'],
];
const STAFF = (role) => role === 'admin' || role === 'moderator';
/** A picture from the app (its address already points through this server), opened full size on a click. */
const Pic = ({ src, size = 64 }) => src && html`<a href=${src} target="_blank" rel="noopener"><img src=${src} alt="" style=${`width:${size}px;height:${size}px;object-fit:cover;border-radius:8px;border:1px solid var(--border)`} /></a>`;
const cut = (s, n = 140) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : (s ?? ''));

// ---- Kullanıcılar ---------------------------------------------------------------------------------------
const SIGN_IN = { google: 'Google', email: 'E-posta', phone: 'Telefon', apple: 'Apple' };
const ROLE = { admin: 'Yönetici', moderator: 'Moderatör', coins_bank: 'Jeton bankası', user: 'Üye' };
const ROOM_LEVELS = Array.from({ length: 15 }, (_, i) => [String(i + 1), `Lv.${i + 1}`]);

export function AppUsers() {
  const { can } = useApp();
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const list = useApi(`/api/app/users?${new URLSearchParams({ ...(search ? { q: search } : {}), ...(offset ? { offset: String(offset) } : {}) })}`);
  const [ask, prompt] = usePrompt();
  const after = (text) => (r) => r && (toast(typeof text === 'function' ? text(r) : text), list.reload());
  const ban = async (u) => {
    const v = await ask(`${u.name} askıya alınsın`, {
      text: 'Süre bitince hesap kendiliğinden açılır. Askıdaki kişi uygulamayı kullanamaz.',
      fields: [
        { name: 'days', label: 'Süre', type: 'select', options: BAN_OPTIONS, required: true, def: '7' },
        { name: 'reason', label: 'Neden', type: 'select', options: BAN_REASONS, required: true, def: 'other' },
      ],
      ok: 'Askıya al',
    });
    if (v) after((r) => `${u.name} ${banText(Number(v.days))} askıya alındı${r.bannedUntil ? ` (${dateTimeTr(r.bannedUntil)} tarihine kadar)` : ''}`)(await act(() => post('/api/app/ban', { user: u.id, ...banBody(Number(v.days)), reason: v.reason })));
  };
  const unban = async (u) => confirm(`${u.name} askıdaysa askısı kaldırılır ve hemen yeniden giriş yapabilir.`) && after('Askı kaldırıldı')(await act(() => post('/api/app/ban', { user: u.id, days: null })));
  const level = async (u) => {
    const v = await ask(`${u.name}: oda seviyesi`, {
      text: 'Kişinin odası bu seviyeye geçer (seviyenin başlangıç puanıyla); açık odasındakiler hemen görür.',
      fields: [{ name: 'level', label: 'Seviye', type: 'select', options: ROOM_LEVELS, required: true, def: String(u.roomLevel ?? 1) }],
      ok: 'Kaydet',
    });
    if (v) after((r) => `Oda seviyesi Lv.${r.level}`)(await act(() => post('/api/app/users/room-level', { id: u.id, level: Number(v.level) })));
  };
  const revoke = async (u) => {
    const v = await ask('Davet ödülünü geri al', {
      text: `${u.name} ve onu davet eden kişiden davet jetonlarının harcanmamış kısmı geri alınır (sahte hesapla kazanılan ödül için).`,
      fields: [{ name: 'reason', label: 'Neden', type: 'text', required: true, def: 'Sahte hesap', wide: true }],
      ok: 'Geri al',
    });
    if (v) after((r) => `Geri alındı: davet eden ${num(r.coins.inviter)}, davet edilen ${num(r.coins.invitee)} jeton`)(await act(() => post('/api/app/referrals/revoke', { invitee: u.id, reason: v.reason })));
  };
  const remove = async (u) =>
    confirm(`${u.name}\n\nProfil, mesajlar, takipler ve oturumlar silinir; kişi çıkış yapar. Para kayıtları yasal olarak saklanır. Bu işlem geri alınamaz.`) &&
    after('Hesap silindi')(await act(() => post('/api/app/users/delete', { id: u.id })));
  const [marks, setMarks] = useState(null);
  const [voice, setVoice] = useState(null);
  const [privateAlbum, setPrivateAlbum] = useState(null);
  const removeTests = async (n) =>
    confirm(`Sunucu denemesinin açtığı ${n} hesap ("Test A", "Test B") silinir. Gerçek kişilere dokunulmaz. Bu işlem geri alınamaz.`) &&
    after((r) => `${num(r.deleted)} deneme hesabı silindi`)(await act(() => post('/api/app/users/delete', { tests: true })));
  const d = list.data;
  return html`<${Page}
    title="Kullanıcılar"
    subtitle="Uygulamanın hesapları: ad, kullanıcı adı, e-posta ya da ID ile arama (kişinin profilindeki ID, odasının ID'si de aynı; özel ID ve eski 8 haneli oda ID'si de bulunur); askıya alma, oda seviyesi, davet ödülünü geri alma, hesap silme; profil izleri (Kaka gibi): kim bıraktı, ne zaman, kaldırma; ses tanıtımı: dinleme, kaldırma; özel albüm: fotoğraflar, kaç kişi açtı, kaldırma. Yetkili hesapları (yönetici, moderatör) buradan değiştirilemez."
    actions=${can('app.users') && d?.tests > 0 && html`<${Button} kind="danger" onClick=${() => removeTests(d.tests)}>Deneme hesaplarını sil (${num(d.tests)})</${Button}>`}
  >
    ${prompt}
    <form class="row gap" style="margin-bottom:10px" onSubmit=${(e) => (e.preventDefault(), setOffset(0), setSearch(text.trim()))}>
      <input value=${text} onInput=${(e) => setText(e.target.value)} placeholder="Ad, kullanıcı adı, e-posta ya da ID" title=${ID_HINT} style="min-width:360px" />
      <button class="btn" type="submit">Ara</button>
      ${search && html`<${Button} kind="ghost" onClick=${() => (setText(''), setSearch(''), setOffset(0))}>Temizle</${Button}>`}
    </form>
    <${Loading} state=${list}>${(x) => html`
      <p class="muted">${num(x.total)} hesap${x.total ? ` · ${num(offset + 1)}–${num(offset + x.users.length)} gösteriliyor` : ''}</p>
      <${Table}
        empty=${search ? 'Bu aramayla kimse bulunamadı' : 'Henüz kayıtlı hesap yok'}
        columns=${[
          { key: 'name', label: 'Kişi', render: (u) => html`<strong>${u.name}</strong>${u.username ? html` <span class="muted">@${u.username}</span>` : ''}${u.test ? html` <${Badge} s="warning" label="Deneme" />` : ''}<br /><small class="muted num">${u.publicNo ? `ID ${u.publicNo}` : '—'}</small>` },
          { key: 'role', label: 'Rol', render: (u) => (STAFF(u.role) ? html`<${Badge} s="info" label=${ROLE[u.role]} />` : ROLE[u.role] ?? u.role) },
          { key: 'signIn', label: 'Giriş', render: (u) => u.signIn.map((p) => SIGN_IN[p] ?? p).join(', ') || 'Cihaz (deneme girişi)' },
          { key: 'room', label: 'Oda', render: (u) => (u.room ? html`<span class="num">${u.room.code}</span> · Lv.${u.roomLevel}` : `Lv.${u.roomLevel ?? 1}`) },
          { key: 'createdAt', label: 'Kayıt', render: (u) => dateTimeTr(u.createdAt) },
          {
            key: 'a',
            label: '',
            render: (u) =>
              can('app.users') &&
              html`<span class="row gap wrap">
                ${!STAFF(u.role) && html`<${Button} kind="danger" onClick=${() => ban(u)}>Askıya al</${Button}>
                <${Button} onClick=${() => unban(u)}>Askıyı kaldır</${Button}>
                <${Button} onClick=${() => level(u)}>Oda seviyesi</${Button}>`}
                <${Button} onClick=${() => setMarks(u)}>Profil izleri</${Button}>
                <${Button} onClick=${() => setVoice(u)}>Ses tanıtımı</${Button}>
                <${Button} onClick=${() => setPrivateAlbum(u)}>Özel albüm</${Button}>
                ${!STAFF(u.role) && html`<${Button} kind="ghost" onClick=${() => revoke(u)}>Davet ödülü</${Button}>
                <${Button} kind="ghost" onClick=${() => remove(u)}>Sil</${Button}>`}
              </span>`,
          },
        ]}
        rows=${x.users}
      />
      <div class="row gap end">
        ${offset > 0 && html`<${Button} onClick=${() => setOffset(Math.max(0, offset - 50))}>Önceki</${Button}>`}
        ${x.next !== null && html`<${Button} onClick=${() => setOffset(x.next)}>Sonraki</${Button}>`}
      </div>`}</${Loading}>
    ${marks && html`<${ProfileMarks} user=${marks} onClose=${() => setMarks(null)} />`}
    ${voice && html`<${ProfileVoice} user=${voice} onClose=${() => setVoice(null)} />`}
    ${privateAlbum && html`<${PrivateAlbum} user=${privateAlbum} onClose=${() => setPrivateAlbum(null)} />`}
  </${Page}>`;
}

// ---- Özel albüm -----------------------------------------------------------------------------------------
/**
 * A streamer's Özel albüm (the app's private-album.mjs: photos others open with coins, the price in Canlı ayarlar ›
 * Özel albüm): every photo, taken-down ones too, how many opened it and the coins they paid. A photo comes down with a
 * reason; it stops showing to everyone, even those who opened the album, and stays here as the record. The app's
 * audit log records it.
 */
export function PrivateAlbum({ user, onClose }) {
  const { can } = useApp();
  const data = useApi(`/api/app/private-album?user=${encodeURIComponent(user.id)}`);
  const [ask, prompt] = usePrompt();
  const take = async (p) => {
    const v = await ask('Fotoğrafı kaldır', {
      text: `${user.name ?? 'Kişi'}: bu fotoğraf özel albümden hemen kalkar; albümü açmış olanlar da görmez. Kayıt için burada kalır. Kaldırma uygulamanın denetim kaydına yazılır.`,
      fields: [{ name: 'reason', label: 'Neden (isteğe bağlı, en çok 200 karakter; ör. şikâyet: uygunsuz)', type: 'textarea', wide: true }],
      ok: 'Fotoğrafı kaldır',
    });
    if (!v) return;
    const r = await act(() => post('/api/app/private-album/remove', { user: user.id, id: p.id, ...(v.reason.trim() ? { reason: v.reason.trim().slice(0, 200) } : {}) }));
    if (r) {
      toast(r.removed ? 'Fotoğraf kaldırıldı' : 'Fotoğraf zaten kaldırılmıştı');
      data.reload();
    }
  };
  return html`<${Modal} title=${`Özel albüm: ${user.name ?? ''}`} wide onClose=${onClose}>
    ${prompt}
    <${Loading} state=${data}>${(d) => html`
      <p class="muted">${d.can ? 'Ajanstaki onaylı yayıncı: özel albümü açık.' : 'Şu an ajansta onaylı yayıncı değil: albümü satılmıyor (önceden açanlar görmeye devam eder).'} Fiyat (herkese aynı): ${d.price > 0 ? `${num(d.price)} jeton` : 'kapalı (0)'} · Canlı ayarlar › Özel albüm. ${num(d.unlocks)} kişi açtı, toplam ${num(d.coins)} jeton.</p>
      <${Table} dense empty="Bu kişinin özel albümünde fotoğraf yok" columns=${[
        { key: 'url', label: 'Fotoğraf', render: (p) => html`<${Pic} src=${p.url} size=${72} />` },
        { key: 'at', label: 'Eklendi', render: (p) => dateTimeTr(p.at) },
        { key: 'state', label: 'Durum', render: (p) => (p.removed ? html`<${Badge} s="closed" label="Kaldırıldı" /><br /><small class="muted">${dateTimeTr(p.removed.at)}${p.removed.by ? ` · ${p.removed.by}` : ''}${p.removed.reason ? ` · ${p.removed.reason}` : ''}</small>` : html`<${Badge} s="pending" label="Görünüyor" />`) },
        { key: 'a', label: '', render: (p) => can('app.users') && !p.removed && html`<${Button} kind="danger" onClick=${() => take(p)}>Kaldır</${Button}>` },
      ]} rows=${d.photos} />`}</${Loading}>
  </${Modal}>`;
}

// ---- Ses tanıtımı ---------------------------------------------------------------------------------------
/**
 * A person's profile voice clip (the app's voice-intro.mjs: up to 15 seconds, anyone who opens their profile plays
 * it): listened to here, and taken off with a reason (its file is deleted; the app's audit log records it). The person
 * can record a new one afterwards.
 */
export function ProfileVoice({ user, onClose }) {
  const { can } = useApp();
  const clip = useApi(`/api/app/voice?user=${encodeURIComponent(user.id)}`);
  const [ask, prompt] = usePrompt();
  const clear = async () => {
    const v = await ask('Ses tanıtımı kaldırılsın', {
      text: `${user.name ?? 'Kişi'}: profilindeki ses kaydı hemen kalkar ve dosyası silinir; kişi isterse yenisini kaydeder. Kaldırma uygulamanın denetim kaydına yazılır.`,
      fields: [{ name: 'reason', label: 'Neden (isteğe bağlı, en çok 200 karakter; ör. şikâyet: hakaret)', type: 'textarea', wide: true }],
      ok: 'Ses kaydını kaldır',
    });
    if (!v) return;
    const r = await act(() => post('/api/app/voice/clear', { user: user.id, ...(v.reason.trim() ? { reason: v.reason.trim().slice(0, 200) } : {}) }));
    if (r) {
      toast(r.cleared ? 'Ses tanıtımı kaldırıldı' : 'Kaldırılacak ses kaydı yoktu');
      clip.reload();
    }
  };
  return html`<${Modal} title=${`Ses tanıtımı: ${user.name ?? ''}`} onClose=${onClose}>
    ${prompt}
    <${Loading} state=${clip}>${(d) =>
      d.voice
        ? html`<p class="muted">${num(Math.round(d.voice.ms / 1000))} saniye · ${dateTimeTr(d.voice.at)} kaydedildi. Profiline bakan herkes dinleyebilir.</p>
            <audio controls preload="none" src=${d.voice.url} style="width:100%;margin:8px 0 12px"></audio>
            ${can('app.users') && html`<div class="row gap end"><${Button} kind="danger" onClick=${clear}>Ses kaydını kaldır</${Button}></div>`}`
        : html`<p class="muted">Bu kişinin profilinde ses tanıtımı yok.</p>`}</${Loading}>
  </${Modal}>`;
}

// ---- Profil izleri --------------------------------------------------------------------------------------
/**
 * How a mark came off (the app's profile_marks.cleared_how): 'replaced' a newer mark of the same kind took its place
 * (the kind's "Aynı iz yeniden gelince" set to replace; another kind never takes a mark's place: its gift goes as a
 * plain gift); 'self' only on old rows (nobody takes their own mark off since then).
 */
const CLEARED = { gift: 'temizleyen hediyeyle', admin: 'yönetim kaldırdı', replaced: 'aynı türden yeni iz yerine geçti', self: 'kişi kapattı (eski)', block: 'engelle kalktı' };
const markState = (m) =>
  m.showing
    ? html`<${Badge} s="pending" label="Görünüyor" />`
    : m.cleared
      ? html`<${Badge} s="closed" label=${`Kalktı · ${CLEARED[m.cleared] ?? m.cleared}`} />${m.clearedAt ? html`<br /><small class="muted">${dateTimeTr(m.clearedAt)}${m.clearedBy?.name ? ` · ${m.clearedBy.name}` : ''}</small>` : ''}`
      : html`<${Badge} s="ended" label="Süresi bitti" />`;

/**
 * A person's profile marks (the app's last 50, the ones showing first): who left each, until when, how it came off.
 * The ones showing come off (all, or one kind) with a reason, written to the app's audit log; the rooms the person is
 * in see their photo clean at once.
 */
export function ProfileMarks({ user, onClose }) {
  const { can } = useApp();
  const list = useApi(`/api/app/marks?user=${encodeURIComponent(user.id)}`);
  const [ask, prompt] = usePrompt();
  const clear = async (kind) => {
    const v = await ask(kind ? `“${kind}” izi kaldırılsın` : 'Görünen bütün izler kaldırılsın', {
      text: `${user.name ?? 'Kişi'}: profil fotoğrafındaki ${kind ? 'bu tür iz' : 'izler'} hemen kalkar; bulunduğu odalar da görür. Kaldırma uygulamanın denetim kaydına yazılır.`,
      fields: [{ name: 'reason', label: 'Neden (isteğe bağlı, en çok 200 karakter; ör. şikâyet)', type: 'textarea', wide: true }],
      ok: 'İzi kaldır',
    });
    if (!v) return;
    const r = await act(() => post('/api/app/marks/clear', { user: user.id, ...(kind ? { kind } : {}), ...(v.reason.trim() ? { reason: v.reason.trim().slice(0, 200) } : {}) }));
    if (r) {
      toast(r.cleared ? `${num(r.cleared)} iz kaldırıldı` : 'Kaldırılacak görünen iz yoktu');
      list.reload();
    }
  };
  return html`<${Modal} title=${`Profil izleri: ${user.name ?? ''}`} wide onClose=${onClose}>
    ${prompt}
    <${Loading} state=${list}>${(d) => {
      const showing = d.marks.filter((m) => m.showing);
      return html`
        ${!d.on && html`<p class="note warn">Profil izleri şu an kapalı (Canlı ayarlar › Profil izleri › süre 0): hiçbir iz görünmüyor.</p>`}
        <p class="muted">İz bırakan bir hediye (ör. 💩 Kaka Şakası) alıcının fotoğrafında süresi bitene, temizleyen hediye (ör. 💧 Temizlik Suyu) gelene ya da buradan kaldırılana kadar kalır; profilde aynı anda tek iz olur. Kişi kendi izini kaldıramaz: Gizlilik'ten yalnız kimlerin yeni iz bırakabileceğini seçer. İz bırakanı engellerse o kişinin izleri kalkar. Son 50 iz, görünenler önce.</p>
        ${can('app.users') && showing.length > 0 && html`<div class="row gap wrap" style="margin-bottom:10px">
          <${Button} kind="danger" onClick=${() => clear(null)}>Görünen bütün izleri kaldır (${num(showing.length)})</${Button}>
        </div>`}
        <${Table} dense empty="Bu kişinin profilinde hiç iz olmadı" columns=${[
          { key: 'kind', label: 'İz', render: (m) => html`<strong>${m.giftName}</strong><br /><small class="muted">${m.kind}</small>` },
          { key: 'from', label: 'Bırakan', render: (m) => m.from?.name ?? '—' },
          { key: 'at', label: 'Ne zaman', render: (m) => dateTimeTr(m.at) },
          { key: 'until', label: 'Bitiş', render: (m) => dateTimeTr(m.until) },
          { key: 'state', label: 'Durum', render: markState },
          { key: 'a', label: '', render: (m) => can('app.users') && m.showing && html`<${Button} onClick=${() => clear(m.kind)}>İzi kaldır</${Button}>` },
        ]} rows=${d.marks} />`;
    }}</${Loading}>
  </${Modal}>`;
}

// ---- Şikâyetler -----------------------------------------------------------------------------------------
const R_STATUS = [
  ['open', 'Açık'],
  ['actioned', 'İşlem yapıldı'],
  ['dismissed', 'Sorun yok'],
];
const R_BADGE = { open: ['pending', 'Açık'], actioned: ['resolved', 'İşlem yapıldı'], dismissed: ['closed', 'Sorun yok'] };
const TARGET = { user: 'Kişi', room: 'Oda', message: 'Mesaj', moment: 'An', comment: 'Yorum', family: 'Aile' };
const targetName = (r) => r.target.name ?? ({ message: 'Bir mesaj', moment: 'Bir an', comment: 'Bir yorum' }[r.target.type] ?? 'Artık yok');

export function AppComplaints() {
  const { can } = useApp();
  const [status, setStatus] = useState('open');
  const list = useApi(`/api/app/reports?status=${status}`);
  const [room, setRoom] = useState(null);
  const [marks, setMarks] = useState(null);
  const [voice, setVoice] = useState(null);
  const [privateAlbum, setPrivateAlbum] = useState(null);
  const [ask, prompt] = usePrompt();
  const handle = async (r, body, text) => (await act(() => post('/api/app/reports/handle', { id: r.id, ...body }))) && (toast(text), list.reload());
  const dismiss = (r) => confirm('Şikâyet işlem yapılmadan kapatılır.') && handle(r, { status: 'dismissed' }, 'Şikâyet kapatıldı');
  const actioned = (r) => confirm(`“${r.reason}” şikâyeti işlem yapıldı olarak kapatılır. Kimse askıya alınmaz.`) && handle(r, { status: 'actioned' }, 'Şikâyet kapatıldı');
  const removeContent = (r) => {
    const what = r.target.type === 'comment' ? 'yorum' : 'an';
    confirm(`Bu ${what} herkesten kaldırılır ve şikâyet “işlem yapıldı” olarak kapanır.`) && handle(r, { status: 'actioned', remove: true }, `${what === 'an' ? 'An' : 'Yorum'} kaldırıldı`);
  };
  const ban = async (r) => {
    const v = await ask(`${targetName(r)} askıya alınsın`, {
      text: 'Süre bitince hesap kendiliğinden açılır. Şikâyet de işlem yapıldı olarak kapanır; neden şikâyetin konusundan gelir.',
      fields: [{ name: 'days', label: 'Süre', type: 'select', options: BAN_OPTIONS, required: true, def: '7' }],
      ok: 'Askıya al',
    });
    if (v) handle(r, { status: 'actioned', ...(Number(v.days) >= PERMANENT ? { permanent: true } : { banDays: Number(v.days) }) }, `${targetName(r)} ${banText(Number(v.days))} askıya alındı`);
  };
  const unban = async (r) =>
    confirm(`${targetName(r)} ${r.target.bannedForever ? 'için ömür boyu ban da kaldırılır ve ' : ''}hemen yeniden giriş yapabilir.`) &&
    (await act(() => post('/api/app/ban', { user: r.target.id, days: null }))) &&
    (toast('Askı kaldırıldı'), list.reload());
  return html`<${Page} title="Şikâyetler" subtitle="Kullanıcıların kişi, oda, mesaj, an, yorum ve aile şikâyetleri: sorun yok, işlem yapıldı, askıya alma (kişide), içeriği kaldırma (an ve yorumda), şikâyet edilen odanın görselleri, şikâyet edilen kişinin profil izleri, ses tanıtımı ve özel albümü.">
    ${prompt}
    <${Chips} value=${status} options=${R_STATUS} onChange=${setStatus} />
    <${Loading} state=${list}>${(d) => html`<${Table}
      empty=${status === 'open' ? 'Açık şikâyet yok' : 'Bu listede şikâyet yok'}
      columns=${[
        { key: 'createdAt', label: 'Tarih', render: (r) => html`${dateTimeTr(r.createdAt)}${r.handledAt ? html`<br /><small class="muted">kapandı ${dateTimeTr(r.handledAt)}</small>` : ''}` },
        { key: 'reporter', label: 'Şikâyet eden', render: (r) => r.reporter.name },
        {
          key: 'target',
          label: 'Şikâyet edilen',
          render: (r) => html`<small class="muted">${TARGET[r.target.type] ?? r.target.type}</small><br /><strong>${targetName(r)}</strong>
            ${r.target.staff ? html` <${Badge} s="info" label="Yetkili" />` : ''}
            ${r.target.bannedForever ? html` <${Badge} s="rejected" label="Ömür boyu askıda" />` : r.target.bannedUntil ? html` <${Badge} s="rejected" label=${`Askıda · ${dateTimeTr(r.target.bannedUntil)}`} />` : ''}
            ${r.reportsOnTarget > 1 ? html`<br /><small class="muted">${num(r.reportsOnTarget)} şikâyet</small>` : ''}`,
        },
        { key: 'reason', label: 'Konu', render: (r) => html`<strong>${r.reason}</strong>${r.note ? html`<br /><small>${cut(r.note, 200)}</small>` : ''}` },
        {
          key: 'content',
          label: 'İçerik',
          render: (r) =>
            r.target.content
              ? html`<div class="row gap" style="align-items:flex-start"><${Pic} src=${r.target.content.imageUrl} size=${56} /><div><small class="muted">${r.target.content.author.name}</small><br />${cut(r.target.content.text, 160)}${r.target.content.removed ? html` <${Badge} s="cancelled" label="Kaldırıldı" />` : ''}</div></div>`
              : '—',
        },
        { key: 'status', label: 'Durum', render: (r) => html`<${Badge} s=${R_BADGE[r.status][0]} label=${R_BADGE[r.status][1]} />` },
        {
          key: 'a',
          label: '',
          render: (r) =>
            can('app.complaints') &&
            html`<span class="row gap wrap">
              ${r.status === 'open' && html`<${Button} onClick=${() => dismiss(r)}>Sorun yok</${Button}><${Button} onClick=${() => actioned(r)}>İşlem yapıldı</${Button}>`}
              ${r.status === 'open' && r.target.type === 'user' && !r.target.staff && html`<${Button} kind="danger" onClick=${() => ban(r)}>Askıya al</${Button}>`}
              ${r.status === 'open' && r.target.content && !r.target.content.removed && html`<${Button} kind="danger" onClick=${() => removeContent(r)}>${r.target.type === 'comment' ? 'Yorumu kaldır' : 'Anı kaldır'}</${Button}>`}
              ${r.target.type === 'room' && html`<${Button} kind="ghost" onClick=${() => setRoom(r.target.id)}>Oda görselleri</${Button}>`}
              ${r.target.type === 'user' && (r.target.bannedUntil || r.target.bannedForever) && can('app.users') && html`<${Button} kind="ghost" onClick=${() => unban(r)}>Askıyı kaldır</${Button}>`}
              ${r.target.type === 'user' && r.target.id && can('app.users') && html`<${Button} kind="ghost" onClick=${() => setMarks({ id: r.target.id, name: targetName(r) })}>Profil izleri</${Button}>`}
              ${r.target.type === 'user' && r.target.id && can('app.users') && html`<${Button} kind="ghost" onClick=${() => setVoice({ id: r.target.id, name: targetName(r) })}>Ses tanıtımı</${Button}>`}
              ${r.target.type === 'user' && r.target.id && can('app.users') && html`<${Button} kind="ghost" onClick=${() => setPrivateAlbum({ id: r.target.id, name: targetName(r) })}>Özel albüm</${Button}>`}
            </span>`,
        },
      ]}
      rows=${d.reports}
    />`}</${Loading}>
    ${room && html`<${RoomPictures} room=${room} onClose=${() => setRoom(null)} />`}
    ${marks && html`<${ProfileMarks} user=${marks} onClose=${() => setMarks(null)} />`}
    ${voice && html`<${ProfileVoice} user=${voice} onClose=${() => setVoice(null)} />`}
    ${privateAlbum && html`<${PrivateAlbum} user=${privateAlbum} onClose=${() => setPrivateAlbum(null)} />`}
  </${Page}>`;
}

/** A reported room's own pictures: its paid background and its cover; either can be taken down with a reason. */
function RoomPictures({ room, onClose }) {
  const { can } = useApp();
  const pics = useApi(`/api/app/rooms/background?room=${encodeURIComponent(room)}`);
  const [ask, prompt] = usePrompt();
  const take = async (which) => {
    const v = await ask(which === 'background' ? 'Süslemeyi kaldır' : 'Kapağı kaldır', {
      text:
        which === 'background'
          ? 'Görsel silinir, oda ücretsiz süslemesine döner ve oda sahibinin süresi biter. Jeton iadesi yapılmaz.'
          : 'Kapak silinir; listelerde odanın önceki resmi görünür. Oda sahibi yeni bir kapak yükleyebilir.',
      label: 'Neden (oda sahibinin kaydına yazılır)',
      ok: 'Kaldır',
    });
    if (v && (await act(() => post(`/api/app/rooms/${which === 'background' ? 'background' : 'cover'}/remove`, { room, reason: v.reason })))) {
      toast(which === 'background' ? 'Özel süsleme kaldırıldı' : 'Oda kapağı kaldırıldı');
      pics.reload();
    }
  };
  return html`<${Modal} title="Oda görselleri" onClose=${onClose}>
    ${prompt}
    <${Loading} state=${pics}>${(p) => html`
      <p><strong>${p.room.title}</strong> · sahibi ${p.owner.name}</p>
      <div class="grid cols2">
        <${Card} title="Özel süsleme" actions=${can('app.complaints') && p.url && html`<${Button} kind="danger" onClick=${() => take('background')}>Kaldır</${Button}>`}>
          ${p.url ? html`<${Pic} src=${p.url} size=${220} /><p class="muted">${p.shown ? 'Odada görünüyor' : 'Yüklü, odada görünmüyor'}${p.until ? ` · ${dateTimeTr(p.until)} tarihine kadar` : ''}</p>` : html`<p class="muted">Yüklenmiş süsleme yok</p>`}
        </${Card}>
        <${Card} title="Kapak" actions=${can('app.complaints') && p.coverUrl && html`<${Button} kind="danger" onClick=${() => take('cover')}>Kaldır</${Button}>`}>
          ${p.coverUrl ? html`<${Pic} src=${p.coverUrl} size=${220} />` : html`<p class="muted">Yüklenmiş kapak yok</p>`}
        </${Card}>
      </div>`}</${Loading}>
  </${Modal}>`;
}

// ---- Destek ---------------------------------------------------------------------------------------------
const T_STATUS = [
  ['waiting', 'Bekleyen'],
  ['answered', 'Yanıtlandı'],
  ['closed', 'Kapalı'],
];
const T_BADGE = { open: ['pending', 'Açık'], reopened: ['pending', 'Yeniden açıldı'], answered: ['acknowledged', 'Yanıtlandı'], closed: ['resolved', 'Çözüldü'] };
const ticketTitle = (t) => `${t.number} · ${t.feedback ? 'Geri bildirim' : t.category}`;

export function AppSupport() {
  const [status, setStatus] = useState('waiting');
  const list = useApi(`/api/app/support?status=${status}`);
  const [open, setOpen] = useState(null);
  return html`<${Page} title="Destek" subtitle="Kullanıcıların Destek'ten açtığı talepler: yazışma, fotoğraflar, yanıt (kişiye bildirim gider), kapatma ve yeniden açma. Kişi yanıtı “Destek” adıyla görür.">
    <${Chips} value=${status} options=${T_STATUS.map(([k, l]) => [k, k === 'waiting' && list.data?.waiting ? `${l} (${list.data.waiting})` : l])} onChange=${setStatus} />
    <${Loading} state=${list}>${(d) => html`<${Table}
      empty=${status === 'waiting' ? 'Bekleyen talep yok' : 'Bu listede talep yok'}
      onRow=${(t) => setOpen(t.id)}
      columns=${[
        { key: 'number', label: 'Talep', render: (t) => html`<strong>${ticketTitle(t)}</strong><br /><small class="muted">${dateTimeTr(t.createdAt)}</small>` },
        { key: 'user', label: 'Kişi', render: (t) => html`${t.user.name}${t.user.username ? html` <span class="muted">@${t.user.username}</span>` : ''}` },
        { key: 'last', label: 'Son yazılan', render: (t) => (t.last ? html`<small class="muted">${t.last.from === 'support' ? 'Destek' : 'Kişi'}</small><br />${cut(t.last.text)}` : cut(t.text)) },
        { key: 'lines', label: 'Mesaj', align: 'right', render: (t) => num(t.lines + 1) },
        { key: 'updatedAt', label: 'Güncellendi', render: (t) => dateTimeTr(t.updatedAt) },
        { key: 'status', label: 'Durum', render: (t) => html`<${Badge} s=${T_BADGE[t.status]?.[0]} label=${T_BADGE[t.status]?.[1] ?? t.status} />` },
      ]}
      rows=${d.tickets}
    />`}</${Loading}>
    ${open && html`<${Ticket} id=${open} onClose=${() => setOpen(null)} onChanged=${() => list.reload()} />`}
  </${Page}>`;
}

function Ticket({ id, onClose, onChanged }) {
  const { can } = useApp();
  const t = useApi(`/api/app/support/ticket?id=${encodeURIComponent(id)}`);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn, ok) => {
    setBusy(true);
    try {
      await fn();
      toast(ok);
      setText('');
      t.reload();
      onChanged();
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  };
  const reply = (close) => (text.trim() ? run(() => post('/api/app/support/reply', { id, text: text.trim(), close }), close ? 'Yanıt gönderildi, talep kapandı' : 'Yanıt gönderildi') : showError(new Error('Kişiye gidecek yanıtı yazın')));
  const status = (s, ok) => run(() => post('/api/app/support/status', { id, status: s }), ok);
  return html`<${Modal} title=${t.data ? ticketTitle(t.data.ticket) : 'Destek talebi'} wide onClose=${onClose}>
    <${Loading} state=${t}>${({ ticket: k }) => html`
      <p>
        <strong>${k.user.name}</strong>${k.user.username ? html` <span class="muted">@${k.user.username}</span>` : ''} · üye ${dateTimeTr(k.user.since)} ·
        <${Badge} s=${T_BADGE[k.status]?.[0]} label=${T_BADGE[k.status]?.[1] ?? k.status} />${k.closedBy ? html` <small class="muted">kapatan ${k.closedBy}</small>` : ''}
      </p>
      <div class="stack">
        <${Card} title=${`${dateTimeTr(k.createdAt)} · talep`}>
          <p style="white-space:pre-wrap">${k.text}</p>
          ${k.photos?.length > 0 && html`<div class="row gap wrap">${k.photos.map((p) => html`<${Pic} src=${p} size=${120} />`)}</div>`}
        </${Card}>
        ${k.messages.map(
          (m) => html`<${Card} title=${`${dateTimeTr(m.createdAt)} · ${m.from === 'support' ? `Destek${m.by ? ` (${m.by.name})` : ''}` : k.user.name}`} class=${m.from === 'support' ? 'support-line' : ''}>
            <p style="white-space:pre-wrap">${m.text}</p>
          </${Card}>`,
        )}
      </div>
      ${can('app.support') &&
      html`<div class="form" style="margin-top:12px">
        <label class="field"><span>Yanıt (kişiye “Destek” adıyla gider, en çok 2000 karakter)</span><textarea rows="4" maxlength="2000" value=${text} onInput=${(e) => setText(e.target.value)}></textarea></label>
        <div class="row gap end">
          ${k.status === 'closed'
            ? html`<${Button} disabled=${busy} onClick=${() => status('open', 'Talep yeniden açıldı')}>Yeniden aç</${Button}>`
            : html`<${Button} kind="ghost" disabled=${busy} onClick=${() => status('closed', 'Talep kapatıldı')}>Yanıtsız kapat</${Button}>`}
          <${Button} disabled=${busy} onClick=${() => reply(true)}>Yanıtla ve kapat</${Button}>
          <${Button} kind="primary" disabled=${busy} onClick=${() => reply(false)}>Yanıtla</${Button}>
        </div>
      </div>`}`}</${Loading}>
  </${Modal}>`;
}

// ---- Duyurular ------------------------------------------------------------------------------------------
const KINDS = [
  ['update', 'Güncelleme'],
  ['event', 'Etkinlik'],
  ['reward', 'Ödül'],
  ['rule', 'Kural'],
  ['notice', 'Duyuru'],
];
const KIND = Object.fromEntries(KINDS);
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function AppNotices() {
  const { can } = useApp();
  const list = useApi('/api/app/team');
  const [edit, setEdit] = useState(false);
  const remove = async (n) =>
    confirm(`“${n.title}” herkesin Similar Ekibi listesinden${n.banner ? ' ve oda bannerından' : ''} kalkar.`) &&
    (await act(() => post('/api/app/team/remove', { id: n.id }))) &&
    (toast('Duyuru kaldırıldı'), list.reload());
  return html`<${Page}
    title="Duyurular"
    subtitle="Uygulamadaki Similar Ekibi duyuruları: herkese ya da tek kişiye; isteğe bağlı görsel, uygulama içi bağlantı ve odalarda gösterilen banner (1–30 gün). Kişiye özel duyuruda kişiye bildirim gider."
    actions=${can('app.notices') && html`<${Button} kind="primary" onClick=${() => setEdit(true)}>Yeni duyuru</${Button}>`}
  >
    <${Loading} state=${list}>${(d) => html`<${Table}
      empty="Duyuru yok"
      columns=${[
        { key: 'createdAt', label: 'Tarih', render: (n) => html`${dateTimeTr(n.createdAt)}<br /><small class="muted">${n.by ?? ''}</small>` },
        { key: 'kind', label: 'Tür', render: (n) => KIND[n.kind] ?? n.kind },
        { key: 'title', label: 'Duyuru', render: (n) => html`<div class="row gap" style="align-items:flex-start"><${Pic} src=${n.imageUrl} size=${56} /><div><strong>${n.title}</strong>${n.body ? html`<br /><small>${cut(n.body, 200)}</small>` : ''}${n.link ? html`<br /><small class="muted num">${n.link}</small>` : ''}</div></div>` },
        { key: 'target', label: 'Kime', render: (n) => (n.target ? n.target.name : 'Herkes') },
        { key: 'banner', label: 'Banner', render: (n) => (n.banner ? (n.endsAt ? `${dateTimeTr(n.endsAt)} tarihine kadar` : 'Açık') : '—') },
        { key: 'a', label: '', render: (n) => can('app.notices') && html`<${Button} kind="danger" onClick=${() => remove(n)}>Kaldır</${Button}>` },
      ]}
      rows=${d.notices}
    />`}</${Loading}>
    ${edit && html`<${NoticeEditor} onClose=${() => setEdit(false)} onSaved=${() => (setEdit(false), toast('Duyuru yayında'), list.reload())} />`}
  </${Page}>`;
}

function NoticeEditor({ onClose, onSaved }) {
  const [n, setN] = useState({ kind: 'update', title: '', body: '', link: '', target: '', bannerDays: '0' });
  const [image, setImage] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (patch) => setN({ ...n, ...patch });
  const pick = (e) => {
    const file = e.target.files?.[0] ?? null;
    if (file && !IMAGE_TYPES.includes(file.type)) return showError(new Error('Görsel JPEG, PNG ya da WebP olmalı'));
    if (file && file.size > 5 * 1024 * 1024) return showError(new Error('Görsel en çok 5 MB olabilir'));
    setImage(file ? { file, preview: URL.createObjectURL(file) } : null);
  };
  const save = async () => {
    setBusy(true);
    try {
      // The person first: a mistyped ID stops here, before the picture is stored.
      const target = await accountOf(n.target);
      let imageUrl = null;
      if (image) {
        const r = await fetch('/api/app/upload?kind=notice', { method: 'POST', headers: { 'content-type': image.file.type }, body: image.file });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error ?? `Görsel yüklenemedi (${r.status})`);
        imageUrl = j.url;
      }
      const days = n.target.trim() ? 0 : Number(n.bannerDays) || 0;
      await post('/api/app/team', {
        kind: n.kind,
        title: n.title.trim(),
        body: n.body.trim(),
        ...(imageUrl ? { imageUrl } : {}),
        ...(n.link.trim() ? { link: n.link.trim() } : {}),
        ...(target ? { target } : {}),
        ...(days ? { bannerDays: days } : {}),
      });
      onSaved();
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  };
  return html`<${Modal} title="Yeni duyuru" onClose=${onClose}>
    <div class="form"><div class="grid2">
      <label class="field"><span>Tür</span><select value=${n.kind} onChange=${(e) => set({ kind: e.target.value })}>${KINDS.map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select></label>
      <label class="field"><span>Başlık * (2–80)</span><input value=${n.title} maxlength="80" onInput=${(e) => set({ title: e.target.value })} /></label>
      <label class="field wide"><span>Metin (en çok 1000)</span><textarea rows="4" maxlength="1000" value=${n.body} onInput=${(e) => set({ body: e.target.value })}></textarea></label>
      <label class="field"><span>Görsel (JPEG, PNG, WebP; en çok 5 MB)</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange=${pick} /></label>
      <div>${image && html`<img src=${image.preview} alt="" style="max-width:160px;max-height:120px;border-radius:8px" />`}</div>
      <label class="field"><span>Uygulama içi bağlantı (ör. /siralama)</span><input value=${n.link} maxlength="120" onInput=${(e) => set({ link: e.target.value })} /></label>
      <label class="field"><span>Tek kişiye (kişinin ID’si; boşsa herkese)</span><input value=${n.target} title=${ID_HINT} onInput=${(e) => set({ target: e.target.value })} /></label>
      <label class="field"><span>Odalarda banner (gün, 0: yok; kişiye özelde olmaz)</span><select value=${n.bannerDays} disabled=${!!n.target.trim()} onChange=${(e) => set({ bannerDays: e.target.value })}>${['0', '1', '3', '7', '14', '30'].map((x) => html`<option value=${x}>${x === '0' ? 'Yok' : `${x} gün`}</option>`)}</select></label>
    </div></div>
    <div class="row gap end"><${Button} onClick=${onClose}>Vazgeç</${Button}><${Button} kind="primary" disabled=${busy || n.title.trim().length < 2} onClick=${save}>${busy ? 'Yayınlanıyor…' : 'Yayınla'}</${Button}></div>
  </${Modal}>`;
}

// ---- Etkinlikler ----------------------------------------------------------------------------------------
const E_STATUS = [
  ['review', 'Başvurular'],
  ['upcoming', 'Yaklaşan'],
  ['live', 'Canlı'],
  ['ended', 'Biten'],
  ['rejected', 'Reddedilen'],
  ['cancelled', 'Kaldırılan'],
  ['all', 'Tümü'],
];
const E_BADGE = { review: 'pending', upcoming: 'approved', live: 'active', ended: 'ended', rejected: 'rejected', cancelled: 'cancelled', draft: 'draft' };
/** The app's event themes (server/api/event-rules.mjs THEMES); the app checks the choice. */
const THEMES = [
  ['sade', 'Sade'],
  ['ilk-selam', 'İlk Selam'],
  ['pasta', 'Pasta ve Mum'],
  ['sahne', 'Sahne Işığı'],
  ['yildiz', 'Yıldız Gecesi'],
  ['kupa', 'Kupa Gecesi'],
  ['iki-kalp', 'İki Kalp'],
  ['ocak', 'Ocak Başı'],
  ['altin-gala', 'Altın Gala'],
];
const END_TEXT = { owner: 'Düzenleyen bitirdi', time: 'Süresi doldu', room_closed: 'Oda kapandı', not_started: 'Zamanında başlatılmadı', admin: 'Yönetim sonlandırdı' };
const pct = (x) => (x === null || x === undefined ? '—' : `%${num(x * 100, 0)}`);

export function AppEvents() {
  const [tab, setTab] = useState('events');
  return html`<${Page} title="Etkinlikler" subtitle="Oda sahiplerinin etkinlik başvuruları (onay ya da gerekçeli ret), yayındaki etkinliği kaldırma, etkinlik türleri ve dönem raporu. Kararlar oda sahibine Similar Ekibi'nden ve bildirimle gider.">
    <${Tabs} tabs=${[['events', 'Etkinlikler'], ['categories', 'Türler'], ['report', 'Rapor']]} value=${tab} onChange=${setTab} />
    ${tab === 'events' && html`<${EventList} />`}
    ${tab === 'categories' && html`<${Categories} />`}
    ${tab === 'report' && html`<${EventReport} />`}
  </${Page}>`;
}

function EventList() {
  const { can } = useApp();
  const [status, setStatus] = useState('review');
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [skip, setSkip] = useState(0);
  const list = useApi(`/api/app/events?${new URLSearchParams({ status, ...(search ? { q: search } : {}), ...(skip ? { skip: String(skip) } : {}) })}`);
  const [ask, prompt] = usePrompt();
  const counts = list.data?.counts ?? {};
  const decide = async (e, approve) => {
    let body = { id: e.id, approve };
    if (approve) {
      if (!confirm(`“${e.title}” onaylanır ve Etkinlik Alanı'nda yayınlanır; oda sahibine bildirim gider.`)) return;
    } else {
      const v = await ask('Başvuruyu reddet', { text: 'Gerekçe oda sahibine gösterilir; düzenleyip yeniden gönderebilir.', label: 'Gerekçe (3–300)', ok: 'Reddet' });
      if (!v) return;
      body = { ...body, reason: v.reason };
    }
    if (await act(() => post('/api/app/events/review', body))) (toast(approve ? 'Etkinlik onaylandı' : 'Başvuru reddedildi'), list.reload());
  };
  const remove = async (e) => {
    const v = await ask('Etkinliği yayından kaldır', { text: `“${e.title}” ${e.state === 'live' ? 'hemen biter ve ' : ''}yayından kalkar; yer ayıranlara ve oda sahibine neden bildirilir.`, label: 'Neden (3–300)', ok: 'Kaldır' });
    if (v && (await act(() => post('/api/app/events/remove', { id: e.id, reason: v.reason })))) (toast('Etkinlik yayından kaldırıldı'), list.reload());
  };
  // A reward for everyone who comes (the app's events.mjs; docs/CANTA.md there): given when the event ends.
  const setReward = async (e, items) => {
    const shopDays = items.find((x) => x.sku === e.reward?.sku)?.days;
    const v = await ask(`Katılım ödülü: ${e.title}`, {
      text: 'Etkinlik bitince, etkinlik sürerken odaya giren herkes bu eşyayı Çantam’ında bulur (bir kez, ücretsiz). Yayından kaldırılan ya da hiç başlamayan etkinlik ödül vermez.',
      fields: [
        { name: 'sku', label: 'Eşya (boş: ödül yok)', type: 'select', options: items.map((x) => [x.sku, `${x.name} · ${x.kindName}${x.days === null ? ' · süresiz' : ` · mağazada ${x.days} gün`}`]), def: e.reward?.sku ?? '', wide: true },
        { name: 'days', label: 'Gün', type: 'number', hint: 'Boş: mağazadaki süresi. Süresiz eşyaya gün verilmez.', def: e.reward?.days && e.reward.days !== shopDays ? String(e.reward.days) : '' },
      ],
      ok: 'Kaydet',
    });
    if (!v) return;
    const days = v.days === '' || v.days === undefined ? undefined : Number(v.days);
    const r = await act(() => post('/api/app/events/reward', { id: e.id, sku: v.sku || null, ...(v.sku && days ? { days } : {}) }));
    if (r) (toast(v.sku ? 'Katılım ödülü kaydedildi' : 'Katılım ödülü kaldırıldı'), list.reload());
  };
  return html`
    ${prompt}
    <div class="row gap wrap" style="margin:10px 0">
      <${Chips} value=${status} options=${E_STATUS.map(([k, l]) => [k, counts[k] ? `${l} (${counts[k]})` : l])} onChange=${(s) => (setStatus(s), setSkip(0))} />
      <form class="row gap" onSubmit=${(e) => (e.preventDefault(), setSkip(0), setSearch(text.trim()))}>
        <input value=${text} onInput=${(e) => setText(e.target.value)} placeholder="Etkinlik, oda ya da düzenleyen" />
        <button class="btn" type="submit">Ara</button>
      </form>
    </div>
    <${Loading} state=${list}>${(d) => html`<${Table}
      empty=${status === 'review' ? 'İnceleme bekleyen başvuru yok' : 'Bu listede etkinlik yok'}
      columns=${[
        { key: 'startsAt', label: 'Zaman', render: (e) => html`${dateTimeTr(e.startsAt)}<br /><small class="muted">→ ${dateTimeTr(e.endsAt)}</small>` },
        { key: 'title', label: 'Etkinlik', render: (e) => html`<div class="row gap" style="align-items:flex-start"><${Pic} src=${e.coverUrl} size=${48} /><div><strong>${e.title}</strong><br /><small class="muted">${e.category.name}</small>${e.description ? html`<br /><small>${cut(e.description, 160)}</small>` : ''}</div></div>` },
        { key: 'room', label: 'Oda', render: (e) => html`${e.room.title}${e.room.code ? html` <small class="muted num">ID ${e.room.code}</small>` : ''}${e.room.closed ? html` <${Badge} s="closed" label="Kapalı" />` : ''}<br /><small class="muted">${e.host.name}${e.host.publicNo ? ` · ID ${e.host.publicNo}` : ''}</small>` },
        { key: 'state', label: 'Durum', render: (e) => html`<${Badge} s=${E_BADGE[e.state] ?? 'pending'} label=${e.stateLabel} />${e.rejectReason ? html`<br /><small class="muted">${cut(e.rejectReason, 120)}</small>` : ''}` },
        { key: 'reserved', label: 'Yer', align: 'right', render: (e) => `${num(e.reserved)}${e.capacity ? ` / ${num(e.capacity)}` : ''}${e.came ? ` · geldi ${num(e.came)}` : ''}` },
        {
          key: 'reward',
          label: 'Katılım ödülü',
          render: (e) =>
            e.reward
              ? html`${e.reward.name}<br /><small class="muted">${e.reward.days === null ? 'süresiz' : `${e.reward.days} gün`}${e.reward.given !== undefined ? ` · ${num(e.reward.given)} kişiye verildi` : ''}</small>`
              : html`<span class="muted">—</span>`,
        },
        {
          key: 'a',
          label: '',
          render: (e) =>
            can('app.events') &&
            html`<span class="row gap">
              ${e.state === 'review' && html`<${Button} kind="primary" onClick=${() => decide(e, true)}>Onayla</${Button}><${Button} kind="danger" onClick=${() => decide(e, false)}>Reddet</${Button}>`}
              ${d.rewardItems && ['draft', 'review', 'upcoming', 'live'].includes(e.state) && html`<${Button} onClick=${() => setReward(e, d.rewardItems)}>Ödül</${Button}>`}
              ${(e.state === 'upcoming' || e.state === 'live') && html`<${Button} kind="danger" onClick=${() => remove(e)}>Yayından kaldır</${Button}>`}
            </span>`,
        },
      ]}
      rows=${d.events}
    />
    <div class="row gap end">
      ${skip > 0 && html`<${Button} onClick=${() => setSkip(0)}>İlk sayfa</${Button}>`}
      ${d.more && html`<${Button} onClick=${() => setSkip(skip + d.events.length)}>Sonraki</${Button}>`}
    </div>`}</${Loading}>`;
}

function Categories() {
  const { can } = useApp();
  const list = useApi('/api/app/events/categories');
  const [edit, setEdit] = useState(null);
  const remove = async (c) => confirm(`“${c.name}” türü silinir. Bu türde etkinlik varsa silinemez; kapatabilirsiniz.`) && (await act(() => post('/api/app/events/categories/remove', { id: c.id }))) && (toast('Tür silindi'), list.reload());
  return html`
    <div class="row gap end" style="margin:10px 0">${can('app.events') && html`<${Button} kind="primary" onClick=${() => setEdit({ name: '', icon: 'sparkles', theme: 'sade', sort: 0, active: true })}>Yeni tür</${Button}>`}</div>
    <${Loading} state=${list}>${(d) => html`<${Table}
      empty="Tür yok"
      columns=${[
        { key: 'name', label: 'Tür', render: (c) => html`<strong>${c.name}</strong><br /><small class="muted num">${c.id}</small>` },
        { key: 'icon', label: 'Simge' },
        { key: 'theme', label: 'Varsayılan tema', render: (c) => Object.fromEntries(THEMES)[c.theme] ?? c.theme },
        { key: 'sort', label: 'Sıra', align: 'right' },
        { key: 'active', label: 'Durum', render: (c) => html`<${Badge} s=${c.active ? 'active' : 'passive'} label=${c.active ? 'Açık' : 'Kapalı'} />` },
        { key: 'used', label: 'Etkinlik', align: 'right', render: (c) => num(c.used) },
        { key: 'a', label: '', render: (c) => can('app.events') && html`<span class="row gap"><${Button} onClick=${() => setEdit(c)}>Düzenle</${Button}>${c.used === 0 && html`<${Button} kind="ghost" onClick=${() => remove(c)}>Sil</${Button}>`}</span>` },
      ]}
      rows=${d.categories}
    />`}</${Loading}>
    ${edit && html`<${CategoryEditor} c=${edit} onClose=${() => setEdit(null)} onSaved=${() => (setEdit(null), toast('Tür kaydedildi'), list.reload())} />`}`;
}

function CategoryEditor({ c, onClose, onSaved }) {
  const [v, setV] = useState({ ...c, sort: String(c.sort ?? 0) });
  const set = (patch) => setV({ ...v, ...patch });
  const save = async () => {
    const body = { ...(c.id ? { id: c.id } : {}), name: v.name.trim(), icon: v.icon.trim() || 'sparkles', theme: v.theme, sort: Number(v.sort) || 0, active: !!v.active };
    if (await act(() => post('/api/app/events/categories', body))) onSaved();
  };
  return html`<${Modal} title=${c.id ? `Tür: ${c.name}` : 'Yeni tür'} onClose=${onClose}>
    <div class="form"><div class="grid2">
      <label class="field"><span>Ad * (2–24)</span><input value=${v.name} maxlength="24" onInput=${(e) => set({ name: e.target.value })} /></label>
      <label class="field"><span>Simge adı (uygulamadaki simge, ör. sparkles)</span><input value=${v.icon} maxlength="40" onInput=${(e) => set({ icon: e.target.value })} /></label>
      <label class="field"><span>Varsayılan tema</span><select value=${v.theme} onChange=${(e) => set({ theme: e.target.value })}>${THEMES.map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select></label>
      <label class="field"><span>Sıra (-1000…1000, küçük önce)</span><input inputmode="numeric" value=${v.sort} onInput=${(e) => set({ sort: e.target.value })} /></label>
      <label class="field inline"><span>Açık (başvuruda seçilebilir)</span><input type="checkbox" checked=${v.active} onChange=${(e) => set({ active: e.target.checked })} /></label>
    </div></div>
    <div class="row gap end"><${Button} onClick=${onClose}>Vazgeç</${Button}><${Button} kind="primary" disabled=${v.name.trim().length < 2} onClick=${save}>Kaydet</${Button}></div>
  </${Modal}>`;
}

function EventReport() {
  const [days, setDays] = useState(30);
  const rep = useApi(`/api/app/events/report?days=${days}`);
  return html`
    <div style="margin:10px 0"><${Chips} value=${days} options=${[[7, 'Son 7 gün'], [30, 'Son 30 gün'], [90, 'Son 90 gün']]} onChange=${setDays} /></div>
    <${Loading} state=${rep}>${({ report: r }) => html`
      <div class="kpis">
        <${Kpi} label="Etkinlik" value=${num(r.events)} sub=${`onaylanan ${num(r.approved)} · reddedilen ${num(r.rejected)}`} />
        <${Kpi} label="İnceleme bekleyen" value=${num(r.review)} />
        <${Kpi} label="Başlayan" value=${num(r.started)} sub=${`kaldırılan ${num(r.cancelled)}`} />
        <${Kpi} label="Yer ayırma" value=${num(r.reservations)} sub=${`gelen ${num(r.attended)} · gelmeyen ${num(r.missed)}`} />
        <${Kpi} label="Katılma oranı" value=${pct(r.attendanceRate)} />
        <${Kpi} label="Katılımcı" value=${num(r.participants)} sub=${r.avgParticipants === null ? '' : `etkinlik başı ${num(r.avgParticipants, 1)}`} />
      </div>
      <div class="grid cols2">
        <${Card} title="En çok katılan türler"><${Table} dense empty="Etkinlik yok" columns=${[
          { key: 'name', label: 'Tür' },
          { key: 'events', label: 'Etkinlik', align: 'right', render: (c) => num(c.events) },
          { key: 'reservations', label: 'Yer ayırma', align: 'right', render: (c) => num(c.reservations) },
          { key: 'participants', label: 'Katılımcı', align: 'right', render: (c) => num(c.participants) },
        ]} rows=${r.categories} /></${Card}>
        <${Card} title="Nasıl bitti"><${Table} dense empty="Biten etkinlik yok" columns=${[
          { key: 'k', label: 'Neden', render: ([k]) => END_TEXT[k] ?? k },
          { key: 'n', label: 'Etkinlik', align: 'right', render: ([, n]) => num(n) },
        ]} rows=${Object.entries(r.ends).filter(([, n]) => n > 0)} /></${Card}>
      </div>
      <${Card} title="Son başlayan ve biten"><${Table} dense empty="Kayıt yok" columns=${[
        { key: 'at', label: 'Zaman', render: (x) => dateTimeTr(x.at) },
        { key: 'event', label: 'Etkinlik', render: (x) => html`${x.event.title}<br /><small class="muted">${x.room}${x.roomCode ? ` · oda ID ${x.roomCode}` : ''}</small>` },
        { key: 'action', label: 'Ne oldu', render: (x) => (x.action === 'start' ? 'Başladı' : x.action === 'not_started' ? 'Başlatılmadı' : `Bitti${x.reason && END_TEXT[x.reason] ? ` · ${END_TEXT[x.reason]}` : ''}`) },
        { key: 'by', label: 'Kim' },
      ]} rows=${r.records} /></${Card}>`}</${Loading}>`;
}
