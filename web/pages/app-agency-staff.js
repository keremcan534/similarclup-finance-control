// Uygulama › Ajans personeli: the app's agency centre staff and the centre's own work on an agency, through its admin
// API (server/app-admin.ts, permission app.agency_staff; the app's agency-admin.mjs checks and records each one):
// who on the platform staff holds which centre role, the roles and their permissions (platform and agency ones), an
// agency's BD, operations score and violation points, agencies' appeals, the network's background jobs run now.
import { Button, Card, Loading, Modal, Page, Table, Tabs, act, dateTimeTr, html, num, post, toast, useApi, usePrompt, useState } from '../lib.js';

const Tag = ({ c, label }) => html`<span class=${`badge ${c}`}>${label}</span>`;
const SCOPE = { platform: 'Merkez', agency: 'Ajans' };

export function AppAgencyStaff() {
  const [tab, setTab] = useState('staff');
  return html`<${Page}
    title="Ajans personeli"
    subtitle="Ajans merkezinde kimin hangi rolle çalıştığı, rollerin yetkileri, bir ajansın BD'si, operasyon puanı ve ihlalleri, ajansların itirazları. Her işlem uygulamada senin adınla kaydedilir."
  >
    <${Tabs}
      tabs=${[
        ['staff', 'Personel'],
        ['roles', 'Roller'],
        ['agency', 'Ajans işlemleri'],
        ['appeals', 'İtirazlar'],
        ['jobs', 'Arka plan işleri'],
      ]}
      value=${tab}
      onChange=${setTab}
    />
    ${tab === 'staff' && html`<${Staff} />`}
    ${tab === 'roles' && html`<${Roles} />`}
    ${tab === 'agency' && html`<${AgencyActions} />`}
    ${tab === 'appeals' && html`<${Appeals} />`}
    ${tab === 'jobs' && html`<${Jobs} />`}
  </${Page}>`;
}

function Staff() {
  const staff = useApi('/api/app/agency/staff');
  const roles = useApi('/api/app/agency/roles');
  const [ask, prompt] = usePrompt();
  const platformRoles = (roles.data?.roles ?? []).filter((r) => r.scope === 'platform' && !r.archived);
  const set = async (s) => {
    const v = await ask(s ? `${s.user.name}: rol` : 'Personel ekle', {
      text: s ? '' : 'Uygulamadaki hesabın kimliğini yapıştır (Kullanıcılar sayfasında görünür).',
      fields: [
        ...(s ? [] : [{ name: 'user', label: 'Hesap kimliği', type: 'text', required: true, wide: true }]),
        { name: 'roleId', label: 'Rol', type: 'select', required: true, options: platformRoles.map((r) => [String(r.id), r.name]), def: s?.roleId ? String(s.roleId) : String(platformRoles[0]?.id ?? '') },
      ],
      ok: 'Kaydet',
    });
    if (!v) return;
    const r = await act(() => post('/api/app/agency/staff/set', { user: s ? s.user.id : v.user.trim(), roleId: Number(v.roleId), extra: s?.extra ?? [], denied: s?.denied ?? [] }));
    if (r) (toast('Personel kaydedildi'), staff.reload());
  };
  const remove = async (s) => {
    if (!confirm(`${s.user.name} ajans merkezi personelinden çıkarılsın mı? Uygulamadaki hesabı kalır.`)) return;
    const r = await act(() => post('/api/app/agency/staff/remove', { user: s.user.id }));
    if (r) (toast('Personelden çıkarıldı'), staff.reload());
  };
  return html`<div style="margin-top:10px">
    ${prompt}
    <div class="row" style="margin-bottom:8px"><${Button} kind="primary" disabled=${!platformRoles.length} onClick=${() => set(null)}>Personel ekle</${Button}></div>
    <${Loading} state=${staff}>${(x) => html`<${Table}
      empty="Ajans merkezinde personel yok"
      columns=${[
        { key: 'user', label: 'Kişi', render: (s) => html`<strong>${s.user.name}</strong>` },
        { key: 'role', label: 'Rol', render: (s) => s.role ?? '—' },
        { key: 'perms', label: 'Yetkiler', render: (s) => html`<span class="muted">${(s.perms ?? []).length} yetki</span>` },
        { key: 'extra', label: 'Ek / kapalı', render: (s) => `${(s.extra ?? []).length} ek · ${(s.denied ?? []).length} kapalı` },
        {
          key: 'a',
          label: '',
          render: (s) => html`<span class="row gap">
            <${Button} onClick=${() => set(s)}>Rol değiştir</${Button}>
            <${Button} kind="ghost" onClick=${() => remove(s)}>Çıkar</${Button}>
          </span>`,
        },
      ]}
      rows=${x.staff}
    />`}</${Loading}>
  </div>`;
}

