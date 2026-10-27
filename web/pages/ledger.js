import { Badge, Button, Card, Form, Loading, Modal, Page, Table, Tabs, act, dateTimeTr, dateTr, html, money, num, post, qs, readFile, useApi, useApp, usePrompt, useState } from '../lib.js';

const EVENT_FIELDS = {
  purchase: [
    { name: 'channel', label: 'Ödeme kanalı kodu', required: true },
    { name: 'amount', label: 'Brüt tutar', type: 'money', required: true },
    { name: 'currency', label: 'Para birimi', required: true, def: 'TRY' },
    { name: 'coins', label: 'Verilen jeton', type: 'number' },
    { name: 'user_ref', label: 'Kullanıcı (Similar Club id)' },
    { name: 'product_ref', label: 'Ürün / paket' },
  ],
  refund: [
    { name: 'original_key', label: 'İade edilen satın almanın anahtarı', required: true },
    { name: 'amount', label: 'İade tutarı (boş = kalanın tamamı)', type: 'money' },
    { name: 'reason', label: 'Gerekçe' },
  ],
  chargeback: [
    { name: 'original_key', label: 'Ters ibraz edilen satın almanın anahtarı', required: true },
    { name: 'amount', label: 'Tutar (boş = kalanın tamamı)', type: 'money' },
    { name: 'reason', label: 'Gerekçe' },
  ],
  gift: [
    { name: 'sender_ref', label: 'Gönderen kullanıcı' },
    { name: 'publisher_ref', label: 'Alan yayıncı (Similar Club id)', required: true },
    { name: 'gift_ref', label: 'Hediye kodu' },
    { name: 'coins', label: 'Jeton', type: 'number', required: true },
    { name: 'event_ref', label: 'PK / etkinlik kodu' },
  ],
  call: [
    { name: 'user_ref', label: 'Arayan kullanıcı' },
    { name: 'publisher_ref', label: 'Yayıncı', required: true },
    { name: 'kind', label: 'Tür', type: 'select', options: [['voice', 'Sesli'], ['video', 'Görüntülü']], required: true, def: 'voice' },
    { name: 'minutes', label: 'Dakika', type: 'decimal', required: true },
    { name: 'coins', label: 'Jeton', type: 'number', required: true },
  ],
  game: [
    { name: 'user_ref', label: 'Kullanıcı' },
    { name: 'game_ref', label: 'Oyun kodu', required: true },
    { name: 'entry_coins', label: 'Giriş jetonu', type: 'number', required: true },
    { name: 'payout_coins', label: 'Kazanılan jeton', type: 'number' },
  ],
  bonus_grant: [
    { name: 'user_ref', label: 'Kullanıcı' },
    { name: 'coins', label: 'Jeton', type: 'number', required: true },
    { name: 'campaign_ref', label: 'Kampanya' },
  ],
  promotion: [
    { name: 'user_ref', label: 'Kullanıcı' },
    { name: 'coins', label: 'Jeton', type: 'number', required: true },
    { name: 'campaign_ref', label: 'Kampanya' },
  ],
  usage: [
    { name: 'provider_code', label: 'Sağlayıcı kodu', required: true },
    { name: 'service', label: 'Servis (örn. voice_minutes)', required: true },
    { name: 'quantity', label: 'Miktar', type: 'decimal', required: true },
    { name: 'period', label: 'Dönem (YYYY-AA)' },
  ],
};
const TYPE_LABEL = {
  purchase: 'Satın alma', refund: 'İade', chargeback: 'Ters ibraz', payout: 'Hakediş ödemesi', expense_payment: 'Gider ödemesi', adjustment: 'Düzeltme',
  coin_credit: 'Jeton yükleme', bonus_grant: 'Bonus jeton', promotion: 'Promosyon', coin_spend: 'Jeton harcama', gift_send: 'Hediye gönderme', gift_receive: 'Hediye alma',
  call_charge: 'Arama ücreti', call_earning: 'Arama kazancı', game_entry: 'Oyun girişi', game_result: 'Oyun sonucu', lucky_spend: 'Lucky harcama', lucky_reward: 'Lucky ödülü', reversal: 'Ters kayıt',
  publisher_earning: 'Yayıncı kazancı', admin_adjustment: 'Yönetici düzeltmesi', channel_settlement: 'Kanal ödemesi (mağaza aktarımı)',
};
export const typeLabel = (t) => TYPE_LABEL[t] ?? t;

