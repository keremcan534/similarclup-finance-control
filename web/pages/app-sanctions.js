// Uygulama › Yaptırımlar: the app's sanctions through its admin API (server/app-admin.ts; the app's sanctions.mjs
// checks and records every action). What each person may do comes from the app: it reads this panel's role
// ('app.sanctions' = a moderator's permissions, 'app.sanctions_full' = all) and GET meta says which they are, so a
// button shows only when the app would accept it. Kişi (search, a person's record, devices, applying, lifting,
// evidence), Onay bekleyenler (a second person approves a heavy sanction), İtirazlar, Kurallar (the automatic steps,
// who may give what), all of it as the app's Yönetim had it.
import { Button, Card, ID_HINT, Loading, Modal, Page, Table, Tabs, act, dateTimeTr, get, html, num, personOf, post, toast, useApi, usePrompt, useState } from '../lib.js';

/** A coloured label in the panel's badge styles (ok, warn, bad, info, muted). */
const Tag = ({ c, label }) => html`<span class=${`badge ${c}`}>${label}</span>`;

/** "90 dk", "6 saat", "3 gün", "Süresiz": a sanction's length in minutes as people say it (null = for good). */
export function lengthText(minutes) {
  if (minutes === null || minutes === undefined) return 'Süresiz';
  if (minutes < 60) return `${minutes} dk`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} saat`;
  return `${Math.round(minutes / 1440)} gün`;
}
/** A sanction type's length choices: the app's presets (GET meta) and, for bans and mutes, "Süresiz". */
export function lengthOptions(meta, type) {
  const presets = type === 'account_ban' ? meta.presets.account_ban : type === 'device_ban' ? meta.presets.device_ban : meta.presets.mute;
  return [...presets.map((m) => [String(m), lengthText(m)]), ['', 'Süresiz']];
}
/** The length a form starts at: an hour for a mute, a day for a ban (the shortest presets are for warnings). */
export function lengthDefault(meta, type) {
  const presets = type === 'account_ban' ? meta.presets.account_ban : type === 'device_ban' ? meta.presets.device_ban : meta.presets.mute;
  const want = type === 'account_ban' || type === 'device_ban' ? 1440 : 60;
  return String(presets.find((m) => m >= want) ?? presets[0]);
}
const STATUS = {
  active: ['bad', 'Etkin'],
  pending: ['warn', 'Onay bekliyor'],
  revoked: ['muted', 'Kaldırıldı'],
  expired: ['muted', 'Süresi doldu'],
  rejected: ['muted', 'Reddedildi'],
};
const statusOf = (s) => (s.live ? STATUS.active : STATUS[s.status] ?? ['muted', s.status]);
/** What a sanction log row says (sanction_audit_logs.action). */
const ACTION = {
  apply: 'Uyguladı',
  propose: 'Önerdi',
  lift: 'Kaldırdı',
  approve: 'Onayladı',
  reject: 'Reddetti',
  evidence: 'Kanıt ekledi',
  appeal: 'İtiraz etti',
  appeal_upheld: 'İtiraz: doğru bulundu',
  appeal_reduced: 'İtiraz: süre azaltıldı',
  appeal_lifted: 'İtiraz: kaldırıldı',
  appeal_needs_review: 'İtiraz: ek inceleme',
  sign_in: 'Giriş denedi',
  device_risk: 'Cihaz riski',
  auto: 'Otomatik',
};
/** The app's account roles. */
const ROLE = { user: 'Kullanıcı', moderator: 'Moderatör', admin: 'Yönetici', coins_bank: 'Jeton Noktası' };
const APPEAL = { open: 'Bekliyor', upheld: 'Doğru bulundu', reduced: 'Süre azaltıldı', lifted: 'Kaldırıldı', needs_review: 'Ek inceleme' };
const RISK = [
  ['normal', 'Normal'],
  ['shared', 'Ortak cihaz'],
  ['reinstalled', 'Yeniden kuruldu'],
  ['changed', 'Kimliği değişti'],
  ['evasion_suspect', 'Ban kaçırma şüphesi'],
];
/** Room-only mutes are given from inside the room in the app; here the platform-wide ones. */
const GLOBAL = (t) => !t.startsWith('mute_room_');

export function AppSanctions() {
  const meta = useApi('/api/app/sanctions/meta');
  const [tab, setTab] = useState('person');
  const perms = new Set(meta.data?.perms ?? []);
  const full = perms.has('sanction.approve');
  const tabs = [
    ['person', 'Kişi'],
    ['pending', 'Onay bekleyenler'],
    ['appeals', 'İtirazlar'],
    ...(perms.has('sanction.policy') || perms.has('sanction.permissions') ? [['rules', 'Kurallar ve yetkiler']] : []),
  ];
  return html`<${Page}
    title="Yaptırımlar"
    subtitle="Uygulamanın susturma ve ban kayıtları. Her işlem uygulamada senin adınla kaydedilir; ağır yaptırımı öneren değil, başka bir yetkili onaylar."
  >
    <${Loading} state=${meta}>${(m) => html`
      <${Tabs} tabs=${tabs} value=${tab} onChange=${setTab} />
      ${tab === 'person' && html`<${Person} meta=${m} perms=${perms} />`}
      ${tab === 'pending' && html`<${Pending} meta=${m} full=${full} />`}
      ${tab === 'appeals' && html`<${Appeals} perms=${perms} />`}
      ${tab === 'rules' && html`<${Rules} meta=${m} perms=${perms} onSaved=${meta.reload} />`}
    `}</${Loading}>
  </${Page}>`;
}

function Person({ meta, perms }) {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const found = useApi(q ? `/api/app/sanctions/search?q=${encodeURIComponent(q)}` : null);
  return html`<div>
    <form class="row gap" style="margin:10px 0" onSubmit=${(e) => (e.preventDefault(), setQ(text.trim()))}>
      <input value=${text} onInput=${(e) => setText(e.target.value)} placeholder="Ad, telefon, kişinin ID’si, yaptırım ya da cihaz no (#123)" title=${ID_HINT} style="min-width:380px" />
      <button class="btn" type="submit">Ara</button>
    </form>
    ${q && html`<${Loading} state=${found}>${(x) => html`<${Table}
      empty="Bu aramayla kimse bulunamadı"
      columns=${[
        { key: 'name', label: 'Kişi', render: (u) => html`<strong>${u.name}</strong>${u.deleted ? html` <${Tag} c="muted" label="Silinmiş" />` : ''}${u.publicNo ? html`<br /><small class="muted num">ID ${u.publicNo}</small>` : ''}` },
        { key: 'phone', label: 'Telefon', render: (u) => u.phone ?? '—' },
        { key: 'role', label: 'Rol', render: (u) => ROLE[u.role] ?? u.role },
        { key: 'live', label: 'Etkin', render: (u) => (u.liveSanctions ? html`<${Tag} c="bad" label=${`${u.liveSanctions} etkin`} />` : '—') },
        { key: 'total', label: 'Toplam', render: (u) => num(u.totalSanctions) },
        { key: 'a', label: '', render: (u) => html`<${Button} onClick=${() => setOpen(u.id)}>Aç</${Button}>` },
      ]}
      rows=${x.users}
    />`}</${Loading}>`}
    ${open && html`<${Record} id=${open} meta=${meta} perms=${perms} onClose=${() => setOpen(null)} />`}
  </div>`;
}

function Record({ id, meta, perms, onClose }) {
  const rec = useApi(`/api/app/sanctions/user?id=${encodeURIComponent(id)}`);
  const [ask, prompt] = usePrompt();
  const done = (text) => (r) => r && (toast(text), rec.reload());
  const types = meta.types.filter((t) => GLOBAL(t.type));
  const apply = async (person, devices) => {
    const first = await ask(`${person.name}: yaptırım`, {
      text: 'Önce türü seç. Kademe kuralını seçersen tür ve süre, kişinin bu kategorideki geçmişine göre uygulamada belirlenir.',
      fields: [
        { name: 'type', label: 'Tür', type: 'select', required: true, options: types.map((t) => [t.type, t.label]), def: types[0]?.type },
        { name: 'reason', label: 'Kategori', type: 'select', required: true, options: meta.reasons.map((r) => [r.code, r.title]), def: meta.reasons[0]?.code },
        { name: 'usePolicy', label: 'Kademe kuralına göre', type: 'checkbox' },
      ],
      ok: 'Devam',
    });
    if (!first) return;
    const v = await ask(`${person.name}: ${types.find((t) => t.type === first.type)?.label ?? first.type}`, {
      text: first.type === 'device_ban' ? `Kişinin bilinen ${devices.length} cihazının hepsine uygulanır.` : 'Gerekçe kişiye gösterilir; iç not yalnız yetkililere.',
      fields: [
        ...(first.usePolicy ? [] : [{ name: 'minutes', label: 'Süre', type: 'select', options: lengthOptions(meta, first.type), def: lengthDefault(meta, first.type) }]),
        { name: 'description', label: 'Kişiye gösterilecek gerekçe', type: 'text', wide: true },
        { name: 'note', label: 'İç not', type: 'textarea', wide: true },
        ...(first.type === 'mute_global_text' ? [{ name: 'includeDm', label: 'Özel mesajlar da kapansın', type: 'checkbox' }] : []),
        ...(first.type === 'mute_global_voice' ? [{ name: 'includeCalls', label: 'Aramalar da kapansın', type: 'checkbox' }] : []),
      ],
      ok: 'Uygula',
    });
    if (!v) return;
    const body = {
      user: person.id,
      type: first.type,
      reason: first.reason,
      ...(first.usePolicy ? { usePolicy: true } : { minutes: v.minutes === '' ? null : Number(v.minutes) }),
      description: v.description ?? '',
      note: v.note ?? '',
      ...(v.includeDm ? { includeDm: true } : {}),
      ...(v.includeCalls ? { includeCalls: true } : {}),
      ...(first.type === 'device_ban' ? { deviceIds: devices.map((d) => d.id) } : {}),
    };
    const r = await act(() => post('/api/app/sanctions', body));
    if (r) done(r.sanctions.some((s) => s.status === 'pending') ? 'Yaptırım önerildi: başka bir yetkilinin onayını bekliyor' : 'Yaptırım uygulandı')(r);
  };
  const lift = async (s) => {
    const v = await ask('Yaptırımı kaldır', { text: `${s.reason ?? s.reasonCode} · ${lengthText(s.permanent ? null : minutesOf(s))}`, label: 'Kaldırma nedeni' });
    if (v) done('Yaptırım kaldırıldı')(await act(() => post('/api/app/sanctions/lift', { id: s.id, reason: v.reason })));
  };
  const evidence = async (s) => {
    const v = await ask('Kanıt ekle', {
      fields: [
        { name: 'kind', label: 'Tür', type: 'select', required: true, options: [['note', 'Not'], ['link', 'Bağlantı'], ['screenshot', 'Ekran görüntüsü bağlantısı']], def: 'note' },
        { name: 'content', label: 'İçerik', type: 'textarea', required: true, wide: true },
      ],
      ok: 'Ekle',
    });
    if (v) done('Kanıt eklendi')(await act(() => post('/api/app/sanctions/evidence', { id: s.id, kind: v.kind, content: v.content })));
  };
  const risk = async (d) => {
    const v = await ask(`Cihaz #${d.id}: risk`, {
      fields: [
        { name: 'status', label: 'Durum', type: 'select', required: true, options: RISK, def: d.risk ?? 'normal' },
        { name: 'note', label: 'Not', type: 'text', wide: true },
      ],
      ok: 'Kaydet',
    });
    if (v) done('Cihaz kaydedildi')(await act(() => post('/api/app/devices/risk', { device: d.id, status: v.status, note: v.note ?? '' })));
  };
  return html`<${Modal} title="Kişinin kaydı" onClose=${onClose} wide>
    ${prompt}
    <${Loading} state=${rec}>${(x) => {
      const person = x.user;
      const devices = x.devices ?? [];
      return html`
        <div class="row gap wrap" style="align-items:center;margin-bottom:10px">
          <strong style="font-size:1.1em">${person.name}</strong>
          <span class="muted">${ROLE[person.role] ?? person.role} · kayıt ${dateTimeTr(person.createdAt)}${person.deleted ? ' · silinmiş hesap' : ''}</span>
          <span style="flex:1"></span>
          ${(perms.has('sanction.mute') || perms.has('sanction.ban')) && html`<${Button} kind="danger" onClick=${() => apply(person, devices)}>Yaptırım uygula</${Button}>`}
        </div>
        <${Card} title="Yaptırımlar">
          <${Table}
            dense
            empty="Kaydı temiz"
            columns=${[
              { key: 'id', label: 'No', render: (s) => html`<span class="num">#${s.id}</span>` },
              { key: 'type', label: 'Tür', render: (s) => meta.types.find((t) => t.type === s.type)?.label ?? s.type },
              { key: 'reason', label: 'Kategori', render: (s) => s.reason ?? s.reasonCode },
              { key: 'len', label: 'Süre', render: (s) => (s.permanent ? 'Süresiz' : `${dateTimeTr(s.startAt)} → ${dateTimeTr(s.endAt)}`) },
              { key: 'status', label: 'Durum', render: (s) => html`<${Tag} c=${statusOf(s)[0]} label=${statusOf(s)[1]} />${s.appealStatus ? html` <span class="muted">İtiraz: ${APPEAL[s.appealStatus] ?? s.appealStatus}</span>` : ''}` },
              { key: 'by', label: 'Veren', render: (s) => html`${s.createdBy?.name ?? '—'}${s.approvedBy ? html`<br /><span class="muted">Onay: ${s.approvedBy.name}</span>` : ''}` },
              { key: 'ev', label: 'Kanıt', render: (s) => (s.evidence?.length ? num(s.evidence.length) : '—') },
              {
                key: 'a',
                label: '',
                render: (s) => html`<span class="row gap">
                  ${(s.live || s.status === 'pending') && perms.has('sanction.lift') && html`<${Button} onClick=${() => lift(s)}>Kaldır</${Button}>`}
                  <${Button} kind="ghost" onClick=${() => evidence(s)}>Kanıt</${Button}>
                </span>`,
              },
            ]}
            rows=${x.sanctions}
          />
        </${Card}>
        <${Card} title="Cihazlar">
          <${Table}
            dense
            empty="Bilinen cihaz yok"
            columns=${[
              { key: 'id', label: 'No', render: (d) => html`<span class="num">#${d.id}</span>` },
              { key: 'model', label: 'Cihaz', render: (d) => [d.platform, d.model, d.os].filter(Boolean).join(' · ') || '—' },
              { key: 'risk', label: 'Risk', render: (d) => RISK.find((r) => r[0] === d.risk)?.[1] ?? d.risk ?? '—' },
              { key: 'accounts', label: 'Hesap', render: (d) => num(d.accounts) },
              { key: 'banned', label: 'Ban', render: (d) => (d.banned ? html`<${Tag} c="bad" label="Banlı" />` : '—') },
              { key: 'seen', label: 'Son görülme', render: (d) => dateTimeTr(d.lastSeenAt) },
              { key: 'a', label: '', render: (d) => perms.has('sanction.policy') && html`<${Button} kind="ghost" onClick=${() => risk(d)}>Risk</${Button}>` },
            ]}
            rows=${devices}
          />
        </${Card}>
        <${Card} title="Geçmiş">
          <${Table}
            dense
            empty="Kayıt yok"
            columns=${[
              { key: 'at', label: 'Ne zaman', render: (l) => dateTimeTr(l.at) },
              { key: 'actor', label: 'Kim', render: (l) => l.actor },
              { key: 'action', label: 'Ne yaptı', render: (l) => ACTION[l.action] ?? l.action },
              { key: 'sanctionId', label: 'Yaptırım', render: (l) => (l.sanctionId ? html`<span class="num">#${l.sanctionId}</span>` : '—') },
              { key: 'result', label: 'Sonuç', render: (l) => (l.result === 'denied' ? html`<${Tag} c="warn" label="Yetki yoktu" />` : l.result === 'blocked' ? html`<${Tag} c="bad" label="Engellendi" />` : '—') },
            ]}
            rows=${x.audit.slice(0, 50)}
          />
        </${Card}>`;
    }}</${Loading}>
  </${Modal}>`;
}
const minutesOf = (s) => (s.endAt && s.startAt ? Math.round((Date.parse(s.endAt) - Date.parse(s.startAt)) / 60_000) : null);

