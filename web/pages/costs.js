import { Badge, Button, Card, DateRange, Form, Loading, Modal, Page, Table, Tabs, act, dateTr, html, minorToInput, money, monthStart, num, post, put, qs, today, useApi, useApp, useState } from '../lib.js';
import { CsvImport } from './ledger.js';

const fiat = (meta) => meta.currencies.filter((c) => c.kind === 'fiat').map((c) => c.code);

/** Row → form values: minor-unit money back to decimal input, 0/1 to booleans, numbers to strings. */
function toInitial(fields, row) {
  return Object.fromEntries(
    fields.map((f) => {
      if (f.type === 'money') return [f.name, minorToInput(row[f.name + '_minor'], row.currency ?? 'TRY')];
      const v = row[f.name];
      if (f.type === 'checkbox') return [f.name, !!v];
      return [f.name, v === null || v === undefined ? '' : String(v)];
    }),
  );
}

/** Generic list + create/edit for simple master-data endpoints. */
export function Crud({ api, title, columns, fields, canEdit, note, extraActions, onRow, query = '' }) {
  const s = useApi(`/api/${api}?limit=500${query}`);
  const [edit, setEdit] = useState(null);
  return html`<${Card} title=${title} actions=${html`${extraActions}${canEdit && html`<${Button} onClick=${() => setEdit({})}>Ekle</${Button}>`}`}>
    ${note && html`<div class="note">${note}</div>`}
    <${Loading} state=${s}>${(d) => html`<${Table} dense columns=${columns} rows=${d.rows} onRow=${onRow ?? (canEdit ? (r) => setEdit(r) : undefined)} />`}</${Loading}>
    ${edit && html`<${Modal} title=${edit.id ? 'Düzenle' : 'Yeni kayıt'} onClose=${() => setEdit(null)}>
      <${Form}
        fields=${fields}
        initial=${edit.id ? toInitial(fields, edit) : {}}
        onCancel=${() => setEdit(null)}
        onSubmit=${async (v) => {
          const body = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fields.find((f) => f.name === k)?.type === 'number' && x !== '' ? Number(x) : x === '' ? null : x]));
          if (edit.id) for (const f of fields) if (f.immutable) delete body[f.name];
          if (await act(() => (edit.id ? put(`/api/${api}/${edit.id}`, body) : post(`/api/${api}`, body)), 'Kaydedildi')) (setEdit(null), s.reload());
        }}
      />
    </${Modal}>`}
  </${Card}>`;
}

// ---- payment channels -------------------------------------------------------------------
export function Channels() {
  const { can, meta } = useApp();
  const [open, setOpen] = useState(null);
  return html`<${Page} title="Ödeme kanalları ve tahsilat maliyetleri" subtitle="Kesinti oranları sözleşmeden/sağlayıcıdan girilir; sistem hiçbir mağazanın oranını varsaymaz. Her değişiklik yeni sürümdür.">
    <${Crud}
      api="channels"
      title="Kanallar"
      canEdit=${false}
      extraActions=${can('channels.edit') && html`<${NewChannel} />`}
      onRow=${(r) => setOpen(r)}
      columns=${[{ key: 'code', label: 'Kod' }, { key: 'name', label: 'Ad' }, { key: 'kind', label: 'Tür' }, { key: 'settlement_delay_days', label: 'Ödeme gecikmesi (gün)', align: 'right' }, { key: 'active', label: 'Durum', render: (r) => html`<${Badge} s=${r.active ? 'active' : 'passive'} />` }]}
      fields=${[]}
    />
    ${open && html`<${ChannelFees} ch=${open} meta=${meta} onClose=${() => setOpen(null)} />`}
  </${Page}>`;
}

function NewChannel() {
  const [o, setO] = useState(false);
  return html`<${Button} onClick=${() => setO(true)}>Kanal ekle</${Button}>${o && html`<${Modal} title="Yeni ödeme kanalı" onClose=${() => setO(false)}>
    <${Form}
      fields=${[
        { name: 'code', label: 'Kod (örn. google, apple, iyzico)', required: true },
        { name: 'name', label: 'Ad', required: true },
        { name: 'kind', label: 'Tür', type: 'select', options: [['store', 'Uygulama mağazası'], ['card', 'Kart / ödeme kuruluşu'], ['bank', 'Banka transferi'], ['web', 'Web ödeme'], ['other', 'Diğer']], required: true },
        { name: 'settlement_delay_days', label: 'Tahsilatın hesaba geçme süresi (gün)', type: 'number', def: '0' },
        { name: 'active', label: 'Aktif', type: 'checkbox', def: true },
      ]}
      onCancel=${() => setO(false)}
      onSubmit=${async (v) => (await act(() => post('/api/channels', { ...v, settlement_delay_days: Number(v.settlement_delay_days || 0) }), 'Kanal eklendi')) && (setO(false), location.reload())}
    />
  </${Modal}>`}`;
}