export function Ledger({ query }) {
  const { can, meta } = useApp();
  const [tab, setTab] = useState(query.get('tab') ?? 'financial');
  const [f, setF] = useState({ type: '', from: '', to: '', q: '' });
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState(null);
  const [csv, setCsv] = useState(false);
  const path = tab === 'balances' ? `/api/ledger/balances${qs({ user_ref: f.q })}` : `/api/ledger/${tab}${qs({ ...f, limit: 200 })}`;
  const s = useApi(path);
  const types = tab === 'financial' ? meta.tx_types.financial : meta.tx_types.wallet;
  return html`<${Page}
    title="İşlem defteri"
    subtitle="Tüm para ve jeton hareketleri. Kayıtlar değiştirilemez; düzeltme ters kayıtla yapılır."
    actions=${can('ledger.write') && html`<${Button} kind="primary" onClick=${() => setForm('purchase')}>Manuel olay ekle</${Button}><${Button} onClick=${() => setCsv(true)}>CSV içe aktar</${Button}>`}
  >
    <${Tabs} tabs=${[['financial', 'Para hareketleri'], ['wallet', 'Jeton hareketleri'], ['balances', 'Kullanıcı bakiyeleri']]} value=${tab} onChange=${setTab} />
    <div class="row gap wrap" style="margin-bottom:10px">
      ${tab !== 'balances' && html`<select value=${f.type} onChange=${(e) => setF({ ...f, type: e.target.value })} aria-label="Tür"><option value="">Tüm türler</option>${types.map((t) => html`<option value=${t}>${typeLabel(t)}</option>`)}</select>
      <input type="date" value=${f.from} onChange=${(e) => setF({ ...f, from: e.target.value })} aria-label="Başlangıç" />
      <input type="date" value=${f.to} onChange=${(e) => setF({ ...f, to: e.target.value })} aria-label="Bitiş" />`}
      <input placeholder=${tab === 'balances' ? 'Kullanıcı id' : 'Anahtar / kullanıcı ara'} value=${f.q} onChange=${(e) => setF({ ...f, q: e.target.value })} />
    </div>
    <${Loading} state=${s}>${(d) =>
      tab === 'balances'
        ? html`<${Table} columns=${[{ key: 'user_ref', label: 'Kullanıcı' }, { key: 'unit', label: 'Birim' }, { key: 'balance', label: 'Bakiye', align: 'right', render: (r) => html`<span class=${r.balance < 0 ? 'bad' : ''}>${num(r.balance)}</span>` }, { key: 'tx', label: 'İşlem', align: 'right' }]} rows=${d.rows} />`
        : html`<p class="muted">${num(d.total)} kayıt</p><${Table}
            dense
            onRow=${(r) => setDetail(r)}
            columns=${tab === 'financial'
              ? [
                  { key: 'id', label: '#' },
                  { key: 'booked_on', label: 'Tarih', render: (r) => dateTr(r.booked_on) },
                  { key: 'type', label: 'Tür', render: (r) => typeLabel(r.type) },
                  { key: 'idempotency_key', label: 'Anahtar' },
                  { key: 'user_ref', label: 'Kullanıcı' },
                  { key: 'amount_minor', label: 'Tutar', money: 'currency' },
                  { key: 'tax_minor', label: 'Vergi', money: 'currency' },
                  { key: 'fee_minor', label: 'Kesinti', money: 'currency' },
                  { key: 'net_minor', label: 'Net', money: 'currency' },
                  { key: 'allocations', label: 'Komisyon', align: 'right' },
                  { key: 'source', label: 'Kaynak' },
                ]
              : [
                  { key: 'id', label: '#' },
                  { key: 'booked_on', label: 'Tarih', render: (r) => dateTr(r.booked_on) },
                  { key: 'type', label: 'Tür', render: (r) => typeLabel(r.type) },
                  { key: 'user_ref', label: 'Kullanıcı' },
                  { key: 'publisher', label: 'Yayıncı' },
                  { key: 'agency', label: 'Ajans' },
                  { key: 'item_ref', label: 'Öğe' },
                  { key: 'units', label: 'Birim', align: 'right', render: (r) => `${num(r.units)} ${r.unit}` },
                  { key: 'value_minor', label: 'Değer', money: 'value_currency' },
                  { key: 'allocations', label: 'Komisyon', align: 'right' },
                ]}
            rows=${d.rows}
          />`}
    </${Loading}>
    ${detail && html`<${TxDetail} kind=${tab} id=${detail.id} onClose=${() => setDetail(null)} onChange=${s.reload} />`}
    ${form && html`<${EventForm} type=${form} setType=${setForm} onClose=${() => setForm(null)} onDone=${() => (setForm(null), s.reload())} />`}
    ${csv && html`<${CsvImport} onClose=${() => setCsv(false)} onDone=${s.reload} />`}
  </${Page}>`;
}