function Pending({ meta, full }) {
  const list = useApi('/api/app/sanctions/pending');
  const [ask, prompt] = usePrompt();
  const decide = async (s, approve) => {
    const v = await ask(approve ? 'Yaptırımı onayla' : 'Öneriyi reddet', { label: approve ? 'Onay notu' : 'Ret nedeni', ok: approve ? 'Onayla' : 'Reddet' });
    if (v) {
      const r = await act(() => post('/api/app/sanctions/approve', { id: s.id, approve, note: v.reason }));
      if (r) (toast(approve ? 'Onaylandı: yaptırım başladı' : 'Öneri reddedildi'), list.reload());
    }
  };
  return html`<div style="margin-top:10px">
    ${prompt}
    ${!full && html`<p class="muted">Onaylamak tam yaptırım yetkisi ister; burada yalnız görürsün.</p>`}
    <${Loading} state=${list}>${(x) => html`<${Table}
      empty="Onay bekleyen yaptırım yok"
      columns=${[
        { key: 'id', label: 'No', render: (s) => html`<span class="num">#${s.id}</span>` },
        { key: 'type', label: 'Tür', render: (s) => meta.types.find((t) => t.type === s.type)?.label ?? s.type },
        { key: 'reason', label: 'Kategori', render: (s) => s.reason ?? s.reasonCode },
        { key: 'len', label: 'Süre', render: (s) => (s.permanent ? 'Süresiz' : lengthText(minutesOf(s))) },
        { key: 'by', label: 'Öneren', render: (s) => s.createdBy?.name ?? '—' },
        { key: 'at', label: 'Ne zaman', render: (s) => dateTimeTr(s.createdAt) },
        { key: 'note', label: 'Not', render: (s) => s.note || s.reasonText || '—' },
        {
          key: 'a',
          label: '',
          render: (s) =>
            full &&
            html`<span class="row gap">
              <${Button} kind="danger" onClick=${() => decide(s, true)}>Onayla</${Button}>
              <${Button} onClick=${() => decide(s, false)}>Reddet</${Button}>
            </span>`,
        },
      ]}
      rows=${x.sanctions}
    />`}</${Loading}>
  </div>`;
}

