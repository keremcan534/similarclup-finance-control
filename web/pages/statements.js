import { Badge, Button, Card, Form, Loading, Modal, Page, Table, Tabs, act, dateTimeTr, dateTr, html, minorToInput, money, monthStart, post, qs, today, useApi, useApp, usePrompt, useState } from '../lib.js';

const PARTY = { agency: 'Ajans', bd: 'BD', publisher: 'Yayıncı' };
const KIND = { commission: 'Komisyon', salary: 'Sabit maaş', min_guarantee_topup: 'Garanti tamamlaması', bonus: 'Bonus / prim', deduction: 'Kesinti', adjustment: 'Düzeltme', carryover: 'Devreden bakiye' };

const lastMonth = () => {
  const end = new Date(Date.parse(monthStart()) - 864e5).toISOString().slice(0, 10);
  return { from: monthStart(end), to: end };
};

export function Statements() {
  const { can } = useApp();
  const [f, setF] = useState({ party_type: '', status: '' });
  const s = useApi(`/api/statements${qs({ ...f, limit: 500 })}`);
  const [open, setOpen] = useState(null);
  const [calc, setCalc] = useState(false);
  const [adj, setAdj] = useState(false);
  const [tab, setTab] = useState('list');
  const adjustments = useApi(tab === 'adjustments' && can('statements.calculate') ? '/api/adjustments' : null);
  return html`<${Page}
    title="Hakedişler"
    subtitle="Ajans, BD ve yayıncı hakedişleri: hesaplandı → onaylandı → ödendi. Onaylanan hakediş değiştirilemez; düzeltmeler sonraki döneme kayıtla girilir."
    actions=${html`
      ${can('statements.calculate') && html`<${Button} kind="primary" onClick=${() => setCalc(true)}>Dönem hesapla</${Button}><${Button} onClick=${() => setAdj(true)}>Düzeltme / bonus / kesinti</${Button}>`}`}
  >
    <${Tabs} tabs=${[['list', 'Hakedişler'], ...(can('statements.calculate') ? [['adjustments', 'Düzeltme kayıtları']] : [])]} value=${tab} onChange=${setTab} />
    ${tab === 'list'
      ? html`<div class="row gap wrap" style="margin-bottom:10px">
          <select value=${f.party_type} onChange=${(e) => setF({ ...f, party_type: e.target.value })} aria-label="Taraf"><option value="">Tüm taraflar</option>${Object.entries(PARTY).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>
          <select value=${f.status} onChange=${(e) => setF({ ...f, status: e.target.value })} aria-label="Durum"><option value="">Tüm durumlar</option>${Object.entries({ calculated: 'Hesaplandı', approved: 'Onaylandı', paid: 'Ödendi', cancelled: 'İptal' }).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>
        </div>
        <${Loading} state=${s}>${(d) => html`<${Table}
          onRow=${(r) => setOpen(r.id)}
          columns=${[
            { key: 'id', label: '#' },
            { key: 'party_type', label: 'Taraf', render: (r) => PARTY[r.party_type] },
            { key: 'party_name', label: 'Ad' },
            { key: 'period', label: 'Dönem', render: (r) => `${dateTr(r.period_start)} – ${dateTr(r.period_end)}` },
            { key: 'total_minor', label: 'Toplam', money: 'currency' },
            { key: 'paid_minor', label: 'Ödenen', money: 'currency' },
            { key: 'disputed_minor', label: 'İtiraz', money: 'currency' },
            { key: 'status', label: 'Durum', render: (r) => html`<${Badge} s=${r.status} />` },
          ]}
          rows=${d.rows}
          empty="Henüz hakediş yok. 'Dönem hesapla' ile başlayın."
        />`}</${Loading}>`
      : html`<${Loading} state=${adjustments}>${(d) => html`<${Table} dense columns=${[{ key: 'booked_on', label: 'Tarih', render: (a) => dateTr(a.booked_on) }, { key: 'party', label: 'Taraf', render: (a) => `${PARTY[a.party_type]} #${a.party_id}` }, { key: 'kind', label: 'Tür' }, { key: 'amount_minor', label: 'Tutar', money: 'currency' }, { key: 'reason', label: 'Gerekçe' }]} rows=${d.rows} />`}</${Loading}>`}
    ${open && html`<${StatementDetail} id=${open} onClose=${() => setOpen(null)} onChange=${s.reload} />`}
    ${calc && html`<${Modal} title="Hakediş hesapla" onClose=${() => setCalc(false)}>
      <div class="note">Tek bir taraf seçilmezse o türdeki tüm aktif taraflar hesaplanır. Hesaplanmış (onaylanmamış) hakedişler yeniden hesaplanır; onaylılar korunur.</div>
      <${Form}
        fields=${[
          { name: 'party_type', label: 'Taraf türü', type: 'select', options: Object.entries(PARTY), required: true, def: 'publisher' },
          { name: 'party_id', label: 'Tek taraf id (boş = hepsi)', type: 'number' },
          { name: 'from', label: 'Dönem başı', type: 'date', required: true, def: lastMonth().from },
          { name: 'to', label: 'Dönem sonu', type: 'date', required: true, def: lastMonth().to },
        ]}
        submitLabel="Hesapla"
        onCancel=${() => setCalc(false)}
        onSubmit=${async (v) => {
          const r = await act(() => post('/api/statements/calculate', { ...v, party_id: v.party_id ? Number(v.party_id) : undefined }));
          if (!r) return;
          const failed = r.results.filter((x) => !x.ok);
          act(async () => r, `${r.results.length - failed.length} hakediş hesaplandı${failed.length ? `, ${failed.length} başarısız: ${failed.map((x) => `#${x.party_id} ${x.error}`).join('; ')}` : ''}`);
          setCalc(false);
          s.reload();
        }}
      />
    </${Modal}>`}
    ${adj && html`<${AdjustmentForm} onClose=${() => setAdj(false)} onDone=${() => (setAdj(false), adjustments.reload?.())} />`}
  </${Page}>`;
}

function AdjustmentForm({ onClose, onDone }) {
  const { meta } = useApp();
  return html`<${Modal} title="Düzeltme kaydı" onClose=${onClose}>
    <div class="note">Tutar işaretlidir: kesinti için negatif girin. Kayıt silinemez; hatalıysa ters işaretli yeni kayıt girin.</div>
    <${Form}
      fields=${[
        { name: 'party_type', label: 'Taraf türü', type: 'select', options: Object.entries(PARTY), required: true, def: 'publisher' },
        { name: 'party_id', label: 'Taraf id', type: 'number', required: true },
        { name: 'kind', label: 'Tür', type: 'select', options: [['bonus', 'Bonus'], ['deduction', 'Kesinti'], ['adjustment', 'Düzeltme'], ['dispute', 'İtiraz sonucu']], required: true, def: 'adjustment' },
        { name: 'amount', label: 'Tutar (±)', type: 'money', required: true },
        { name: 'currency', label: 'Para birimi', type: 'select', options: meta.currencies.filter((c) => c.kind === 'fiat').map((c) => c.code), required: true, def: meta.reporting_currency },
        { name: 'booked_on', label: 'Kayıt tarihi (açık dönem)', type: 'date', def: today() },
        { name: 'reason', label: 'Gerekçe', type: 'textarea', required: true, wide: true },
      ]}
      onCancel=${onClose}
      onSubmit=${async (v) => (await act(() => post('/api/adjustments', { ...v, party_id: Number(v.party_id) }), 'Düzeltme kaydedildi')) && onDone()}
    />
  </${Modal}>`;
}

function StatementDetail({ id, onClose, onChange }) {
  const { can, user } = useApp();
  const s = useApi(`/api/statements/${id}`);
  const [ask, prompt] = usePrompt();
  const run = async (fn, ok) => {
    if (await act(fn, ok)) (s.reload(), onChange());
  };
  return html`<${Modal} title=${`Hakediş #${id}`} wide onClose=${onClose}>
    <${Loading} state=${s}>${(d) => {
      const st = d.statement;
      const open = BigInt(st.total_minor) - BigInt(st.paid_minor) - BigInt(st.disputed_minor);
      return html`
        <div class="row between wrap gap">
          <dl class="kv">
            <dt>Taraf</dt><dd>${PARTY[st.party_type]} #${st.party_id}</dd>
            <dt>Dönem</dt><dd>${dateTr(st.period_start)} – ${dateTr(st.period_end)}</dd>
            <dt>Durum</dt><dd><${Badge} s=${st.status} /></dd>
            <dt>Toplam</dt><dd><strong>${money(st.total_minor, st.currency)}</strong></dd>
            <dt>Ödenen</dt><dd>${money(st.paid_minor, st.currency)}</dd>
            <dt>İtiraz</dt><dd>${money(st.disputed_minor, st.currency)}</dd>
            <dt>Hesaplandı</dt><dd>${dateTimeTr(st.calculated_at)} (kullanıcı #${st.calculated_by ?? '-'})</dd>
            ${st.approved_at && html`<dt>Onaylandı</dt><dd>${dateTimeTr(st.approved_at)} (kullanıcı #${st.approved_by})</dd>`}
            ${st.note && html`<dt>Not</dt><dd>${st.note}</dd>`}
          </dl>
          <div class="row gap wrap">
            ${st.status === 'calculated' && can('statements.approve') && html`<${Button} kind="primary" disabled=${st.calculated_by === user.id && false} onClick=${async () => {
              const r = await ask('Hakedişi onayla', { label: 'Not', required: false, text: 'Onaydan sonra tutarlar değiştirilemez. Çift onay açıksa hesaplayan kişi onaylayamaz.' });
              if (r) run(() => post(`/api/statements/${id}/approve`, { note: r.reason }), 'Onaylandı');
            }}>Onayla</${Button}>`}
            ${st.status === 'approved' && can('payouts.record') && open > 0n && html`<${Button} kind="primary" onClick=${async () => {
              const r = await ask('Ödeme kaydet', {
                fields: [
                  { name: 'amount', label: `Tutar (${st.currency})`, type: 'money', required: true, def: minorToInput(open, st.currency) },
                  { name: 'paid_on', label: 'Ödeme tarihi', type: 'date', required: true, def: today() },
                  { name: 'method', label: 'Yöntem', required: true, def: 'Banka havalesi' },
                  { name: 'reference', label: 'Dekont / referans' },
                ],
                ok: 'Kaydet',
              });
              if (r) run(() => post(`/api/statements/${id}/pay`, { ...r, idempotency_key: `ui-${id}-${r.paid_on}-${r.amount}-${r.reference ?? ''}` }), 'Ödeme kaydedildi');
            }}>Ödeme kaydet</${Button}>`}
            ${['calculated', 'approved'].includes(st.status) && can('statements.calculate') && html`<${Button} onClick=${async () => {
              const r = await ask('İtiraz tutarı', { fields: [{ name: 'amount', label: 'İtiraz edilen tutar', type: 'money', required: true, def: minorToInput(st.disputed_minor, st.currency) }, { name: 'reason', label: 'Açıklama', type: 'textarea', required: true, wide: true }] });
              if (r) run(() => post(`/api/statements/${id}/dispute`, r), 'İtiraz güncellendi');
            }}>İtiraz</${Button}>`}
            ${['calculated', 'approved'].includes(st.status) && BigInt(st.paid_minor) === 0n && can('statements.approve') && html`<${Button} kind="danger" onClick=${async () => {
              const r = await ask('Hakedişi iptal et', { text: 'İptal edilen hakediş yeniden hesaplanabilir.' });
              if (r) run(() => post(`/api/statements/${id}/cancel`, r), 'İptal edildi');
            }}>İptal</${Button}>`}
          </div>
        </div>
        <h3>Kalemler</h3>
        <${Table} dense columns=${[{ key: 'kind', label: 'Kalem', render: (l) => KIND[l.kind] ?? l.kind }, { key: 'description', label: 'Açıklama' }, { key: 'ref', label: 'Kaynak' }, { key: 'amount_minor', label: 'Tutar', money: st.currency }]} rows=${d.lines} />
        <h3>Ödemeler</h3>
        <${Table} dense columns=${[{ key: 'paid_on', label: 'Tarih', render: (p) => dateTr(p.paid_on) }, { key: 'method', label: 'Yöntem' }, { key: 'reference', label: 'Referans' }, { key: 'amount_minor', label: 'Tutar', money: 'currency' }]} rows=${d.payouts} empty="Ödeme yok" />
      `;
    }}</${Loading}>
    ${prompt}
  </${Modal}>`;
}

export { Card };
