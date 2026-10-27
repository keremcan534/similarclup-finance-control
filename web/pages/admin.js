import { Badge, Button, Card, Form, Loading, Modal, Page, Table, Tabs, act, dateTimeTr, dateTr, html, post, put, qs, today, useApi, useApp, useState } from '../lib.js';

// ---- integrations ------------------------------------------------------------------------
export function Integrations() {
  const s = useApi('/api/integrations');
  const [key, setKey] = useState(null);
  const [add, setAdd] = useState(false);
  const origin = location.origin;
  return html`<${Page} title="Entegrasyonlar" subtitle="Similar Club ve servis sağlayıcılarından veri alma. Bağlı olmayan kaynakların verisi uydurulmaz; panelde 'bağlı değil' olarak görünür." actions=${html`<${Button} onClick=${() => setAdd(true)}>Yeni bağlantı</${Button}>`}>
    <${Loading} state=${s}>${(d) => html`
      <${Card} title="Bağlantılar">
        <${Table} columns=${[
          { key: 'code', label: 'Kod' }, { key: 'name', label: 'Ad' }, { key: 'kind', label: 'Tür' },
          { key: 'status', label: 'Durum', render: (r) => html`<${Badge} s=${r.status} />` },
          { key: 'key_prefix', label: 'API anahtarı', render: (r) => (r.key_prefix ? html`<code>fc_${r.key_prefix}_••••</code>` : '—') },
          { key: 'last_sync_at', label: 'Son veri', render: (r) => dateTimeTr(r.last_sync_at) },
          { key: 'last_error', label: 'Son hata' },
          { key: 'a', label: '', render: (r) => html`<div class="row gap">
            <${Button} onClick=${async () => { const k = await act(() => post(`/api/integrations/${r.id}/key`)); if (k) (setKey(k.key), s.reload()); }}>${r.key_prefix ? 'Anahtarı yenile' : 'Anahtar üret'}</${Button}>
            <${Button} onClick=${async () => (await act(() => post(`/api/integrations/${r.id}/status`, { status: r.status === 'disabled' ? 'not_connected' : 'disabled' }), 'Güncellendi')) && s.reload()}>${r.status === 'disabled' ? 'Etkinleştir' : 'Devre dışı'}</${Button}>
          </div>` },
        ]} rows=${d.rows} />
      </${Card}>
      <${Card} title="Similar Club'ın göndereceği olaylar (REST)">
        <p>Similar Club sunucusu her finansal olayı benzersiz bir anahtarla gönderir. Aynı anahtar tekrar gelirse yeni kayıt oluşmaz; yeniden deneme güvenlidir.</p>
        <pre>POST ${origin}/api/ingest/events
X-Api-Key: fc_xxxxxxxx_...
Content-Type: application/json

{"events":[
 {"type":"purchase","idempotency_key":"order-123","occurred_at":"2026-10-01T10:00:00Z","user_ref":"u1","channel":"google","amount":"99.99","currency":"TRY","coins":1000,"product_ref":"pack_1000"},
 {"type":"gift","idempotency_key":"gift-555","occurred_at":"2026-10-01T10:05:00Z","sender_ref":"u1","publisher_ref":"u100","gift_ref":"ROSE","coins":100,"room_ref":"r9","event_ref":"PK-42"},
 {"type":"call","idempotency_key":"call-77","publisher_ref":"u100","user_ref":"u1","kind":"video","minutes":"12.5","coins":250},
 {"type":"lucky","idempotency_key":"lucky-9","config_code":"CLOVER","user_ref":"u1","publisher_ref":"u100","spent_coins":100,"random_value":"0.734","multiplier":"2","reward_coins":200},
 {"type":"refund","idempotency_key":"refund-1","original_key":"order-123","amount":"99.99"},
 {"type":"usage","idempotency_key":"agora-2026-10-01","provider_code":"AGORA","service":"voice_minutes","period":"2026-10","quantity":"125000"},
 {"type":"publisher","external_id":"u100","name":"Deniz","agency_code":"AG1"}
]}</pre>
        <p>Olay türleri: purchase, refund, chargeback, gift, call, game, lucky, bonus_grant, promotion, coin_spend, usage, publisher. Yanıt her olay için <code>created</code>, <code>duplicate</code> veya <code>error</code> döner; hatalı olaylar diğerlerini durdurmaz.</p>
        <p>Lucky sonucunu bu platformun çekmesi isteniyorsa: <code>POST /api/ingest/lucky/draw {"idempotency_key","config_code","user_ref","publisher_ref"}</code></p>
      </${Card}>
      <${Card} title="İçe aktarma geçmişi">
        <${Table} dense columns=${[
          { key: 'started_at', label: 'Zaman', render: (b) => dateTimeTr(b.started_at) }, { key: 'kind', label: 'Tür' },
          { key: 'rows_total', label: 'Toplam', align: 'right' }, { key: 'rows_ok', label: 'Yeni', align: 'right' }, { key: 'rows_duplicate', label: 'Tekrar', align: 'right' }, { key: 'rows_error', label: 'Hatalı', align: 'right' },
          { key: 'errors', label: 'Hatalar', render: (b) => (b.errors.length ? html`<details><summary>${b.errors.length}</summary><pre>${b.errors.map((e) => `satır ${e.row}: ${e.error}`).join('\n')}</pre></details>` : '') },
        ]} rows=${d.batches} />
      </${Card}>
    `}</${Loading}>
    ${key && html`<${Modal} title="Yeni API anahtarı" onClose=${() => setKey(null)}>
      <div class="note warn">Bu anahtar yalnız şimdi gösterilir; sistemde yalnız özeti saklanır. Similar Club sunucusunun gizli ayarlarına kaydedin.</div>
      <pre>${key}</pre>
      <${Button} onClick=${() => navigator.clipboard?.writeText(key)}>Kopyala</${Button}>
    </${Modal}>`}
    ${add && html`<${Modal} title="Yeni bağlantı" onClose=${() => setAdd(false)}>
      <${Form} fields=${[
        { name: 'code', label: 'Kod', required: true },
        { name: 'name', label: 'Ad', required: true },
        { name: 'kind', label: 'Tür', type: 'select', options: [['rest_api', 'REST API (olay gönderimi)'], ['webhook', 'Webhook'], ['provider_api', 'Servis sağlayıcı API'], ['csv', 'CSV'], ['database', 'Veritabanı (salt okunur)'], ['manual', 'Manuel']], required: true },
      ]} onCancel=${() => setAdd(false)} onSubmit=${async (v) => (await act(() => post('/api/integrations', v), 'Bağlantı eklendi')) && (setAdd(false), s.reload())} />
    </${Modal}>`}
  </${Page}>`;
}

