import { Button, Card, Loading, Page, Table, act, decMoney, get, html, num, post, useApi, useApp, useEffect, useState } from '../lib.js';

const ROWS = [
  ['dau', 'Günlük aktif kullanıcı', 'n'],
  ['concurrent', 'Eşzamanlı kullanıcı', 'n'],
  ['paying_users', 'Ödeme yapan kullanıcı', 'n'],
  ['gross_revenue', 'Tahmini brüt gelir', 'm'],
  ['net_revenue', 'Tahmini net gelir', 'm'],
  ['commissions.total', 'Komisyon ve hakedişler', 'm'],
  ['technical.total', 'Tahmini teknik gider', 'm'],
  ['technical.voice_video', '  · ses/video', 'm'],
  ['game_and_gift_costs', 'Oyun ve hediye maliyeti', 'm'],
  ['fixed_costs', 'Sabit giderler', 'm'],
  ['operating_costs', 'Toplam operasyon gideri', 'm'],
  ['net_result', 'Tahmini net sonuç', 'm'],
  ['cash_need', 'Tahmini nakit ihtiyacı', 'm'],
  ['breakeven_gross_revenue', 'Başa baş için gerekli brüt gelir', 'm'],
  ['breakeven_paying_percent', 'Başa baş için ödeme yapan oranı (%)', 'p'],
  ['marginal_cost_per_user', 'İlave kullanıcının marjinal maliyeti', 'm'],
];
const pick = (o, path) => path.split('.').reduce((x, k) => x?.[k], o);

export function Simulation() {
  const { meta } = useApp();
  const cur = meta.reporting_currency;
  const [inputs, setInputs] = useState(() => Object.fromEntries(meta.simulation_inputs.map((i) => [i.key, i.def])));
  const [result, setResult] = useState(null);
  const saved = useApi('/api/forecasts');
  const run = async () => setResult(await act(() => post('/api/simulation/run', { inputs })));
  useEffect(() => {
    run();
  }, []);
  return html`<${Page} title="Büyüme simülasyonu ve başa baş" subtitle="Tahminler gerçekleşen verilerle karıştırılmaz; tüm sonuçlar soldaki varsayımlara dayanır.">
    <div class="grid" style="grid-template-columns:minmax(260px,360px) minmax(0,1fr)">
      <${Card} title="Varsayımlar">
        ${meta.simulation_inputs.map((i) => html`<label class="field" style="margin-bottom:6px"><span>${i.label} (${i.unit === 'para' ? cur : i.unit})</span><input inputmode="decimal" value=${inputs[i.key]} onInput=${(e) => setInputs({ ...inputs, [i.key]: e.target.value.replace(',', '.') })} /></label>`)}
        <div class="row gap wrap end">
          <${Button} onClick=${async () => {
            const name = prompt('Senaryo adı');
            if (name && (await act(() => post('/api/forecasts', { name, inputs }), 'Senaryo kaydedildi'))) saved.reload();
          }}>Kaydet</${Button}>
          <${Button} kind="primary" onClick=${run}>Hesapla</${Button}>
        </div>
        <${Loading} state=${saved}>${(d) => d.rows.length > 0 && html`<h3>Kayıtlı senaryolar</h3>${d.rows.map((f) => html`<div><a href="#" onClick=${(e) => (e.preventDefault(), setInputs({ ...inputs, ...f.inputs }))}>${f.name}</a></div>`)}`}</${Loading}>
      </${Card}>
      <div>
        ${result && html`<${Card} title="Aylık projeksiyon (30 gün)">
          <div class="note warn">${result.disclaimer}</div>
          <${Table} dense columns=${[
            { key: 'label', label: 'Kalem' },
            { key: 'custom', label: `Girilen (${num(inputs.users)} kullanıcı)`, align: 'right' },
            ...result.scenarios.map((s, i) => ({ key: `s${i}`, label: `${num(s.users)} kullanıcı`, align: 'right' })),
          ]} rows=${ROWS.map(([k, label, t]) => {
            const f = (v) => (v === null || v === undefined ? '—' : t === 'm' ? decMoney(v, cur) : t === 'p' ? `%${v}` : num(v, 0));
            const row = { id: k, label, custom: f(pick(result.custom, k)) };
            result.scenarios.forEach((s, i) => (row[`s${i}`] = f(pick(s, k))));
            return row;
          })} />
        </${Card}>`}
      </div>
    </div>
  </${Page}>`;
}

export { get };