function Appeals({ perms }) {
  const [status, setStatus] = useState('open');
  const list = useApi(`/api/app/appeals?status=${status}`);
  const [ask, prompt] = usePrompt();
  const final = perms.has('sanction.appeal_decide');
  const outcomes = [['upheld', 'Doğru bulundu (yaptırım sürer)'], ['needs_review', 'Ek inceleme'], ...(final ? [['reduced', 'Süreyi azalt'], ['lifted', 'Yaptırımı kaldır']] : [])];
  const decide = async (a) => {
    const v = await ask('İtiraz kararı', {
      text: a.text,
      fields: [
        { name: 'outcome', label: 'Karar', type: 'select', required: true, options: outcomes, def: 'upheld' },
        ...(final ? [{ name: 'minutes', label: 'Yeni süre (yalnız azaltmada, dakika)', type: 'number' }] : []),
        { name: 'note', label: 'Kişiye gidecek not', type: 'textarea', required: true, wide: true },
      ],
      ok: 'Kaydet',
    });
    if (!v) return;
    const body = { id: a.id, outcome: v.outcome, note: v.note, ...(v.outcome === 'reduced' ? { minutes: Number(v.minutes) } : {}) };
    const r = await act(() => post('/api/app/appeals/decide', body));
    if (r) (toast('İtiraz kararı kaydedildi'), list.reload());
  };
  return html`<div style="margin-top:10px">
    ${prompt}
    <div class="row gap" style="margin-bottom:8px">
      <select value=${status} onChange=${(e) => setStatus(e.target.value)}>
        <option value="open">Bekleyenler</option>
        <option value="decided">Karara bağlananlar</option>
      </select>
    </div>
    <${Loading} state=${list}>${(x) => html`<${Table}
      empty="İtiraz yok"
      columns=${[
        { key: 'user', label: 'Kişi', render: (a) => a.userName ?? a.userId },
        { key: 'sanction', label: 'Yaptırım', render: (a) => html`<span class="num">#${a.sanctionId}</span>` },
        { key: 'text', label: 'İtiraz', render: (a) => a.text },
        { key: 'status', label: 'Durum', render: (a) => APPEAL[a.status] ?? a.status },
        { key: 'at', label: 'Ne zaman', render: (a) => dateTimeTr(a.createdAt) },
        { key: 'by', label: 'Bakan', render: (a) => a.reviewedBy ?? '—' },
        { key: 'a', label: '', render: (a) => (a.status === 'open' || a.status === 'needs_review') && perms.has('sanction.appeal') && html`<${Button} onClick=${() => decide(a)}>Karar ver</${Button}>` },
      ]}
      rows=${x.appeals}
    />`}</${Loading}>
  </div>`;
}