// ---- users & roles -----------------------------------------------------------------------
export function Users() {
  const { meta, user } = useApp();
  const s = useApi('/api/users');
  const agencies = useApi('/api/agencies?limit=500');
  const [edit, setEdit] = useState(null);
  const [role, setRole] = useState(null);
  return html`<${Page} title="Kullanıcılar ve roller" actions=${html`<${Button} kind="primary" onClick=${() => setEdit({})}>Kullanıcı ekle</${Button}><${Button} onClick=${() => setRole({})}>Rol ekle</${Button}>`}>
    <${Loading} state=${s}>${(d) => html`
      <${Card} title="Kullanıcılar">
        <${Table} onRow=${(u) => setEdit(u)} columns=${[{ key: 'name', label: 'Ad' }, { key: 'email', label: 'E-posta' }, { key: 'role', label: 'Rol' }, { key: 'agency_id', label: 'Ajans' }, { key: 'mfa', label: '2FA', render: (u) => (u.mfa ? 'Açık' : '—') }, { key: 'active', label: 'Durum', render: (u) => html`<${Badge} s=${u.active ? 'active' : 'passive'} />` }]} rows=${d.rows} />
      </${Card}>
      <${Card} title="Roller">
        <${Table} onRow=${(r) => r.key !== 'super_admin' && setRole(r)} columns=${[{ key: 'name', label: 'Rol' }, { key: 'scope', label: 'Kapsam', render: (r) => (r.scope === 'agency' ? 'Kendi ajansı' : 'Platform') }, { key: 'permissions', label: 'Yetkiler', render: (r) => html`<span style="white-space:normal">${r.permissions.length} yetki</span>` }, { key: 'system', label: '', render: (r) => (r.system ? html`<${Badge} s="info" label="Sistem" />` : '') }]} rows=${d.roles} />
      </${Card}>
      ${edit && html`<${Modal} title=${edit.id ? 'Kullanıcıyı düzenle' : 'Yeni kullanıcı'} onClose=${() => setEdit(null)}>
        <${Form}
          fields=${[
            ...(edit.id ? [] : [{ name: 'email', label: 'E-posta', required: true }]),
            { name: 'name', label: 'Ad', required: true },
            { name: 'role_id', label: 'Rol', type: 'select', required: true, options: d.roles.map((r) => [String(r.id), r.name]) },
            { name: 'agency_id', label: 'Ajans (ajans kapsamlı rol için)', type: 'select', options: (agencies.data?.rows ?? []).map((a) => [String(a.id), a.name]) },
            { name: 'password', label: edit.id ? 'Yeni parola (boş = değişmez)' : 'Geçici parola (en az 10 karakter)', type: 'password', required: !edit.id },
            ...(edit.id ? [{ name: 'reset_mfa', label: '2FA sıfırla', type: 'checkbox' }, { name: 'active', label: 'Aktif', type: 'checkbox' }] : []),
          ]}
          initial=${edit.id ? { name: edit.name, role_id: String(edit.role_id), agency_id: edit.agency_id ? String(edit.agency_id) : '', active: !!edit.active } : {}}
          onCancel=${() => setEdit(null)}
          onSubmit=${async (v) => {
            const body = { ...v, role_id: Number(v.role_id), agency_id: v.agency_id ? Number(v.agency_id) : null };
            if (!body.password) delete body.password;
            if (edit.id && edit.id === user.id) (delete body.active, delete body.role_id);
            (await act(() => (edit.id ? put(`/api/users/${edit.id}`, body) : post('/api/users', body)), 'Kaydedildi')) && (setEdit(null), s.reload());
          }}
        />
      </${Modal}>`}
      ${role && html`<${RoleEditor} role=${role} perms=${meta.permissions} onClose=${() => setRole(null)} onSaved=${() => (setRole(null), s.reload())} />`}
    `}</${Loading}>
  </${Page}>`;
}

