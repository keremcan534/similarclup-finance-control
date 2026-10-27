import { Badge, Button, Card, DateRange, Form, Loading, Modal, Page, Table, Tabs, act, dateTr, html, money, monthStart, post, qs, today, useApi, useApp, usePrompt, useState } from '../lib.js';
import { Crud } from './costs.js';
import { CsvImport } from './ledger.js';

const fiat = (meta) => meta.currencies.filter((c) => c.kind === 'fiat').map((c) => c.code);

export function Expenses() {
  const { can, meta } = useApp();
  const [tab, setTab] = useState('list');
  const [range, setRange] = useState({ from: monthStart(), to: today() });
  const [status, setStatus] = useState('');
  const s = useApi(tab === 'list' ? `/api/expenses${qs({ ...range, status })}` : null);
  const cats = useApi('/api/expense_categories?limit=500');
  const [add, setAdd] = useState(false);
  const [csv, setCsv] = useState(false);
  const [ask, prompt] = usePrompt();
  const totals = (s.data?.rows ?? []).filter((e) => e.status !== 'cancelled').reduce((m, e) => ((m[e.currency] = (m[e.currency] ?? 0n) + BigInt(e.amount_minor) + BigInt(e.tax_minor)), m), {});
  return html`<${Page}
    title="Genel gider ve personel"
    subtitle="Giderler tahakkuk tarihine göre raporlanır; ödendiğinde nakit çıkışı olarak deftere yazılır. Silme yoktur, iptal gerekçeyle yapılır."
    actions=${can('expenses.edit') && html`
      <${Button} kind="primary" onClick=${() => setAdd(true)}>Gider ekle</${Button}>
      <${Button} onClick=${() => setCsv(true)}>CSV</${Button}>
      <${Button} onClick=${async () => (await act(() => post('/api/expenses/recurring/generate', { until: range.to }), (r) => `${r.created} tekrarlanan gider oluşturuldu`)) && s.reload()}>Tekrarlananları oluştur</${Button}>`}
  >
    <${Tabs} tabs=${[['list', 'Giderler'], ['categories', 'Kategoriler']]} value=${tab} onChange=${setTab} />
    ${tab === 'list' && html`
      <div class="row gap wrap" style="margin-bottom:10px">
        <${DateRange} value=${range} onChange=${setRange} />
        <select value=${status} onChange=${(e) => setStatus(e.target.value)} aria-label="Durum"><option value="">Tümü</option><option value="unpaid">Ödenmedi</option><option value="paid">Ödendi</option><option value="cancelled">İptal</option></select>
      </div>
      <div class="kpis">${Object.entries(totals).map(([c, v]) => html`<div class="kpi"><span class="kpi-l">Toplam (${c}, vergi dahil)</span><strong class="kpi-v">${money(v, c)}</strong></div>`)}</div>
      <${Loading} state=${s}>${(d) => html`<${Table} dense columns=${[
        { key: 'accrual_date', label: 'Tahakkuk', render: (e) => dateTr(e.accrual_date) },
        { key: 'category', label: 'Kategori' },
        { key: 'description', label: 'Açıklama' },
        { key: 'vendor', label: 'Tedarikçi / alıcı' },
        { key: 'nature', label: 'Nitelik', render: (e) => (e.nature === 'fixed' ? 'Sabit' : 'Değişken') },
        { key: 'amount_minor', label: 'Tutar', money: 'currency' },
        { key: 'tax_minor', label: 'Vergi', money: 'currency' },
        { key: 'due_date', label: 'Vade', render: (e) => dateTr(e.due_date) },
        { key: 'recurrence', label: 'Tekrar', render: (e) => ({ none: '', monthly: 'Aylık', yearly: 'Yıllık', days: `${e.recurrence_days} günde bir` })[e.recurrence] || (e.parent_id ? `#${e.parent_id}’den` : '') },
        { key: 'status', label: 'Durum', render: (e) => html`<${Badge} s=${e.status} />` },
        {
          key: 'a',
          label: '',
          render: (e) =>
            can('expenses.edit') && e.status === 'unpaid' && html`<div class="row gap">
              <${Button} onClick=${async () => {
                const r = await ask('Ödendi olarak işaretle', { fields: [{ name: 'paid_on', label: 'Ödeme tarihi', type: 'date', required: true, def: today() }], ok: 'Kaydet' });
                if (r && (await act(() => post(`/api/expenses/${e.id}/pay`, r), 'Ödendi'))) s.reload();
              }}>Öde</${Button}>
              <${Button} kind="danger" onClick=${async () => {
                const r = await ask('Gideri iptal et');
                if (r && (await act(() => post(`/api/expenses/${e.id}/cancel`, r), 'İptal edildi'))) s.reload();
              }}>İptal</${Button}>
            </div>`,
        },
      ]} rows=${d.rows} empty="Bu dönemde gider yok" />`}</${Loading}>`}
    ${tab === 'categories' && html`<${Crud} api="expense_categories" title="Gider kategorileri" canEdit=${can('expenses.edit')} columns=${[{ key: 'name', label: 'Ad' }, { key: 'nature', label: 'Varsayılan nitelik', render: (r) => (r.nature === 'fixed' ? 'Sabit' : 'Değişken') }, { key: 'active', label: 'Durum', render: (r) => html`<${Badge} s=${r.active ? 'active' : 'passive'} />` }]} fields=${[{ name: 'name', label: 'Ad', required: true }, { name: 'nature', label: 'Nitelik', type: 'select', options: [['fixed', 'Sabit'], ['variable', 'Değişken']], required: true, def: 'fixed' }, { name: 'active', label: 'Aktif', type: 'checkbox', def: true }]} />`}
    ${add && html`<${Modal} title="Gider ekle" onClose=${() => setAdd(false)}>
      <${Form}
        fields=${[
          { name: 'category_id', label: 'Kategori', type: 'select', required: true, options: (cats.data?.rows ?? []).filter((c) => c.active).map((c) => [String(c.id), c.name]) },
          { name: 'description', label: 'Açıklama', required: true },
          { name: 'vendor', label: 'Tedarikçi / alıcı' },
          { name: 'nature', label: 'Nitelik', type: 'select', options: [['fixed', 'Sabit'], ['variable', 'Değişken']] },
          { name: 'amount', label: 'Tutar (vergi hariç)', type: 'money', required: true },
          { name: 'tax', label: 'Vergi', type: 'money' },
          { name: 'currency', label: 'Para birimi', type: 'select', options: fiat(meta), required: true, def: meta.reporting_currency },
          { name: 'tx_date', label: 'İşlem tarihi', type: 'date', required: true, def: today() },
          { name: 'accrual_date', label: 'Tahakkuk tarihi (boş = işlem tarihi)', type: 'date' },
          { name: 'due_date', label: 'Vade', type: 'date' },
          { name: 'recurrence', label: 'Tekrarlama', type: 'select', options: [['none', 'Yok'], ['monthly', 'Aylık'], ['yearly', 'Yıllık'], ['days', 'Her N günde']], def: 'none', required: true },
          { name: 'recurrence_days', label: 'N (gün)', type: 'number', show: (v) => v.recurrence === 'days' },
          { name: 'recurrence_until', label: 'Tekrar bitişi', type: 'date', show: (v) => v.recurrence !== 'none' },
          { name: 'module', label: 'İlgili proje / modül' },
          { name: 'attachment_ref', label: 'Fatura / belge bağlantısı', wide: true },
        ]}
        onCancel=${() => setAdd(false)}
        onSubmit=${async (v) => (await act(() => post('/api/expenses', { ...v, category_id: Number(v.category_id), recurrence_days: v.recurrence_days ? Number(v.recurrence_days) : null }), 'Gider kaydedildi')) && (setAdd(false), s.reload())}
      />
    </${Modal}>`}
    ${csv && html`<${CsvImport} kinds=${['expenses']} onClose=${() => setCsv(false)} onDone=${s.reload} />`}
    ${prompt}
  </${Page}>`;
}

export function Cash() {
  const { can, meta } = useApp();
  const snaps = useApi('/api/cash/snapshots');
  const accounts = useApi('/api/cash_accounts?limit=100');
  const [add, setAdd] = useState(false);
  return html`<${Page} title="Nakit ve bütçe" subtitle="Mevcut nakit, banka hesaplarının girilen son bakiyesinden gelir. Bütçeler uyarı sistemine bağlıdır.">
    <div class="grid cols2">
      <${Crud} api="cash_accounts" title="Nakit hesapları" canEdit=${can('expenses.edit')} columns=${[{ key: 'name', label: 'Hesap' }, { key: 'currency', label: 'Para birimi' }, { key: 'active', label: 'Durum', render: (r) => html`<${Badge} s=${r.active ? 'active' : 'passive'} />` }]} fields=${[{ name: 'name', label: 'Hesap adı', required: true }, { name: 'currency', label: 'Para birimi', type: 'select', options: fiat(meta), required: true, immutable: true }, { name: 'active', label: 'Aktif', type: 'checkbox', def: true }]} />
      <${Card} title="Bakiye girişleri" actions=${can('expenses.edit') && html`<${Button} onClick=${() => setAdd(true)}>Bakiye gir</${Button}>`}>
        <${Loading} state=${snaps}>${(d) => html`<${Table} dense columns=${[{ key: 'as_of', label: 'Tarih', render: (r) => dateTr(r.as_of) }, { key: 'name', label: 'Hesap' }, { key: 'balance_minor', label: 'Bakiye', money: 'currency' }, { key: 'source', label: 'Kaynak' }]} rows=${d.rows} empty="Henüz bakiye girilmedi" />`}</${Loading}>
      </${Card}>
    </div>
    <${Crud}
      api="budgets"
      title="Bütçeler ve kâr hedefleri"
      canEdit=${can('alerts.manage')}
      note="Kapsam: toplam gider, bir gider kategorisi (kapsam id = kategori id) veya bir servis sağlayıcı (kapsam id = sağlayıcı id). Aşım 'Bütçe aşımı' uyarısını tetikler."
      columns=${[{ key: 'name', label: 'Ad' }, { key: 'period', label: 'Dönem' }, { key: 'scope_type', label: 'Kapsam', render: (r) => `${({ total: 'Toplam', expense_category: 'Kategori', service_provider: 'Sağlayıcı' })[r.scope_type]}${r.scope_id ? ` #${r.scope_id}` : ''}` }, { key: 'limit_minor', label: 'Limit', money: 'currency' }, { key: 'profit_target_minor', label: 'Kâr hedefi', money: 'currency' }]}
      fields=${[
        { name: 'name', label: 'Ad', required: true },
        { name: 'scope_type', label: 'Kapsam', type: 'select', options: [['total', 'Toplam gider'], ['expense_category', 'Gider kategorisi'], ['service_provider', 'Servis sağlayıcı']], required: true },
        { name: 'scope_id', label: 'Kapsam id', type: 'number' },
        { name: 'period', label: 'Dönem (YYYY-AA)', required: true, def: today().slice(0, 7) },
        { name: 'currency', label: 'Para birimi', type: 'select', options: fiat(meta), required: true, def: meta.reporting_currency },
        { name: 'limit', label: 'Limit', type: 'money', required: true },
        { name: 'profit_target', label: 'Kâr hedefi', type: 'money' },
      ]}
    />
    ${add && html`<${Modal} title="Banka bakiyesi gir" onClose=${() => setAdd(false)}>
      <${Form} fields=${[{ name: 'account_id', label: 'Hesap', type: 'select', required: true, options: (accounts.data?.rows ?? []).map((a) => [String(a.id), `${a.name} (${a.currency})`]) }, { name: 'as_of', label: 'Tarih', type: 'date', required: true, def: today() }, { name: 'balance', label: 'Bakiye', type: 'money', required: true }]} onCancel=${() => setAdd(false)} onSubmit=${async (v) => (await act(() => post('/api/cash/snapshots', { ...v, account_id: Number(v.account_id) }), 'Kaydedildi')) && (setAdd(false), snaps.reload())} />
    </${Modal}>`}
  </${Page}>`;
}