function Rules({ meta, perms, onSaved }) {
  const [edit, setEdit] = useState(null);
  const by = new Map();
  for (const p of meta.policies) by.set(p.reason, [...(by.get(p.reason) ?? []), p]);
  return html`<div style="margin-top:10px">
    ${perms.has('sanction.policy') && html`<${Card} title="Ceza kademeleri">
      <p class="muted">Aynı kategoride tekrar eden ihlalde sıradaki kademe uygulanır. Ömür boyu ve cihaz banı her zaman bir yetkilinin onayını bekler.</p>
      <${Table}
        dense
        columns=${[
          { key: 'title', label: 'Kategori' },
          { key: 'steps', label: 'Kademeler', render: (r) => (by.get(r.code) ?? []).map((p) => `${meta.types.find((t) => t.type === p.type)?.label ?? p.type} ${lengthText(p.minutes)}${p.auto ? ' (otomatik)' : ''}${p.requiresApproval ? ' (onaylı)' : ''}`).join(' → ') || '—' },
          { key: 'window', label: 'Süre', render: (r) => ((by.get(r.code) ?? [])[0] ? `${(by.get(r.code) ?? [])[0].windowDays} gün` : '—') },
          { key: 'a', label: '', render: (r) => html`<${Button} onClick=${() => setEdit(r)}>Düzenle</${Button}>` },
        ]}
        rows=${meta.reasons}
      />
    </${Card}>`}
    ${perms.has('sanction.permissions') && html`<${StaffPerms} meta=${meta} />`}
    ${edit && html`<${PolicyEditor} meta=${meta} reason=${edit} steps=${by.get(edit.code) ?? []} onClose=${() => setEdit(null)} onSaved=${() => (setEdit(null), onSaved())} />`}
  </div>`;
}