function ChannelFees({ ch, meta, onClose }) {
  const { can } = useApp();
  const s = useApi(`/api/channels/${ch.id}/fees`);
  const [add, setAdd] = useState(false);
  return html`<${Modal} title=${`${ch.name} · kesinti sürümleri`} wide onClose=${onClose}>
    <${Loading} state=${s}>${(d) => html`<${Table} dense columns=${[
      { key: 'valid_from', label: 'Başlangıç', render: (r) => dateTr(r.valid_from) },
      { key: 'valid_to', label: 'Bitiş', render: (r) => (r.valid_to ? dateTr(r.valid_to) : 'süresiz') },
      { key: 'percent', label: 'Yüzde', align: 'right', render: (r) => `%${r.percent}` },
      { key: 'fixed_fee_minor', label: 'İşlem başı', money: 'currency' },
      { key: 'refund_fee_minor', label: 'İade ücreti', money: 'currency' },
      { key: 'chargeback_fee_minor', label: 'Ters ibraz', money: 'currency' },
      { key: 'condition_note', label: 'Koşul / not' },
    ]} rows=${d.rows} empty="Kesinti tanımlı değil — bu kanaldan gelen satışlarda uyarı oluşur" />`}</${Loading}>
    ${can('channels.edit') && html`<div class="row end"><${Button} kind="primary" onClick=${() => setAdd(true)}>Yeni kesinti sürümü</${Button}></div>`}
    ${add && html`<${Modal} title="Yeni kesinti sürümü" onClose=${() => setAdd(false)}>
      <div class="note">Geçmiş işlemler kendi tarihindeki oranla kalır. Yeni oran yalnız bu tarihten sonraki olaylara uygulanır.</div>
      <${Form}
        fields=${[
          { name: 'percent', label: 'Yüzde kesinti (%)', type: 'decimal', required: true },
          { name: 'fixed_fee', label: 'İşlem başına sabit ücret', type: 'money' },
          { name: 'refund_fee', label: 'İade ücreti', type: 'money' },
          { name: 'chargeback_fee', label: 'Ters ibraz maliyeti', type: 'money' },
          { name: 'currency', label: 'Ücret para birimi', type: 'select', options: fiat(meta), required: true, def: meta.reporting_currency },
          { name: 'valid_from', label: 'Başlangıç', type: 'date', required: true, def: today() },
          { name: 'condition_note', label: 'Koşul notu (indirimli oran şartı vb.)', wide: true },
        ]}
        onCancel=${() => setAdd(false)}
        onSubmit=${async (v) => (await act(() => post(`/api/channels/${ch.id}/fees`, v), 'Kaydedildi')) && (setAdd(false), s.reload())}
      />
    </${Modal}>`}
  </${Modal}>`;
}