function TxDetail({ kind, id, onClose, onChange }) {
  const { can } = useApp();
  const s = useApi(`/api/ledger/${kind}/${id}`);
  const [ask, prompt] = usePrompt();
  const reverse = async () => {
    const v = await ask('Ters kayıt oluştur', { text: 'Orijinal kayıt korunur; eşit ve zıt bir kayıt eklenir, bağlı komisyonlar oransal olarak geri alınır.' });
    if (!v) return;
    if (await act(() => post(`/api/ledger/${kind}/${id}/reverse`, { reason: v.reason }), 'Ters kayıt oluşturuldu')) (onChange(), s.reload());
  };
  return html`<${Modal} title=${`İşlem #${id}`} wide onClose=${onClose}>
    <${Loading} state=${s}>${(d) => html`
      <div class="grid cols2">
        <dl class="kv">${Object.entries(d.tx).filter(([k]) => k !== 'meta').map(([k, v]) => html`<dt>${k}</dt><dd>${k.endsWith('_minor') ? money(v, d.tx.currency ?? d.tx.value_currency) : String(v ?? '—')}</dd>`)}</dl>
        <div>
          <h3>Ek bilgi</h3><pre>${JSON.stringify(JSON.parse(d.tx.meta || '{}'), null, 2)}</pre>
          ${d.related.length > 0 && html`<h3>İlişkili kayıtlar</h3><ul>${d.related.map((r) => html`<li>#${r.id} ${typeLabel(r.type)} · ${r.idempotency_key} · ${dateTr(r.booked_on)}</li>`)}</ul>`}
          ${d.issues.length > 0 && html`<div class="note bad">${d.issues.map((i) => html`<div>${i.message} <${Badge} s=${i.status} /></div>`)}</div>`}
          ${can('ledger.write') && !d.tx.reverses_id && html`<${Button} kind="danger" onClick=${reverse}>Ters kayıt / iade</${Button}>`}
        </div>
      </div>
      <h3>Komisyon dağılımı (hangi kural, hangi sürüm, nasıl)</h3>
      <${Table}
        dense
        columns=${[
          { key: 'stage', label: 'Aşama' },
          { key: 'rule', label: 'Kural', render: (r) => `${r.rule} v${r.version}` },
          { key: 'direction', label: 'Yön', render: (r) => (r.direction === 'reversal' ? html`<${Badge} s="cancelled" label="Ters" />` : 'Orijinal') },
          { key: 'beneficiary_type', label: 'Alıcı', render: (r) => `${r.beneficiary_type} #${r.beneficiary_id ?? r.beneficiary_name ?? ''}` },
          { key: 'base_minor', label: 'Matrah', money: 'currency' },
          { key: 'amount_minor', label: 'Tutar', money: 'currency' },
          { key: 'trace', label: 'Hesap izi', render: (r) => html`<details><summary>göster</summary><pre>${JSON.stringify(JSON.parse(r.trace), null, 2)}</pre></details>` },
        ]}
        rows=${d.allocations}
        empty="Bu işleme komisyon uygulanmadı"
      />
    `}</${Loading}>
    ${prompt}
  </${Modal}>`;
}