function PolicyEditor({ meta, reason, steps, onClose, onSaved }) {
  const types = meta.types.filter((t) => GLOBAL(t.type));
  const [rows, setRows] = useState(steps.map((p) => ({ type: p.type, minutes: p.minutes, auto: !!p.auto, requiresApproval: !!p.requiresApproval })));
  const [windowDays, setWindowDays] = useState(String(steps[0]?.windowDays ?? 90));
  const set = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const save = async () => {
    const r = await act(() => post('/api/app/sanction-policies', { reason: reason.code, windowDays: Number(windowDays), steps: rows }));
    if (r) (toast('Kademeler kaydedildi'), onSaved());
  };
  return html`<${Modal} title=${`Kademeler: ${reason.title}`} onClose=${onClose} wide>
    <table class="table dense">
      <thead><tr><th>#</th><th>Tür</th><th>Süre</th><th>Otomatik</th><th>Onaylı</th><th></th></tr></thead>
      <tbody>
        ${rows.map((r, i) => html`<tr>
          <td>${i + 1}</td>
          <td><select value=${r.type} onChange=${(e) => set(i, 'type', e.target.value)}>${types.map((t) => html`<option value=${t.type}>${t.label}</option>`)}</select></td>
          <td><select value=${r.minutes === null ? '' : String(r.minutes)} onChange=${(e) => set(i, 'minutes', e.target.value === '' ? null : Number(e.target.value))}>
            ${lengthOptions(meta, r.type).map(([v, l]) => html`<option value=${v}>${l}</option>`)}
          </select></td>
          <td><input type="checkbox" checked=${r.auto} onChange=${(e) => set(i, 'auto', e.target.checked)} title="Yalnız susturmalar otomatik olabilir" /></td>
          <td><input type="checkbox" checked=${r.requiresApproval} onChange=${(e) => set(i, 'requiresApproval', e.target.checked)} /></td>
          <td><${Button} kind="ghost" onClick=${() => setRows(rows.filter((_, j) => j !== i))}>Sil</${Button}></td>
        </tr>`)}
      </tbody>
    </table>
    <div class="row gap" style="margin:10px 0;align-items:center">
      <${Button} disabled=${rows.length >= 10} onClick=${() => setRows([...rows, { type: types[0].type, minutes: meta.presets.mute[0], auto: false, requiresApproval: false }])}>Kademe ekle</${Button}>
      <label class="row gap" style="align-items:center">Değerlendirme süresi <input type="number" min="1" max="3650" value=${windowDays} onInput=${(e) => setWindowDays(e.target.value)} style="width:90px" /> gün</label>
      <span style="flex:1"></span>
      <${Button} onClick=${onClose}>Vazgeç</${Button}>
      <${Button} kind="primary" onClick=${save}>Kaydet</${Button}>
    </div>
  </${Modal}>`;
}

