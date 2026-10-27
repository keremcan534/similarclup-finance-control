import { Badge, Button, Card, Form, Loading, Modal, Page, Table, Tabs, act, dateTimeTr, html, post, put, useApi, useApp, useState } from '../lib.js';

export function Alerts() {
  const { can, meta } = useApp();
  const [tab, setTab] = useState('open');
  const s = useApi(tab === 'rules' ? null : `/api/alerts?status=${tab}`);
  const rules = useApi(tab === 'rules' ? '/api/alert-rules' : null);
  const [edit, setEdit] = useState(null);
  const kinds = meta.alert_kinds;
  return html`<${Page}
    title="Uyarılar ve otomatik kontroller"
    subtitle="Eşikler ve önem dereceleri buradan yönetilir. Kontroller her açılışta veya 'Şimdi kontrol et' ile çalışır."
    actions=${html`<${Button} kind="primary" onClick=${async () => (await act(() => post('/api/alerts/evaluate'), (r) => `${r.created} yeni uyarı${r.errors.length ? ` · ${r.errors.length} kontrol hata verdi` : ''}`)) && s.reload()}>Şimdi kontrol et</${Button}>`}
  >
    <${Tabs} tabs=${[['open', 'Açık'], ['acknowledged', 'Görüldü'], ['resolved', 'Çözüldü'], ['rules', 'Eşikler']]} value=${tab} onChange=${setTab} />
    ${tab !== 'rules' && html`<${Loading} state=${s}>${(d) => html`<${Table} columns=${[
      { key: 'severity', label: 'Önem', render: (a) => html`<${Badge} s=${a.severity} />` },
      { key: 'kind', label: 'Tür', render: (a) => kinds[a.kind]?.label ?? a.kind },
      { key: 'message', label: 'Mesaj' },
      { key: 'ref', label: 'İlgili kayıt' },
      { key: 'suggested_action', label: 'Önerilen aksiyon' },
      { key: 'created_at', label: 'Zaman', render: (a) => dateTimeTr(a.created_at) },
      { key: 'act', label: '', render: (a) => html`<div class="row gap">${a.status === 'open' && html`<${Button} onClick=${async () => (await act(() => post(`/api/alerts/${a.id}/acknowledge`), 'Görüldü')) && s.reload()}>Görüldü</${Button}>`}${a.status !== 'resolved' && html`<${Button} onClick=${async () => (await act(() => post(`/api/alerts/${a.id}/resolve`), 'Çözüldü')) && s.reload()}>Çözüldü</${Button}>`}</div>` },
    ]} rows=${d.rows} empty="Uyarı yok" />`}</${Loading}>`}
    ${tab === 'rules' && html`<${Card} title="Eşikler" actions=${can('alerts.manage') && html`<${Button} onClick=${() => setEdit({})}>Eşik ekle</${Button}>`}>
      <p class="muted">Tutar eşikleri ${meta.reporting_currency} cinsindendir. E-posta bildirimi için SMTP entegrasyonu gerekir; tanımlı değilse uyarılar yalnız panelde görünür.</p>
      <${Loading} state=${rules}>${(d) => html`<${Table} onRow=${can('alerts.manage') ? (r) => setEdit(r) : undefined} columns=${[
        { key: 'name', label: 'Ad' },
        { key: 'kind', label: 'Tür', render: (r) => kinds[r.kind]?.label ?? r.kind },
        { key: 'params', label: 'Parametreler', render: (r) => Object.entries(r.params).map(([k, v]) => `${k}=${v}`).join(', ') },
        { key: 'severity', label: 'Önem', render: (r) => html`<${Badge} s=${r.severity} />` },
        { key: 'notify_email', label: 'E-posta' },
        { key: 'active', label: 'Durum', render: (r) => html`<${Badge} s=${r.active ? 'active' : 'passive'} />` },
      ]} rows=${d.rows} />`}</${Loading}>
    </${Card}>`}
    ${edit && html`<${Modal} title=${edit.id ? 'Eşiği düzenle' : 'Yeni eşik'} onClose=${() => setEdit(null)}>
      <${Form}
        fields=${[
          ...(edit.id ? [] : [{ name: 'kind', label: 'Tür', type: 'select', required: true, options: Object.entries(kinds).map(([k, v]) => [k, v.label]) }]),
          { name: 'name', label: 'Ad' },
          { name: 'limit', label: 'Tutar sınırı', type: 'decimal', show: (v) => (kinds[v.kind ?? edit.kind]?.params ?? []).includes('limit') },
          { name: 'provider', label: 'Sağlayıcı adı (boş = hepsi)', show: (v) => (kinds[v.kind ?? edit.kind]?.params ?? []).includes('provider') },
          { name: 'percent', label: 'Yüzde', type: 'decimal', show: (v) => (kinds[v.kind ?? edit.kind]?.params ?? []).includes('percent') },
          { name: 'hours', label: 'Saat', type: 'decimal', show: (v) => (kinds[v.kind ?? edit.kind]?.params ?? []).includes('hours') },
          { name: 'days', label: 'Gün', type: 'decimal', show: (v) => (kinds[v.kind ?? edit.kind]?.params ?? []).includes('days') },
          { name: 'units', label: 'Jeton eşiği', type: 'decimal', show: (v) => (kinds[v.kind ?? edit.kind]?.params ?? []).includes('units') },
          { name: 'severity', label: 'Önem', type: 'select', options: [['info', 'Bilgi'], ['warning', 'Uyarı'], ['critical', 'Kritik']], required: true, def: 'warning' },
          { name: 'notify_email', label: 'Bildirim e-postası' },
          ...(edit.id ? [{ name: 'active', label: 'Aktif', type: 'checkbox' }] : []),
        ]}
        initial=${edit.id ? { ...edit.params, name: edit.name, severity: edit.severity, notify_email: edit.notify_email ?? '', active: !!edit.active } : {}}
        onCancel=${() => setEdit(null)}
        onSubmit=${async (v) => {
          const kind = v.kind ?? edit.kind;
          const params = Object.fromEntries((kinds[kind]?.params ?? []).map((p) => [p, v[p]]).filter(([, x]) => x !== '' && x !== undefined));
          const body = { kind, name: v.name || undefined, params, severity: v.severity, notify_email: v.notify_email || null, active: v.active };
          (await act(() => (edit.id ? put(`/api/alert-rules/${edit.id}`, body) : post('/api/alert-rules', body)), 'Kaydedildi')) && (setEdit(null), rules.reload());
        }}
      />
    </${Modal}>`}
  </${Page}>`;
}