// ---- technical services ----------------------------------------------------------------
export function Costs() {
  const { can, meta } = useApp();
  const [tab, setTab] = useState('month');
  const [period, setPeriod] = useState(today().slice(0, 7));
  const costs = useApi(tab === 'month' ? `/api/costs?period=${period}` : null);
  const providers = useApi('/api/providers?limit=500');
  const tariffs = useApi(tab === 'tariffs' ? '/api/tariffs' : null);
  const usage = useApi(tab === 'usage' ? `/api/usage?period=${period}` : null);
  const invoices = useApi(tab === 'invoices' ? '/api/invoices' : null);
  const [form, setForm] = useState(null);
  const [csv, setCsv] = useState(false);
  const provOpts = (providers.data?.rows ?? []).map((p) => [String(p.id), p.name]);
  const total = (costs.data?.lines ?? []).reduce((m, l) => ((m[l.currency] = (m[l.currency] ?? 0n) + BigInt(l.amount_minor ?? 0)), m), {});
  return html`<${Page} title="Sunucu ve teknik servis maliyetleri" subtitle="Tarife × kullanım = tahmini maliyet; fatura gelince kesinleşir ve mutabakat yapılır. Verisi olmayan servis sıfır gösterilmez." actions=${html`<input type="month" value=${period} onChange=${(e) => setPeriod(e.target.value)} aria-label="Dönem" />`}>
    <${Tabs} tabs=${[['month', 'Aylık maliyet'], ['providers', 'Sağlayıcılar'], ['tariffs', 'Tarifeler'], ['usage', 'Kullanım kayıtları'], ['invoices', 'Faturalar ve mutabakat']]} value=${tab} onChange=${setTab} />
    ${tab === 'month' && html`<${Loading} state=${costs}>${(d) => html`
      <div class="kpis">${Object.entries(total).map(([c, v]) => html`<div class="kpi"><span class="kpi-l">Toplam (${c})</span><strong class="kpi-v">${money(v, c)}</strong></div>`)}</div>
      <${Table} columns=${[
        { key: 'category', label: 'Kategori' },
        { key: 'provider', label: 'Sağlayıcı' },
        { key: 'service', label: 'Servis' },
        { key: 'quantity', label: 'Kullanım', align: 'right', render: (r) => (r.quantity === null ? '—' : `${num(r.quantity)} ${r.unit}`) },
        { key: 'estimated_minor', label: 'Tahmin', money: 'currency' },
        { key: 'invoiced_minor', label: 'Fatura', money: 'currency' },
        { key: 'status', label: 'Durum', render: (r) => html`<${Badge} s=${r.status} />` },
        { key: 'note', label: 'Not' },
      ]} rows=${d.lines} empty="Bu dönem için tarife tanımlı değil" />`}</${Loading}>`}
    ${tab === 'providers' && html`<${Crud}
      api="providers"
      title="Servis sağlayıcılar"
      canEdit=${can('costs.edit')}
      columns=${[{ key: 'code', label: 'Kod' }, { key: 'name', label: 'Ad' }, { key: 'category', label: 'Kategori' }, { key: 'active', label: 'Durum', render: (r) => html`<${Badge} s=${r.active ? 'active' : 'passive'} />` }]}
      fields=${[
        { name: 'code', label: 'Kod', required: true, immutable: true },
        { name: 'name', label: 'Ad', required: true },
        { name: 'category', label: 'Kategori', type: 'select', required: true, options: ['Uygulama sunucuları', 'Veritabanı', 'Dosya ve medya depolama', 'Yedekleme', 'CDN ve veri transferi', 'Sesli oda altyapısı', 'Bire bir sesli görüşme', 'Görüntülü görüşme', 'Push bildirimleri', 'SMS ve doğrulama', 'E-posta', 'Analitik', 'Loglama ve izleme', 'Moderasyon ve güvenlik', 'Üçüncü taraf API', 'Alan adı ve sertifika', 'Lisans ve bakım'] },
        { name: 'active', label: 'Aktif', type: 'checkbox', def: true },
      ]}
    />`}
    ${tab === 'tariffs' && html`<${Card} title="Tarifeler" actions=${can('costs.edit') && html`<${Button} onClick=${() => setForm('tariff')}>Yeni tarife sürümü</${Button}>`}>
      <${Loading} state=${tariffs}>${(d) => html`<${Table} dense columns=${[
        { key: 'provider', label: 'Sağlayıcı' }, { key: 'service', label: 'Servis' }, { key: 'unit', label: 'Birim' },
        { key: 'fixed_monthly_minor', label: 'Sabit aylık', money: 'currency' },
        { key: 'included_quantity', label: 'Dahil kota', align: 'right' },
        { key: 'unit_price', label: 'Kota üstü birim fiyat', align: 'right', render: (r) => (r.tiers ? 'kademeli' : `${r.unit_price} ${r.currency}`) },
        { key: 'tax_percent', label: 'Vergi %', align: 'right' },
        { key: 'valid', label: 'Geçerlilik', render: (r) => `${dateTr(r.valid_from)} → ${r.valid_to ? dateTr(r.valid_to) : 'süresiz'}` },
      ]} rows=${d.rows} />`}</${Loading}>
    </${Card}>`}
    ${tab === 'usage' && html`<${Card} title=${`Kullanım kayıtları (${period})`} actions=${can('costs.edit') && html`<${Button} onClick=${() => setForm('usage')}>Manuel kullanım gir</${Button}><${Button} onClick=${() => setCsv(true)}>CSV</${Button}>`}>
      <${Loading} state=${usage}>${(d) => html`<${Table} dense columns=${[{ key: 'provider', label: 'Sağlayıcı' }, { key: 'service', label: 'Servis' }, { key: 'quantity', label: 'Miktar', align: 'right', render: (r) => num(r.quantity, 2) }, { key: 'source', label: 'Kaynak' }, { key: 'recorded_at', label: 'Kayıt', render: (r) => dateTr(r.recorded_at) }, { key: 'note', label: 'Not' }]} rows=${d.rows} />`}</${Loading}>
    </${Card}>`}
    ${tab === 'invoices' && html`<${Card} title="Faturalar" actions=${can('costs.edit') && html`<${Button} onClick=${() => setForm('invoice')}>Fatura gir</${Button}>`}>
      <${Loading} state=${invoices}>${(d) => html`<${Table} dense columns=${[
        { key: 'provider', label: 'Sağlayıcı' }, { key: 'period', label: 'Dönem' }, { key: 'invoice_no', label: 'No' },
        { key: 'amount_minor', label: 'Tutar', money: 'currency' }, { key: 'tax_minor', label: 'Vergi', money: 'currency' },
        { key: 'due_on', label: 'Vade', render: (r) => dateTr(r.due_on) },
        { key: 'paid_on', label: 'Ödendi', render: (r) => (r.paid_on ? dateTr(r.paid_on) : can('costs.edit') ? html`<${Button} onClick=${async () => (await act(() => post(`/api/invoices/${r.id}/pay`, { paid_on: today() }), 'Ödendi olarak işaretlendi')) && invoices.reload()}>Ödendi</${Button}>` : '—') },
        { key: 'rec', label: 'Mutabakat', render: (r) => (r.reconciliation ? html`<${Badge} s=${r.reconciliation.status} /> ${r.reconciliation.status === 'difference' ? html`<span class="num">Δ ${money(r.reconciliation.difference_minor, r.currency)} (sistem ${money(r.reconciliation.system_minor, r.currency)})</span>` : ''}` : '—') },
        { key: 'act', label: '', render: (r) => can('costs.edit') && html`<${Button} onClick=${async () => (await act(() => post(`/api/invoices/${r.id}/reconcile`, {}), 'Mutabakat yenilendi')) && invoices.reload()}>Yeniden karşılaştır</${Button}>` },
      ]} rows=${d.rows} />`}</${Loading}>
    </${Card}>`}
    ${form === 'tariff' && html`<${Modal} title="Yeni tarife sürümü" onClose=${() => setForm(null)}>
      <div class="note">Aynı sağlayıcı+servis için önceki tarife bu tarihte kapanır.</div>
      <${Form} fields=${[
        { name: 'provider_id', label: 'Sağlayıcı', type: 'select', options: provOpts, required: true },
        { name: 'service', label: 'Servis anahtarı (örn. voice_minutes, storage_gb)', required: true },
        { name: 'unit', label: 'Kullanım birimi (dakika, GB, istek…)', required: true },
        { name: 'currency', label: 'Para birimi', type: 'select', options: fiat(meta), required: true, def: 'USD' },
        { name: 'fixed_monthly', label: 'Sabit aylık ücret', type: 'money' },
        { name: 'included_quantity', label: 'Dahil kullanım kotası', type: 'decimal', def: '0' },
        { name: 'unit_price', label: 'Kota üstü birim fiyat', type: 'decimal', def: '0' },
        { name: 'tiers', label: 'Kademeler (isteğe bağlı) — satır başına "eşik;birim fiyat"', type: 'textarea', wide: true, hint: 'Kota üstü miktara dilimli uygulanır. Örn: 0;0.004 ⏎ 1000000;0.003' },
        { name: 'tax_percent', label: 'Vergi / ek ücret %', type: 'decimal', def: '0' },
        { name: 'payment_terms_days', label: 'Ödeme vadesi (gün)', type: 'number', def: '0' },
        { name: 'valid_from', label: 'Geçerlilik başlangıcı', type: 'date', required: true, def: monthStart() },
      ]} onCancel=${() => setForm(null)} onSubmit=${async (v) => {
        const tiers = v.tiers ? v.tiers.split(/\n/).map((l) => l.split(/[;,\t]/)).filter((x) => x.length >= 2).map(([from, unit_price]) => ({ from: from.trim(), unit_price: unit_price.trim() })) : [];
        (await act(() => post('/api/tariffs', { ...v, provider_id: Number(v.provider_id), tiers, payment_terms_days: Number(v.payment_terms_days || 0) }), 'Tarife kaydedildi')) && (setForm(null), tariffs.reload());
      }} />
    </${Modal}>`}
    ${form === 'usage' && html`<${Modal} title="Kullanım gir" onClose=${() => setForm(null)}>
      <${Form} fields=${[
        { name: 'provider_code', label: 'Sağlayıcı', type: 'select', options: (providers.data?.rows ?? []).map((p) => [p.code, p.name]), required: true },
        { name: 'service', label: 'Servis anahtarı', required: true },
        { name: 'period', label: 'Dönem (YYYY-AA)', required: true, def: period },
        { name: 'quantity', label: 'Miktar', type: 'decimal', required: true },
        { name: 'note', label: 'Not / kaynak', wide: true },
      ]} onCancel=${() => setForm(null)} onSubmit=${async (v) => (await act(() => post('/api/usage', { ...v, occurred_at: `${v.period}-01` }), 'Kaydedildi')) && (setForm(null), usage.reload())} />
    </${Modal}>`}
    ${form === 'invoice' && html`<${Modal} title="Fatura gir" onClose=${() => setForm(null)}>
      <${Form} fields=${[
        { name: 'provider_id', label: 'Sağlayıcı', type: 'select', options: provOpts, required: true },
        { name: 'period', label: 'Dönem (YYYY-AA)', required: true, def: period },
        { name: 'invoice_no', label: 'Fatura no' },
        { name: 'currency', label: 'Para birimi', type: 'select', options: fiat(meta), required: true, def: 'USD' },
        { name: 'amount', label: 'Tutar (vergi hariç)', type: 'money', required: true },
        { name: 'tax', label: 'Vergi', type: 'money' },
        { name: 'due_on', label: 'Vade', type: 'date' },
        { name: 'attachment_ref', label: 'Belge bağlantısı / dosya yolu', wide: true },
      ]} onCancel=${() => setForm(null)} onSubmit=${async (v) => {
        const r = await act(() => post('/api/invoices', { ...v, provider_id: Number(v.provider_id) }));
        if (r) {
          act(async () => r, r.reconciliation.status === 'matched' ? 'Fatura kaydedildi; sistem tahminiyle eşleşti' : `Fatura kaydedildi; fark ${money(r.reconciliation.difference_minor, v.currency)}`);
          setForm(null);
          invoices.reload();
        }
      }} />
    </${Modal}>`}
    ${csv && html`<${CsvImport} kinds=${['usage']} onClose=${() => setCsv(false)} onDone=${() => usage.reload()} />`}
  </${Page}>`;
}