function RoleEditor({ role, perms, onClose, onSaved }) {
  const [v, setV] = useState({ key: role.key ?? '', name: role.name ?? '', scope: role.scope ?? 'platform', permissions: new Set(role.permissions ?? []) });
  return html`<${Modal} title=${role.id ? `${role.name} yetkileri` : 'Yeni rol'} wide onClose=${onClose}>
    <div class="form"><div class="grid2">
      ${!role.id && html`<label class="field"><span>Anahtar</span><input value=${v.key} onInput=${(e) => setV({ ...v, key: e.target.value })} /></label>`}
      <label class="field"><span>Ad</span><input value=${v.name} onInput=${(e) => setV({ ...v, name: e.target.value })} /></label>
      ${!role.id && html`<label class="field"><span>Kapsam</span><select value=${v.scope} onChange=${(e) => setV({ ...v, scope: e.target.value })}><option value="platform">Platform</option><option value="agency">Yalnız kendi ajansı</option></select></label>`}
    </div></div>
    <div class="grid cols2" style="margin-top:10px">${Object.entries(perms).map(([k, label]) => html`<label class="field inline"><span>${label} <code class="muted">${k}</code></span><input type="checkbox" checked=${v.permissions.has(k)} onChange=${(e) => {
      const p = new Set(v.permissions);
      e.target.checked ? p.add(k) : p.delete(k);
      setV({ ...v, permissions: p });
    }} /></label>`)}</div>
    <div class="row end gap"><${Button} onClick=${onClose}>Vazgeç</${Button}><${Button} kind="primary" onClick=${async () => {
      const body = { ...v, permissions: [...v.permissions] };
      (await act(() => (role.id ? put(`/api/roles/${role.id}`, body) : post('/api/roles', body)), 'Rol kaydedildi')) && onSaved();
    }}>Kaydet</${Button}></div>
  </${Modal}>`;
}