function Roles() {
  const roles = useApi('/api/app/agency/roles');
  const [edit, setEdit] = useState(null);
  return html`<div style="margin-top:10px">
    <${Loading} state=${roles}>${(x) => html`
      <div class="row" style="margin-bottom:8px"><${Button} kind="primary" onClick=${() => setEdit({ name: '', scope: 'platform', permissions: [] })}>Yeni rol</${Button}></div>
      <${Table}
        empty="Rol yok"
        columns=${[
          { key: 'name', label: 'Rol', render: (r) => html`<strong>${r.name}</strong>${r.protected ? html` <${Tag} c="info" label="Sistem" />` : ''}${r.archived ? html` <${Tag} c="muted" label="Arşivde" />` : ''}` },
          { key: 'scope', label: 'Kapsam', render: (r) => SCOPE[r.scope] ?? r.scope },
          {
            key: 'permissions',
            label: 'Yetkiler',
            render: (r) => {
              const names = r.permissions.map((p) => (r.scope === 'platform' ? x.platformPerms : x.agencyPerms ?? {})[p] ?? p);
              return html`<span class="muted" style="white-space:normal" title=${names.join('\n')}>${names.slice(0, 3).join(' · ') || '—'}${names.length > 3 ? ` · +${names.length - 3}` : ''}</span>`;
            },
          },
          { key: 'a', label: '', render: (r) => !r.protected && !r.archived && html`<${Button} onClick=${() => setEdit(r)}>Düzenle</${Button}>` },
        ]}
        rows=${x.roles}
      />
      ${edit && html`<${RoleEditor} role=${edit} catalog=${{ platform: x.platformPerms, agency: x.agencyPerms ?? {} }} onClose=${() => setEdit(null)} onSaved=${() => (setEdit(null), roles.reload())} />`}
    `}</${Loading}>
  </div>`;
}

function RoleEditor({ role, catalog, onClose, onSaved }) {
  const [name, setName] = useState(role.name);
  const [scope, setScope] = useState(role.scope);
  const [perms, setPerms] = useState(new Set(role.permissions));
  const toggle = (p) => {
    const next = new Set(perms);
    next.has(p) ? next.delete(p) : next.add(p);
    setPerms(next);
  };
  const save = async (archive = false) => {
    if (archive && !confirm(`${role.name} arşive kaldırılsın mı? Bu roldeki kişilerin rolü boşalır.`)) return;
    const body = { ...(role.id ? { id: role.id } : {}), name: name.trim(), scope, permissions: [...perms].filter((p) => p in catalog[scope]), ...(archive ? { archive: true } : {}) };
    const r = await act(() => post('/api/app/agency/roles', body));
    if (r) (toast(archive ? 'Rol arşive kaldırıldı' : 'Rol kaydedildi'), onSaved());
  };
  return html`<${Modal} title=${role.id ? `Rol: ${role.name}` : 'Yeni rol'} onClose=${onClose} wide>
    <div class="row gap wrap" style="margin-bottom:10px">
      <label class="field"><span>Ad *</span><input value=${name} onInput=${(e) => setName(e.target.value)} /></label>
      <label class="field"><span>Kapsam</span><select value=${scope} disabled=${!!role.id} onChange=${(e) => setScope(e.target.value)}>
        <option value="platform">Merkez</option>
        <option value="agency">Ajans</option>
      </select></label>
    </div>
    <div class="grid2">
      ${Object.entries(catalog[scope]).map(([p, label]) => html`<label class="field inline"><input type="checkbox" checked=${perms.has(p)} onChange=${() => toggle(p)} /><span>${label}</span></label>`)}
    </div>
    <div class="row gap" style="margin-top:12px">
      ${role.id && html`<${Button} kind="ghost" onClick=${() => save(true)}>Arşive kaldır</${Button}>`}
      <span style="flex:1"></span>
      <${Button} onClick=${onClose}>Vazgeç</${Button}>
      <${Button} kind="primary" disabled=${name.trim().length < 2} onClick=${() => save()}>Kaydet</${Button}>
    </div>
  </${Modal}>`;
}