// ---- catalog: games, gifts, emoji, PK --------------------------------------------------------
export function Catalog() {
  const { can, meta } = useApp();
  const [tab, setTab] = useState('items');
  const [range, setRange] = useState({ from: monthStart(), to: today() });
  const rep = useApi(tab === 'report' ? `/api/reports/catalog${qs(range)}` : null);
  const cur = meta.reporting_currency;
  return html`<${Page} title="Oyun, hediye, emoji ve PK maliyetleri" subtitle="Tek seferlik lisans/üretim bedeli, aylık ücret ve kullanım başı maliyet (trafik, harici servis) ayrı izlenir.">
    <${Tabs} tabs=${[['items', 'Katalog'], ['pk', 'PK etkinlikleri'], ['report', 'Kârlılık']]} value=${tab} onChange=${setTab} />
    ${tab === 'items' && html`<${Crud}
      api="catalog"
      title="Oyun, hediye, emoji, animasyon"
      canEdit=${can('catalog.edit')}
      columns=${[
        { key: 'kind', label: 'Tür', render: (r) => ({ game: 'Oyun', gift: 'Hediye', emoji: 'Emoji', animation: 'Animasyon' })[r.kind] },
        { key: 'code', label: 'Kod' }, { key: 'name', label: 'Ad' }, { key: 'provider', label: 'Sağlayıcı' },
        { key: 'coin_price', label: 'Jeton fiyatı', align: 'right' },
        { key: 'license_cost_minor', label: 'Lisans', money: 'currency' },
        { key: 'production_cost_minor', label: 'Üretim', money: 'currency' },
        { key: 'monthly_fee_minor', label: 'Aylık', money: 'currency' },
        { key: 'per_use_cost', label: 'Kullanım başı', align: 'right' },
        { key: 'free', label: 'Ücretsiz', render: (r) => (r.free ? 'Evet' : '') },
      ]}
      fields=${[
        { name: 'kind', label: 'Tür', type: 'select', options: [['game', 'Oyun'], ['gift', 'Hediye'], ['emoji', 'Emoji'], ['animation', 'Animasyon']], required: true },
        { name: 'code', label: 'Kod (Similar Club öğe kodu)', required: true, immutable: true },
        { name: 'name', label: 'Ad', required: true },
        { name: 'provider', label: 'Sağlayıcı' },
        { name: 'coin_price', label: 'Jeton fiyatı', type: 'number', def: '0' },
        { name: 'currency', label: 'Maliyet para birimi', type: 'select', options: fiat(meta), required: true, def: cur },
        { name: 'license_cost', label: 'Lisans / satın alma bedeli (tek sefer)', type: 'money' },
        { name: 'production_cost', label: 'Animasyon üretim maliyeti (tek sefer)', type: 'money' },
        { name: 'monthly_fee', label: 'Aylık sabit ücret', type: 'money' },
        { name: 'per_use_cost', label: 'Kullanım başına maliyet (trafik, depolama)', type: 'decimal', def: '0' },
        { name: 'per_tx_fee', label: 'İşlem başına ücret', type: 'decimal', def: '0' },
        { name: 'revenue_share_percent', label: 'Sağlayıcı gelir payı %', type: 'decimal', def: '0' },
        { name: 'acquired_on', label: 'Edinme tarihi (tek seferlik bedelin gideri)', type: 'date' },
        { name: 'free', label: 'Ücretsiz / promosyon', type: 'checkbox' },
        { name: 'active', label: 'Aktif', type: 'checkbox', def: true },
      ]}
    />`}
    ${tab === 'pk' && html`<${Crud}
      api="pk"
      title="PK etkinlikleri"
      canEdit=${can('catalog.edit')}
      note="Etkinliğe ait hediye geliri, ledger’daki event_ref alanı bu kodla eşleşen hediyelerden hesaplanır."
      columns=${[{ key: 'code', label: 'Kod' }, { key: 'name', label: 'Ad' }, { key: 'kind', label: 'Tür', render: (r) => (r.kind === 'in_room' ? 'Oda içi' : 'Odalar arası') }, { key: 'starts_at', label: 'Başlangıç' }, { key: 'ends_at', label: 'Bitiş' }, { key: 'reward_type', label: 'Ödül' }, { key: 'reward_cost_minor', label: 'Ödül maliyeti', money: 'currency' }]}
      fields=${[
        { name: 'code', label: 'Kod', required: true, immutable: true },
        { name: 'name', label: 'Ad', required: true },
        { name: 'kind', label: 'Tür', type: 'select', options: [['in_room', 'Oda içi takım PK'], ['cross_room', 'Odalar arası takım PK']], required: true },
        { name: 'starts_at', label: 'Başlangıç (YYYY-AA-GG SS:DD)', required: true },
        { name: 'ends_at', label: 'Bitiş', required: true },
        { name: 'reward_type', label: 'Ödül türü', required: true },
        { name: 'currency', label: 'Para birimi', type: 'select', options: fiat(meta), required: true, def: cur },
        { name: 'reward_cost', label: 'Dağıtılan ödül maliyeti', type: 'money' },
        { name: 'note', label: 'Not', wide: true },
      ]}
    />`}
    ${tab === 'report' && html`<${Card} title="Kalem bazında kârlılık" actions=${html`<${DateRange} value=${range} onChange=${setRange} />`}>
      <${Loading} state=${rep}>${(d) => html`
        <${Table} dense columns=${[
          { key: 'name', label: 'Öğe' }, { key: 'kind', label: 'Tür' }, { key: 'uses', label: 'Kullanım', align: 'right' },
          { key: 'revenue', label: 'Gelir (jeton değeri)', money: cur }, { key: 'commissions', label: 'Yayıncı/ajans payı', money: cur },
          { key: 'total', label: 'Maliyet', money: cur }, { key: 'net_contribution', label: 'Net katkı', money: cur },
        ]} rows=${d.items} empty="Dönemde kullanım/maliyet yok" />
        <h3>PK etkinlikleri</h3>
        <${Table} dense columns=${[{ key: 'name', label: 'Etkinlik' }, { key: 'gift_revenue', label: 'Hediye geliri', money: cur }, { key: 'reward_cost', label: 'Ödül maliyeti', money: cur }, { key: 'result', label: 'Sonuç', money: cur }]} rows=${d.pk} empty="Dönemde PK yok" />
      `}</${Loading}>
    </${Card}>`}
  </${Page}>`;
}
