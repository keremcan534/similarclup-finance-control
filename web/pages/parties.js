import { Badge, Button, Card, DateRange, Form, Loading, Modal, Page, Table, act, dateTr, decMoney, html, minorToInput, money, monthStart, num, post, put, qs, today, useApi, useApp, usePrompt, useState } from '../lib.js';

const CFG = {
  agency: {
    title: 'Ajanslar',
    api: 'agencies',
    fields: (bds) => [
      { name: 'code', label: 'Ajans kodu', required: true },
      { name: 'name', label: 'Ajans adı', required: true },
      { name: 'contact_name', label: 'Yetkili kişi' },
      { name: 'contact_email', label: 'Yetkili e-posta' },
      { name: 'bd_id', label: 'Bağlı BD', type: 'select', options: bds.map((b) => [String(b.id), `${b.code} · ${b.name}`]) },
      { name: 'status', label: 'Durum', type: 'select', options: [['active', 'Aktif'], ['passive', 'Pasif']], required: true, def: 'active' },
    ],
    columns: [
      { key: 'code', label: 'Kod' },
      { key: 'name', label: 'Ad' },
      { key: 'contact_name', label: 'Yetkili' },
      { key: 'bd_id', label: 'BD' },
      { key: 'status', label: 'Durum', render: (r) => html`<${Badge} s=${r.status} />` },
    ],
  },
  bd: {
    title: 'İş geliştirme (BD)',
    api: 'bds',
    fields: () => [
      { name: 'code', label: 'BD kodu', required: true },
      { name: 'name', label: 'Ad soyad', required: true },
      { name: 'email', label: 'E-posta' },
      { name: 'status', label: 'Durum', type: 'select', options: [['active', 'Aktif'], ['passive', 'Pasif']], required: true, def: 'active' },
    ],
    columns: [
      { key: 'code', label: 'Kod' },
      { key: 'name', label: 'Ad' },
      { key: 'email', label: 'E-posta' },
      { key: 'status', label: 'Durum', render: (r) => html`<${Badge} s=${r.status} />` },
    ],
  },
  publisher: {
    title: 'Yayıncılar',
    api: 'publishers',
    fields: (_bds, agencies) => [
      { name: 'external_id', label: 'Similar Club kullanıcı id', required: true },
      { name: 'name', label: 'Ad', required: true },
      { name: 'agency_id', label: 'Ajans', type: 'select', options: agencies.map((a) => [String(a.id), `${a.code} · ${a.name}`]) },
      { name: 'status', label: 'Durum', type: 'select', options: [['active', 'Aktif'], ['passive', 'Pasif'], ['unmapped', 'Eşleşmemiş']], required: true, def: 'active' },
    ],
    columns: [
      { key: 'external_id', label: 'Similar Club id' },
      { key: 'name', label: 'Ad' },
      { key: 'agency_id', label: 'Ajans' },
      { key: 'status', label: 'Durum', render: (r) => html`<${Badge} s=${r.status} />` },
    ],
  },
};

export function Parties({ type }) {
  const { can } = useApp();
  const cfg = CFG[type];
  const [q, setQ] = useState('');
  const s = useApi(`/api/${cfg.api}${qs({ q, limit: 500 })}`);
  const bds = useApi(type === 'agency' && can('parties.edit') ? '/api/bds?limit=500' : null);
  const agencies = useApi(type === 'publisher' ? '/api/agencies?limit=500' : null);
  const [edit, setEdit] = useState(null);
  const [open, setOpen] = useState(null);
  const agencyName = (id) => agencies.data?.rows.find((a) => a.id === id)?.name ?? id;
  const columns = cfg.columns.map((c) => (c.key === 'agency_id' ? { ...c, render: (r) => (r.agency_id ? agencyName(r.agency_id) : html`<span class="muted">Ajanssız</span>`) } : c));
  return html`<${Page}
    title=${cfg.title}
    actions=${html`<input placeholder="Ara" value=${q} onChange=${(e) => setQ(e.target.value)} />${can('parties.edit') && html`<${Button} kind="primary" onClick=${() => setEdit({})}>Yeni</${Button}>`}`}
  >
    ${type === 'publisher' && html`<div class="note">Yayıncılar Similar Club kullanıcı id’siyle eşleşir. Entegrasyonda tanınmayan bir id gelirse "Eşleşmemiş" olarak açılır; ajansını atayın.</div>`}
    <${Loading} state=${s}>${(d) => html`<${Table} columns=${columns} rows=${d.rows} onRow=${(r) => setOpen(r)} />`}</${Loading}>
    ${edit && html`<${Modal} title=${edit.id ? 'Düzenle' : 'Yeni kayıt'} onClose=${() => setEdit(null)}>
      <${Form}
        fields=${cfg.fields(bds.data?.rows ?? [], agencies.data?.rows ?? []).map((f) => (edit.id && ['code', 'external_id'].includes(f.name) ? { ...f, hint: 'Değiştirilemez' } : f))}
        initial=${edit.id ? Object.fromEntries(Object.entries(edit).map(([k, v]) => [k, v === null ? '' : String(v)])) : {}}
        onCancel=${() => setEdit(null)}
        onSubmit=${async (v) => {
          const body = { ...v };
          for (const k of ['bd_id', 'agency_id']) if (k in body) body[k] = body[k] ? Number(body[k]) : null;
          if (edit.id) for (const k of ['code', 'external_id']) delete body[k];
          const r = await act(() => (edit.id ? put(`/api/${cfg.api}/${edit.id}`, body) : post(`/api/${cfg.api}`, body)), 'Kaydedildi');
          if (r) (setEdit(null), s.reload());
        }}
      />
    </${Modal}>`}
    ${open && html`<${PartyDetail} type=${type} party=${open} onClose=${() => setOpen(null)} onEdit=${() => (setEdit(open), setOpen(null))} />`}
  </${Page}>`;
}