function AgencyActions() {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const list = useApi(q ? `/api/app/agency/list?q=${encodeURIComponent(q)}` : null);
  const [ask, prompt] = usePrompt();
  const done = (t) => (r) => r && (toast(t), list.reload());
  const bd = async (a) => {
    const v = await ask(`${a.name}: BD`, { text: 'Ajansın BD sorumlusu: uygulamadaki hesabın kimliği. Boş bırakırsan ajansın BD\'si kalkar.', fields: [{ name: 'bd', label: 'BD hesap kimliği', type: 'text', wide: true, def: a.bd?.id ?? '' }], ok: 'Kaydet' });
    if (v) done('BD kaydedildi')(await act(() => post('/api/app/agency/bd', { agencyId: a.id, bd: v.bd?.trim() || null })));
  };
  const score = async (a) => {
    const v = await ask(`${a.name}: operasyon puanı`, {
      fields: [
        { name: 'score', label: 'Puan (0–100)', type: 'number', required: true, def: String(a.opsScore ?? 100) },
        { name: 'reason', label: 'Neden', type: 'textarea', required: true, wide: true },
      ],
      ok: 'Kaydet',
    });
    if (v) done('Operasyon puanı kaydedildi')(await act(() => post('/api/app/agency/ops-score', { agencyId: a.id, score: Number(v.score), reason: v.reason })));
  };
  const violation = async (a) => {
    const v = await ask(`${a.name}: ihlal`, {
      text: 'İhlal puanı ajansın kaydına yazılır; ajans uygulamadan itiraz edebilir.',
      fields: [
        { name: 'points', label: 'İhlal puanı', type: 'number', required: true, def: '1' },
        { name: 'note', label: 'Açıklama', type: 'textarea', required: true, wide: true },
      ],
      ok: 'Kaydet',
    });
    if (v) done('İhlal kaydedildi')(await act(() => post('/api/app/agency/violation', { agencyId: a.id, points: Number(v.points), note: v.note })));
  };
  return html`<div style="margin-top:10px">
    ${prompt}
    <form class="row gap" style="margin-bottom:8px" onSubmit=${(e) => (e.preventDefault(), setQ(text.trim()))}>
      <input value=${text} onInput=${(e) => setText(e.target.value)} placeholder="Ajans adı ya da kodu" style="min-width:320px" />
      <button class="btn" type="submit">Ara</button>
    </form>
    ${q && html`<${Loading} state=${list}>${(x) => html`<${Table}
      empty="Bu aramayla ajans bulunamadı"
      columns=${[
        { key: 'name', label: 'Ajans', render: (a) => html`<strong>${a.name}</strong> <span class="muted num">${a.code}</span>` },
        { key: 'status', label: 'Durum' },
        { key: 'owner', label: 'Sahibi', render: (a) => a.owner?.name ?? '—' },
        {
          key: 'a',
          label: '',
          render: (a) => html`<span class="row gap">
            <${Button} onClick=${() => bd(a)}>BD</${Button}>
            <${Button} onClick=${() => score(a)}>Operasyon puanı</${Button}>
            <${Button} kind="danger" onClick=${() => violation(a)}>İhlal</${Button}>
          </span>`,
        },
      ]}
      rows=${x.agencies}
    />`}</${Loading}>`}
  </div>`;
}