// ---- audit -------------------------------------------------------------------------------
export function Audit() {
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const s = useApi(`/api/audit${qs({ q, limit: 100, offset })}`);
  const [verify, setVerify] = useState(null);
  return html`<${Page} title="Denetim kaydı" subtitle="Her kritik değişiklik kullanıcı, zaman, önceki ve yeni değerle zincirleme özetli (hash) olarak tutulur; kayıtlar değiştirilemez ve silinemez." actions=${html`<input placeholder="İşlem / kullanıcı ara" value=${q} onChange=${(e) => (setQ(e.target.value), setOffset(0))} /><${Button} onClick=${async () => setVerify(await act(() => fetch('/api/audit/verify').then((r) => r.json())))}>Zinciri doğrula</${Button}>`}>
    ${verify && html`<div class=${`note ${verify.ok ? '' : 'bad'}`}>${verify.ok ? `Zincir bütün: ${verify.count} kayıt doğrulandı.` : `Zincir #${verify.brokenAt} numaralı kayıtta bozuk!`}</div>`}
    <${Loading} state=${s}>${(d) => html`
      <${Table} dense columns=${[
        { key: 'id', label: '#' }, { key: 'at', label: 'Zaman', render: (r) => dateTimeTr(r.at) }, { key: 'actor', label: 'Kullanıcı' }, { key: 'action', label: 'İşlem' },
        { key: 'entity', label: 'Kayıt', render: (r) => `${r.entity}${r.entity_id ? ` #${r.entity_id}` : ''}` }, { key: 'reason', label: 'Gerekçe' },
        { key: 'diff', label: 'Önce → sonra', render: (r) => (r.before || r.after ? html`<details><summary>göster</summary><pre>${r.before ?? '—'}\n→\n${r.after ?? '—'}</pre></details>` : '') },
      ]} rows=${d.rows} />
      <div class="row gap end"><${Button} disabled=${offset === 0} onClick=${() => setOffset(Math.max(0, offset - 100))}>Önceki</${Button}><span class="muted">${offset + 1}–${offset + d.rows.length} / ${d.total}</span><${Button} disabled=${offset + 100 >= d.total} onClick=${() => setOffset(offset + 100)}>Sonraki</${Button}></div>
    `}</${Loading}>
  </${Page}>`;
}

// ---- settings ------------------------------------------------------------------------------
export function Settings() {
  const { can, meta, reloadMeta } = useApp();
  const [tab, setTab] = useState('general');
  const edit = can('settings.edit');
  const list = (p) => useApi(tab === p ? `/api/${p}` : null);
  const rates = list('rates');
  const valuations = list('valuations');
  const taxes = list('taxes');
  const periods = list('periods');
  const [form, setForm] = useState(null);
  const fiat = meta.currencies.filter((c) => c.kind === 'fiat').map((c) => c.code);
  const forms = {
    rates: { title: 'Kur ekle', fields: [{ name: 'base', label: 'Kaynak', type: 'select', options: fiat, required: true, def: 'USD' }, { name: 'quote', label: 'Hedef', type: 'select', options: fiat, required: true, def: 'TRY' }, { name: 'rate', label: '1 kaynak = ? hedef', type: 'decimal', required: true }, { name: 'valid_from', label: 'Geçerlilik', type: 'date', required: true, def: today() }, { name: 'source', label: 'Kaynak (TCMB, banka…)' }], reload: rates },
    valuations: { title: 'Sanal birim değeri', fields: [{ name: 'unit', label: 'Birim', type: 'select', options: meta.currencies.filter((c) => c.kind === 'virtual').map((c) => c.code), required: true }, { name: 'currency', label: 'Para birimi', type: 'select', options: fiat, required: true, def: meta.reporting_currency }, { name: 'value_per_unit', label: '1 birimin değeri', type: 'decimal', required: true }, { name: 'purpose', label: 'Amaç', type: 'select', options: [['revenue', 'Gelir karşılığı (komisyon matrahı)'], ['payout', 'Ödeme/ekonomik maliyet karşılığı']], required: true }, { name: 'valid_from', label: 'Geçerlilik', type: 'date', required: true, def: today() }, { name: 'note', label: 'Not', wide: true }], reload: valuations },
    taxes: { title: 'Vergi parametresi', fields: [{ name: 'name', label: 'Ad', required: true, def: 'KDV' }, { name: 'applies_to', label: 'Uygulama (purchase, purchase:<kanal>)', required: true, def: 'purchase' }, { name: 'percent', label: 'Oran %', type: 'decimal', required: true }, { name: 'inclusive', label: 'Brüt tutarın içinde', type: 'checkbox', def: true }, { name: 'valid_from', label: 'Geçerlilik', type: 'date', required: true, def: today() }], reload: taxes },
    periods: { title: 'Finansal dönem', fields: [{ name: 'starts_on', label: 'Başlangıç', type: 'date', required: true }, { name: 'ends_on', label: 'Bitiş', type: 'date', required: true }], reload: periods },
  };
  return html`<${Page} title="Ayarlar ve referans verileri">
    <${Tabs} tabs=${[['general', 'Genel'], ['rates', 'Döviz kurları'], ['valuations', 'Jeton/elmas değeri'], ['taxes', 'Vergi'], ['periods', 'Finansal dönemler']]} value=${tab} onChange=${setTab} />
    ${tab === 'general' && html`<div class="grid cols2">
      <${Card} title="Genel">
        <${Form}
          fields=${[
            { name: 'company_name', label: 'Şirket adı' },
            { name: 'reporting_currency', label: 'Raporlama para birimi', type: 'select', options: fiat, required: true },
            { name: 'dual_control', label: 'Kritik işlemlerde çift onay (önerilir)', type: 'checkbox' },
          ]}
          initial=${{ company_name: meta.settings.company_name ?? '', reporting_currency: meta.reporting_currency, dual_control: meta.settings.dual_control === '1' }}
          onSubmit=${async (v) => edit && (await act(() => put('/api/settings', { ...v, dual_control: v.dual_control ? '1' : '0' }), 'Ayarlar kaydedildi')) && reloadMeta()}
        />
      </${Card}>
      <${Card} title="Para birimleri">
        <${Table} dense columns=${[{ key: 'code', label: 'Kod' }, { key: 'name', label: 'Ad' }, { key: 'decimals', label: 'Ondalık', align: 'right' }, { key: 'kind', label: 'Tür', render: (c) => (c.kind === 'fiat' ? 'Para' : 'Sanal') }]} rows=${meta.currencies} />
        ${edit && html`<div class="row end"><${Button} onClick=${() => setForm('currency')}>Para birimi ekle</${Button}></div>`}
        ${edit && html`<h3>Yedekleme</h3><p class="muted">Tutarlı bir anlık kopya alır (VACUUM INTO). Geri yükleme için: npm run restore -- dosya.db</p><${Button} onClick=${() => act(() => post('/api/admin/backup'), (r) => `Yedek: ${r.file}`)}>Şimdi yedekle</${Button}>`}
      </${Card}>
    </div>`}
    ${tab === 'rates' && html`<${Card} title="Döviz kurları" actions=${edit && html`<${Button} onClick=${() => setForm('rates')}>Kur ekle</${Button}>`}><p class="muted">Her işlem kendi tarihindeki kurla çevrilir; ters yönde kur yoksa ters oran kullanılır. Eksik kur raporlarda belirtilir.</p><${Loading} state=${rates}>${(d) => html`<${Table} dense columns=${[{ key: 'valid_from', label: 'Tarih', render: (r) => dateTr(r.valid_from) }, { key: 'pair', label: 'Parite', render: (r) => `${r.base}/${r.quote}` }, { key: 'rate', label: 'Kur', align: 'right' }, { key: 'source', label: 'Kaynak' }]} rows=${d.rows} />`}</${Loading}></${Card}>`}
    ${tab === 'valuations' && html`<${Card} title="Sanal birim değerleri" actions=${edit && html`<${Button} onClick=${() => setForm('valuations')}>Değer ekle</${Button}>`}><div class="note">"Gelir karşılığı", jeton harcamasının komisyon matrahındaki parasal değeridir (örn. 1 jeton = 0,10 TRY). "Ödeme karşılığı", Lucky ödül jetonları gibi kalemlerin bilgi amaçlı ekonomik değeridir.</div><${Loading} state=${valuations}>${(d) => html`<${Table} dense columns=${[{ key: 'valid_from', label: 'Tarih', render: (r) => dateTr(r.valid_from) }, { key: 'unit', label: 'Birim' }, { key: 'value_per_unit', label: 'Değer', align: 'right', render: (r) => `${r.value_per_unit} ${r.currency}` }, { key: 'purpose', label: 'Amaç' }, { key: 'note', label: 'Not' }]} rows=${d.rows} />`}</${Loading}></${Card}>`}
    ${tab === 'taxes' && html`<${Card} title="Vergi parametreleri" actions=${edit && html`<${Button} onClick=${() => setForm('taxes')}>Ekle</${Button}>`}><p class="muted">Sistem yalnız yapılandırılabilir hesaplama sağlar; vergi sınıflandırması ve mevzuata uygunluk ayrıca doğrulanmalıdır.</p><${Loading} state=${taxes}>${(d) => html`<${Table} dense columns=${[{ key: 'name', label: 'Ad' }, { key: 'applies_to', label: 'Uygulama' }, { key: 'percent', label: '%', align: 'right' }, { key: 'inclusive', label: 'Brüt içinde', render: (r) => (r.inclusive ? 'Evet' : 'Hayır') }, { key: 'valid', label: 'Geçerlilik', render: (r) => `${dateTr(r.valid_from)} → ${r.valid_to ? dateTr(r.valid_to) : 'süresiz'}` }]} rows=${d.rows} />`}</${Loading}></${Card}>`}
    ${tab === 'periods' && html`<${Card} title="Finansal dönemler" actions=${can('periods.close') && html`<${Button} onClick=${() => setForm('periods')}>Dönem ekle</${Button}>`}><p class="muted">Kapalı döneme tarihli yeni olaylar ilk açık güne kaydedilir; geçmiş dönem sonuçları değişmez. Kapatma için çözülmemiş hesaplama sorunu ve onaylanmamış hakediş kalmamalıdır.</p><${Loading} state=${periods}>${(d) => html`<${Table} dense columns=${[{ key: 'starts_on', label: 'Başlangıç', render: (r) => dateTr(r.starts_on) }, { key: 'ends_on', label: 'Bitiş', render: (r) => dateTr(r.ends_on) }, { key: 'status', label: 'Durum', render: (r) => html`<${Badge} s=${r.status} />` }, { key: 'closed_at', label: 'Kapatıldı', render: (r) => dateTimeTr(r.closed_at) }, { key: 'a', label: '', render: (r) => r.status === 'open' && can('periods.close') && html`<${Button} onClick=${async () => (await act(() => post(`/api/periods/${r.id}/close`), (x) => (x.status === 'pending' ? 'Kapatma onaya gönderildi' : 'Dönem kapatıldı'))) && periods.reload()}>Kapat</${Button}>` }]} rows=${d.rows} />`}</${Loading}></${Card}>`}
    ${form && form !== 'currency' && html`<${Modal} title=${forms[form].title} onClose=${() => setForm(null)}><${Form} fields=${forms[form].fields} onCancel=${() => setForm(null)} onSubmit=${async (v) => (await act(() => post(`/api/${form}`, v), 'Kaydedildi')) && (setForm(null), forms[form].reload.reload())} /></${Modal}>`}
    ${form === 'currency' && html`<${Modal} title="Para birimi ekle" onClose=${() => setForm(null)}><${Form} fields=${[{ name: 'code', label: 'Kod', required: true }, { name: 'name', label: 'Ad', required: true }, { name: 'decimals', label: 'Ondalık basamak', type: 'number', required: true, def: '2' }, { name: 'kind', label: 'Tür', type: 'select', options: [['fiat', 'Gerçek para'], ['virtual', 'Sanal birim']], required: true }]} onCancel=${() => setForm(null)} onSubmit=${async (v) => (await act(() => post('/api/currencies', { ...v, decimals: Number(v.decimals) }), 'Eklendi')) && (setForm(null), reloadMeta())} /></${Modal}>`}
  </${Page}>`;
}

// ---- own account ---------------------------------------------------------------------------
export function Account() {
  const { user } = useApp();
  const [mfa, setMfa] = useState(null);
  return html`<${Page} title="Hesabım">
    <div class="grid cols2">
      <${Card} title="Parola değiştir">
        <${Form} fields=${[{ name: 'current', label: 'Mevcut parola', type: 'password', required: true, wide: true }, { name: 'password', label: 'Yeni parola (en az 10 karakter)', type: 'password', required: true, wide: true }]} onSubmit=${async (v) => (await act(() => post('/api/auth/password', v), 'Parola değişti; tekrar giriş yapın')) && location.reload()} />
      </${Card}>
      <${Card} title="İki adımlı doğrulama (TOTP)">
        <p class="muted">${user.email} · ${user.role_name}</p>
        ${!mfa && html`<${Button} onClick=${async () => setMfa(await act(() => post('/api/auth/mfa/setup')))}>Kurulumu başlat</${Button}>`}
        ${mfa && html`<p>Doğrulayıcı uygulamaya bu anahtarı ekleyin:</p><pre>${mfa.secret}</pre><p class="muted">veya bağlantı: <code>${mfa.otpauth}</code></p>
          <${Form} fields=${[{ name: 'code', label: 'Uygulamadaki 6 haneli kod', required: true }]} submitLabel="Etkinleştir" onSubmit=${async (v) => (await act(() => post('/api/auth/mfa/confirm', { secret: mfa.secret, code: v.code }), '2FA etkin')) && setMfa(null)} />`}
      </${Card}>
    </div>
  </${Page}>`;
}