function StaffPerms({ meta }) {
  const [id, setId] = useState('');
  // The account the ID named when it was fetched: a change goes to that one even if the field was edited since.
  const [uid, setUid] = useState('');
  const [who, setWho] = useState(null);
  const load = async (u) => setWho(await act(() => get(`/api/app/sanction-permissions?user=${encodeURIComponent(u)}`)));
  const open = async () => {
    const p = await act(() => personOf(id));
    if (p) (setUid(p.id), load(p.id));
  };
  const toggle = async (perm, grant) => {
    const r = await act(() => post('/api/app/sanction-permissions', { user: uid, permission: perm, grant }));
    if (r) (toast(grant ? 'Yetki verildi' : 'Yetki geri alındı'), load(uid));
  };
  return html`<${Card} title="Yaptırım yetkileri (uygulamadaki yetkililer)">
    <p class="muted">Uygulamada moderatör ya da yönetici olan bir hesabın yaptırım yetkileri. Bu siteyi kullananların yetkisi buradaki rollerden gelir (Yönetim › Kullanıcılar ve roller).</p>
    <form class="row gap" onSubmit=${(e) => (e.preventDefault(), id.trim() && open())}>
      <input value=${id} onInput=${(e) => setId(e.target.value)} placeholder="Yetkilinin ID’si" title=${ID_HINT} style="min-width:340px" />
      <button class="btn" type="submit">Getir</button>
    </form>
    ${who && html`<p>Rol: <strong>${who.role}</strong></p>
      <${Table}
        dense
        columns=${[
          { key: 'label', label: 'Yetki' },
          { key: 'has', label: '', render: (p) => (who.permissions.includes(p.key) ? html`<${Tag} c="ok" label="Var" />` : '—') },
          { key: 'a', label: '', render: (p) => (who.granted.includes(p.key) ? html`<${Button} kind="ghost" onClick=${() => toggle(p.key, false)}>Geri al</${Button}>` : !who.permissions.includes(p.key) && html`<${Button} onClick=${() => toggle(p.key, true)}>Ver</${Button}>`) },
        ]}
        rows=${Object.entries(meta.allPerms).map(([key, label]) => ({ key, label }))}
      />`}
  </${Card}>`;
}