function EventForm({ type, setType, onClose, onDone }) {
  const { meta } = useApp();
  return html`<${Modal} title="Manuel olay" onClose=${onClose}>
    <div class="note">Manuel girişler kaynak "manual" olarak işaretlenir ve denetim kaydına yazılır. Aynı anahtar ikinci kez kayıt oluşturmaz.</div>
    <label class="field"><span>Olay türü</span>
      <select value=${type} onChange=${(e) => setType(e.target.value)}>${Object.keys(EVENT_FIELDS).map((t) => html`<option value=${t}>${typeLabel(t === 'gift' ? 'gift_receive' : t === 'call' ? 'call_earning' : t === 'game' ? 'game_entry' : t === 'usage' ? 'Servis kullanımı' : t)}</option>`)}</select>
    </label>
    <${Form}
      key=${type}
      fields=${[
        { name: 'idempotency_key', label: 'Benzersiz anahtar', required: true, def: `manual-${type}-${Date.now()}`, wide: true },
        { name: 'occurred_at', label: 'Olay tarihi', type: 'date', required: true, def: new Date().toISOString().slice(0, 10) },
        ...EVENT_FIELDS[type],
      ]}
      submitLabel="Kaydet"
      onCancel=${onClose}
      onSubmit=${async (v) => {
        const ev = { type, ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '')) };
        for (const k of ['coins', 'entry_coins', 'payout_coins']) if (ev[k] !== undefined) ev[k] = Number(ev[k]);
        const r = await act(() => post('/api/ledger/events', { events: [ev] }));
        const res = r?.results?.[0];
        if (!res) return;
        if (res.status === 'error') return act(() => Promise.reject(Object.assign(new Error(res.error), { details: res.details })));
        await act(async () => res, res.status === 'duplicate' ? 'Bu anahtar zaten kayıtlı (yeni kayıt oluşmadı)' : 'Kaydedildi');
        onDone();
      }}
    />
    <p class="muted">Tanımlı para birimleri: ${meta.currencies.map((c) => c.code).join(', ')}</p>
  </${Modal}>`;
}

const CSV_HELP = {
  events: 'type,idempotency_key,occurred_at,channel,amount,currency,coins,user_ref,publisher_ref,gift_ref,original_key\npurchase,ord-1001,2026-10-01T10:00:00Z,google,99.99,TRY,1000,u1,,,',
  publishers: 'external_id,name,agency_code\nu100,Yayıncı Deniz,AG1',
  usage: 'idempotency_key,provider_code,service,period,quantity\nagora-2026-10,AGORA,voice_minutes,2026-10,125000',
  expenses: 'category,description,amount,currency,tx_date,due_date,vendor\nReklam,Ekim kampanyası,25000.00,TRY,2026-10-05,2026-10-30,Ajans X',
};

export function CsvImport({ onClose, onDone, kinds = ['events', 'publishers', 'usage', 'expenses'] }) {
  const [kind, setKind] = useState(kinds[0]);
  const [result, setResult] = useState(null);
  const [file, setFile] = useState(null);
  return html`<${Modal} title="CSV içe aktarma" wide onClose=${onClose}>
    <div class="row gap wrap">
      <select value=${kind} onChange=${(e) => setKind(e.target.value)}>${kinds.map((k) => html`<option value=${k}>${{ events: 'Defter olayları', publishers: 'Yayıncı eşleştirme', usage: 'Servis kullanımı', expenses: 'Giderler' }[k]}</option>`)}</select>
      <input type="file" accept=".csv,text/csv" onChange=${(e) => setFile(e.target.files[0])} />
      <${Button}
        kind="primary"
        disabled=${!file}
        onClick=${async () => {
          const csv = await readFile(file);
          const r = await act(() => post('/api/import/csv', { kind, csv }));
          if (r) {
            setResult(r);
            onDone();
          }
        }}
      >İçe aktar</${Button}>
    </div>
    <h3>Beklenen başlıklar (örnek)</h3><pre>${CSV_HELP[kind]}</pre>
    <p class="muted">Her satır kendi anahtarıyla işlenir; tekrar yüklenen satırlar "tekrar" olarak atlanır, hatalı satırlar raporlanır ve diğerlerini durdurmaz.</p>
    ${result && html`<${Card} title="Sonuç">
      <p>Toplam ${result.total} · Oluşturulan ${result.created} · Tekrar ${result.duplicate ?? 0} · Hatalı ${result.errors}</p>
      <${Table} dense columns=${[{ key: 'row', label: 'Satır' }, { key: 'key', label: 'Anahtar' }, { key: 'error', label: 'Hata' }]} rows=${(result.results ?? []).map((r, i) => ({ row: r.row ?? i + 2, ...r })).filter((r) => r.status === 'error' || r.ok === false)} empty="Hata yok" />
    </${Card}>`}
  </${Modal}>`;
}

export { dateTimeTr };