function PartyDetail({ type, party, onClose, onEdit }) {
  const { can, meta } = useApp();
  const [range, setRange] = useState({ from: monthStart(), to: today() });
  const f = useApi(`/api/parties/${type}/${party.id}/finance${qs(range)}`);
  const contracts = useApi(`/api/contracts${qs({ party_type: type, party_id: party.id })}`);
  const [newContract, setNewContract] = useState(false);
  const [ask, prompt] = usePrompt();
  const endContract = async (c) => {
    const r = await ask('Sözleşmeyi bitir', { fields: [{ name: 'ends_on', label: 'Bitiş tarihi', type: 'date', required: true }, { name: 'reason', label: 'Gerekçe', type: 'textarea', required: true, wide: true }] });
    if (r && (await act(() => post(`/api/contracts/${c.id}/end`, r), 'Sözleşme sonlandırıldı'))) contracts.reload();
  };
  return html`<${Modal} title=${`${party.code ?? party.external_id} · ${party.name}`} wide onClose=${onClose}>
    <div class="row between wrap gap"><${DateRange} value=${range} onChange=${setRange} />${can('parties.edit') && html`<${Button} onClick=${onEdit}>Bilgileri düzenle</${Button}>`}</div>
    <${Loading} state=${f}>${(d) => html`
      <div class="kpis" style="margin-top:12px">
        <div class="kpi"><span class="kpi-l">Uygun gelir</span><strong class="kpi-v">${decMoney(d.variables.eligible_revenue, d.currency)}</strong></div>
        <div class="kpi"><span class="kpi-l">Dönem hakedişi (hesaplanan)</span><strong class="kpi-v">${money(d.total_minor, d.currency)}</strong></div>
        <div class="kpi"><span class="kpi-l">Ödenen (tüm dönemler)</span><strong class="kpi-v">${money(d.paid_minor, d.currency)}</strong></div>
        <div class="kpi"><span class="kpi-l">Bekleyen (onaylı)</span><strong class="kpi-v">${money(d.pending_minor, d.currency)}</strong></div>
        <div class="kpi"><span class="kpi-l">İtiraz edilen</span><strong class="kpi-v">${money(d.disputed_minor, d.currency)}</strong></div>
        ${type === 'agency' && html`
          <div class="kpi"><span class="kpi-l">Yayıncılara ayrılan</span><strong class="kpi-v">${money(d.publisher_share_minor, d.currency)}</strong></div>
          <div class="kpi"><span class="kpi-l">BD payı</span><strong class="kpi-v">${money(d.bd_share_minor, d.currency)}</strong></div>
          <div class="kpi"><span class="kpi-l">Hediye gönderen kullanıcı</span><strong class="kpi-v">${num(d.users_paying)}</strong></div>
          <div class="kpi"><span class="kpi-l">Şirkete net katkı</span><strong class=${`kpi-v ${BigInt(d.net_contribution_minor) < 0n ? 'bad' : ''}`}>${money(d.net_contribution_minor, d.currency)}</strong></div>`}
      </div>
      <div class="grid cols2">
        <${Card} title="Bu dönemin hakediş önizlemesi">
          <${Table} dense columns=${[{ key: 'kind', label: 'Kalem' }, { key: 'description', label: 'Açıklama' }, { key: 'amount_minor', label: 'Tutar', money: d.currency }]} rows=${d.lines} empty="Bu dönemde kalem yok" />
          ${d.notes.map((n) => html`<p class="muted">${n}</p>`)}
        </${Card}>
        <${Card} title="Dönem göstergeleri">
          <dl class="kv">${Object.entries(d.variables).map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>
        </${Card}>
      </div>
      <${Card} title="Hakediş geçmişi">
        <${Table} dense columns=${[{ key: 'period', label: 'Dönem', render: (s) => `${dateTr(s.period_start)} – ${dateTr(s.period_end)}` }, { key: 'status', label: 'Durum', render: (s) => html`<${Badge} s=${s.status} />` }, { key: 'total_minor', label: 'Toplam', money: 'currency' }, { key: 'paid_minor', label: 'Ödenen', money: 'currency' }, { key: 'disputed_minor', label: 'İtiraz', money: 'currency' }]} rows=${d.statements} />
      </${Card}>
    `}</${Loading}>
    <${Card} title="Sözleşmeler" actions=${can('parties.edit') && html`<${Button} onClick=${() => setNewContract(true)}>Yeni sözleşme</${Button}>`}>
      <p class="muted">Sözleşme tutarları yerinde değiştirilmez; yeni koşullar yeni sözleşmeyle başlar ve öncekini bir gün önce bitirir.</p>
      <${Loading} state=${contracts}>${(d) => html`<${Table} dense columns=${[
        { key: 'kind', label: 'Tür' },
        { key: 'starts_on', label: 'Başlangıç', render: (c) => dateTr(c.starts_on) },
        { key: 'ends_on', label: 'Bitiş', render: (c) => dateTr(c.ends_on) },
        { key: 'fixed_salary_minor', label: 'Sabit maaş', money: 'currency' },
        { key: 'min_guarantee_minor', label: 'Minimum garanti', money: 'currency' },
        { key: 'payment_schedule', label: 'Ödeme', render: (c) => (c.payment_schedule === 'weekly' ? 'Haftalık' : 'Aylık') },
        { key: 'terms', label: 'Koşullar', render: (c) => html`<code>${c.terms}</code>` },
        { key: 'status', label: 'Durum', render: (c) => html`<${Badge} s=${c.status} />` },
        { key: 'a', label: '', render: (c) => can('parties.edit') && c.status === 'active' && html`<${Button} onClick=${() => endContract(c)}>Bitir</${Button}>` },
      ]} rows=${d.rows} empty="Sözleşme yok" />`}</${Loading}>
    </${Card}>
    ${newContract && html`<${Modal} title="Yeni sözleşme" onClose=${() => setNewContract(false)}>
      <div class="note">Komisyon oranları sözleşmeye değil Komisyon kuralları ekranına girilir (kural filtreleriyle bu tarafa özel oran tanımlanabilir). Burada maaş, garanti ve ödeme takvimi tutulur.</div>
      <${Form}
        fields=${[
          { name: 'kind', label: 'Sözleşme türü', required: true, def: 'standart' },
          { name: 'currency', label: 'Para birimi', type: 'select', options: meta.currencies.filter((c) => c.kind === 'fiat').map((c) => c.code), required: true, def: meta.reporting_currency },
          { name: 'fixed_salary', label: 'Sabit maaş (dönem başına)', type: 'money' },
          { name: 'min_guarantee', label: 'Minimum garanti', type: 'money' },
          { name: 'payment_schedule', label: 'Ödeme takvimi', type: 'select', options: [['monthly', 'Aylık'], ['weekly', 'Haftalık']], required: true, def: 'monthly' },
          { name: 'starts_on', label: 'Başlangıç', type: 'date', required: true },
          { name: 'ends_on', label: 'Bitiş', type: 'date' },
          { name: 'terms', label: 'Diğer koşullar (hedefler, kesinti kuralları)', type: 'textarea', wide: true },
        ]}
        onCancel=${() => setNewContract(false)}
        onSubmit=${async (v) => {
          const r = await act(() => post('/api/contracts', { ...v, party_type: type, party_id: party.id, terms: v.terms ? { not: v.terms } : {} }), 'Sözleşme eklendi');
          if (r) (setNewContract(false), contracts.reload(), f.reload());
        }}
      />
    </${Modal}>`}
    ${prompt}
  </${Modal}>`;
}

export { minorToInput };