function Appeals() {
  const [status, setStatus] = useState('open');
  const list = useApi(`/api/app/agency/appeals?status=${status}`);
  const [ask, prompt] = usePrompt();
  const decide = async (p, accept) => {
    const v = await ask(accept ? 'İtirazı kabul et' : 'İtirazı reddet', { text: p.body, label: 'Ajansa gidecek not', ok: accept ? 'Kabul et' : 'Reddet' });
    if (v) {
      const r = await act(() => post('/api/app/agency/appeals/decide', { id: p.id, accept, note: v.reason }));
      if (r) (toast(accept ? 'İtiraz kabul edildi' : 'İtiraz reddedildi'), list.reload());
    }
  };
  return html`<div style="margin-top:10px">
    ${prompt}
    <div class="row gap" style="margin-bottom:8px">
      <select value=${status} onChange=${(e) => setStatus(e.target.value)}>
        <option value="open">Bekleyenler</option>
        <option value="accepted">Kabul edilenler</option>
        <option value="rejected">Reddedilenler</option>
      </select>
    </div>
    <${Loading} state=${list}>${(x) => html`<${Table}
      empty="İtiraz yok"
      columns=${[
        { key: 'agency', label: 'Ajans', render: (p) => p.agency?.name ?? '—' },
        { key: 'subject', label: 'Konu' },
        { key: 'body', label: 'İtiraz', render: (p) => p.body },
        { key: 'status', label: 'Durum', render: (p) => (p.status === 'open' ? html`<${Tag} c="warn" label="Bekliyor" />` : p.status === 'accepted' ? html`<${Tag} c="ok" label="Kabul" />` : html`<${Tag} c="muted" label="Ret" />`) },
        { key: 'at', label: 'Ne zaman', render: (p) => dateTimeTr(p.createdAt) },
        {
          key: 'a',
          label: '',
          render: (p) =>
            p.status === 'open' &&
            html`<span class="row gap">
              <${Button} onClick=${() => decide(p, true)}>Kabul</${Button}>
              <${Button} kind="ghost" onClick=${() => decide(p, false)}>Ret</${Button}>
            </span>`,
        },
      ]}
      rows=${x.appeals}
    />`}</${Loading}>
  </div>`;
}

function Jobs() {
  const [out, setOut] = useState(null);
  const run = async () => {
    if (!confirm('Ajans ağının arka plan işleri şimdi çalışsın mı? (bekleyen komisyonlar, süresi dolan transferler…) Normalde 10 dakikada bir kendiliğinden çalışır.')) return;
    const r = await act(() => post('/api/app/agency/jobs/run', {}));
    if (r) (setOut(r), toast('Arka plan işleri çalıştı'));
  };
  return html`<${Card} title="Arka plan işleri">
    <p class="muted">Komisyon hesapları, süresi dolan transferler ve dönem işleri normalde kendiliğinden çalışır. Beklemek istemezsen buradan hemen çalıştırabilirsin.</p>
    <${Button} kind="primary" onClick=${run}>Şimdi çalıştır</${Button}>
    ${out && html`<${Table} dense columns=${[{ key: 'k', label: 'İş' }, { key: 'v', label: 'Sonuç', render: (r) => (typeof r.v === 'number' ? num(r.v) : JSON.stringify(r.v)) }]} rows=${Object.entries(out).map(([k, v]) => ({ k, v }))} />`}
  </${Card}>`;
}
