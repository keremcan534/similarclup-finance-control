import { Badge, Card, DateRange, Kpi, Loading, MiniChart, Modal, Page, Table, dateTimeTr, html, money, monthStart, num, qs, today, useApi, useApp, useState } from '../lib.js';

const KPIS = [
  ['gross_sales', 'Brüt satışlar', 'Kullanıcı satın alımları (iade öncesi)'],
  ['collected', 'Gerçekleşen tahsilat', 'Brüt − iade/ters ibraz'],
  ['net_revenue', 'Net gelir', 'Tahsilat − vergi − kanal kesintisi'],
  ['expense_paid', 'Gerçekleşen gider (ödenen)', 'Hakediş ödemeleri + ödenen giderler'],
  ['expense_accrued', 'Tahakkuk eden giderler', 'Komisyon, maaş, servis, katalog, genel gider'],
  ['commissions_paid', 'Ödenen komisyonlar', 'Dönemde yapılan hakediş ödemeleri'],
  ['pending_agency', 'Bekleyen ajans hakedişleri', 'Hesaplanan/onaylı ödenmemiş + henüz hakedişe girmemiş'],
  ['pending_bd', 'Bekleyen BD komisyonları', null],
  ['pending_publisher', 'Bekleyen yayıncı hakedişleri', 'Maaşlar dahil'],
  ['technical_services', 'Teknik servis giderleri', 'Faturalı + tahmini'],
  ['operating_result', 'Dönem net işletme sonucu', 'Net gelir − tahakkuk eden giderler'],
  ['cash', 'Mevcut nakit', 'Son banka bakiyeleri'],
  ['upcoming_obligations', 'Yaklaşan ödeme yükümlülükleri', 'Ay sonuna kadar'],
  ['month_end_cash_forecast', 'Tahmini ay sonu nakit', 'Nakit + bekleyen tahsilat − yükümlülük'],
];

export function Dashboard() {
  const { meta } = useApp();
  const cur = meta.reporting_currency;
  const [range, setRange] = useState({ from: monthStart(), to: today() });
  const s = useApi(`/api/dashboard${qs(range)}`);
  const series = useApi(`/api/dashboard/series${qs(range)}`);
  const live = useApi('/api/dashboard/live');
  const [drill, setDrill] = useState(null);
  return html`<${Page} title="Ana panel" subtitle="Tüm tutarlar ${cur} cinsinden; her kart, hesaplandığı işlemlere tıklanarak açılır." actions=${html`<${DateRange} value=${range} onChange=${setRange} />`}>
    <${Loading} state=${s}>${(d) => html`
      <div class="kpis">
        ${KPIS.map(([k, label, sub]) => {
          const v = d.totals[k];
          const missing = v === null;
          const tone = k === 'operating_result' ? (BigInt(v ?? 0) < 0n ? 'bad' : 'ok') : missing ? 'warn' : '';
          const note =
            missing ? (k === 'cash' || k === 'month_end_cash_forecast' ? 'Nakit bakiyesi girilmemiş' : 'Veri yok')
            : k === 'technical_services' && BigInt(d.services.estimated) > 0n ? `${money(d.services.estimated, cur)} tahmini`
            : null;
          return html`<${Kpi} label=${label} value=${missing ? '—' : money(v, cur)} sub=${sub} tone=${note ? 'warn' : tone} note=${note} onClick=${() => setDrill({ k, label })} />`;
        })}
      </div>
      <div class="grid cols2">
        <${Card} title="Günlük seri">
          <${Loading} state=${series}>${(x) => html`<${MiniChart} series=${x.series} keys=${[{ key: 'gross', label: 'Brüt satış', cur }, { key: 'net', label: 'Net gelir', cur }, { key: 'commissions', label: 'Komisyon', cur }, { key: 'expenses', label: 'Genel gider', cur }]} />`}</${Loading}>
        </${Card}>
        <${Card} title="Gider dağılımı (tahakkuk)">
          <dl class="kv">
            <dt>Komisyonlar</dt><dd>${money(d.commissions.total, cur)}</dd>
            ${Object.entries(d.commissions.by_beneficiary).map(([k, v]) => html`<dt>  · ${{ agency: 'Ajans', bd: 'BD', publisher: 'Yayıncı', other: 'Diğer', provider: 'Sağlayıcı' }[k] ?? k}</dt><dd>${money(v, cur)}</dd>`)}
            <dt>Maaş, garanti, bonus, düzeltme</dt><dd>${money(d.payroll.total, cur)}</dd>
            <dt>Teknik servisler</dt><dd>${money(d.services.total, cur)}</dd>
            <dt>Oyun, hediye, emoji, PK</dt><dd>${money(d.catalog.total, cur)}</dd>
            <dt>Genel giderler</dt><dd>${money(d.expenses.total, cur)}</dd>
            <dt><strong>Toplam</strong></dt><dd><strong>${money(d.totals.expense_total, cur)}</strong></dd>
          </dl>
          <h3>Gelir köprüsü</h3>
          <dl class="kv">
            <dt>Brüt satış</dt><dd>${money(d.revenue.gross_sales, cur)}</dd>
            <dt>İade / ters ibraz</dt><dd>${money(d.revenue.refunds, cur)}</dd>
            <dt>Vergi</dt><dd>${money(-BigInt(d.revenue.taxes), cur)}</dd>
            <dt>Kanal kesintisi</dt><dd>${money(-BigInt(d.revenue.channel_fees), cur)}</dd>
            <dt><strong>Net tahsilat</strong></dt><dd><strong>${money(d.revenue.net_collected, cur)}</strong></dd>
          </dl>
          <p class="muted" style="margin-top:8px">Lucky Gift ödül jetonları gider sayılmaz: ${num(d.lucky.reward_coins)} ödül / ${num(d.lucky.spent_coins)} harcanan jeton${d.lucky.reward_value !== null ? ` (bilgi amaçlı değer ${money(d.lucky.reward_value, cur)})` : ''}.</p>
        </${Card}>
      </div>
      <${DataQuality} d=${d} />
    `}</${Loading}>
    <${Live} state=${live} cur=${cur} />
    ${drill && html`<${Drill} metric=${drill} range=${range} cur=${cur} onClose=${() => setDrill(null)} />`}
  </${Page}>`;
}

function DataQuality({ d }) {
  const q = d.data_quality;
  const items = [];
  if (q.fx_gaps.length) items.push(html`<li>${q.fx_gaps.length} kalemde kur eksik (${[...new Set(q.fx_gaps.map((g) => g.currency))].join(', ')}) — bu tutarlar toplamlara <strong>dahil edilmedi</strong>. Ayarlar → Kurlar.</li>`);
  if (q.open_calculation_issues) items.push(html`<li>${q.open_calculation_issues} işlemin komisyonu hesaplanamadı. <a href="#/rules?tab=issues">Sorunları gör</a></li>`);
  if (q.missing_usage.length) items.push(html`<li>${q.missing_usage.length} servis için kullanım verisi yok (${q.missing_usage.slice(0, 3).map((m) => m.provider + ' ' + m.service).join(', ')}…) — maliyet 0 kabul edilmedi.</li>`);
  if (q.cash_accounts_without_balance.length) items.push(html`<li>Bakiye girilmemiş nakit hesapları: ${q.cash_accounts_without_balance.join(', ')}</li>`);
  if (BigInt(q.estimated_service_costs) > 0n) items.push(html`<li>Servis maliyetlerinin bir kısmı faturayla doğrulanmamış tahmindir.</li>`);
  const bad = q.integrations.filter((i) => i.status !== 'connected');
  if (bad.length) items.push(html`<li>Bağlı olmayan entegrasyonlar: ${bad.map((i) => i.name).join(', ')} — bu kaynaklardan gelen veriler canlı değildir.</li>`);
  return html`<${Card} title="Veri kalitesi ve entegrasyon durumu">
    ${items.length ? html`<ul class="note warn" style="margin:0;padding-left:28px">${items}</ul>` : html`<div class="note">Eksik veri tespit edilmedi.</div>`}
  </${Card}>`;
}

function Live({ state, cur }) {
  return html`<${Card} title="Canlı operasyon göstergeleri">
    <${Loading} state=${state}>${(l) => html`
      <p class="muted">Son veri: ${dateTimeTr(l.last_event_at)} · Yalnız bağlı kaynaklardan gelen değerler gösterilir; bağlı olmayan alanlar boş bırakılır.</p>
      <${Table}
        dense
        columns=${[
          { key: 'k', label: 'Gösterge' },
          { key: 'v', label: 'Değer', align: 'right' },
          { key: 'src', label: 'Kaynak' },
        ]}
        rows=${Object.entries(l.metrics).map(([k, m]) => ({
          id: k,
          k: { active_users_today: 'Bugün aktif kullanıcı', events_last_hour: 'Son 1 saatte olay', voice_call_minutes_today: 'Sesli görüşme dakikası (bugün)', video_call_minutes_today: 'Görüntülü görüşme dakikası (bugün)', connected_users: 'Anlık bağlı kullanıcı', active_rooms: 'Aktif oda', active_voice_connections: 'Aktif sesli bağlantı', active_video_calls: 'Aktif görüntülü görüşme', server_resources: 'Sunucu kaynak kullanımı' }[k] ?? k,
          v: m.available ? num(m.value) : html`<span class="muted">—</span>`,
          src: m.available ? m.source : html`<${Badge} s="not_connected" label=${m.source} />`,
        }))}
      />
      <h3>Bu ayın servis maliyeti tahmini</h3>
      <${Table}
        dense
        columns=${[
          { key: 'provider', label: 'Sağlayıcı' },
          { key: 'service', label: 'Servis' },
          { key: 'quantity', label: 'Kullanım', align: 'right', render: (r) => (r.quantity === null ? '—' : `${num(r.quantity, 0)} ${r.unit}`) },
          { key: 'amount_minor', label: 'Tutar', money: 'currency' },
          { key: 'status', label: 'Durum', render: (r) => html`<${Badge} s=${r.status} />` },
          { key: 'last_usage_at', label: 'Son güncelleme', render: (r) => dateTimeTr(r.last_usage_at) },
        ]}
        rows=${l.month_service_costs}
      />
    `}</${Loading}>
  </${Card}>`;
}

const DRILL_METRIC = { expense_accrued: 'expense_total', collected: 'collected', net_revenue: 'net_revenue', month_end_cash_forecast: 'upcoming_obligations' };

function Drill({ metric, range, cur, onClose }) {
  const m = DRILL_METRIC[metric.k] ?? metric.k;
  const s = useApi(`/api/dashboard/drill${qs({ metric: m, ...range })}`);
  return html`<${Modal} title=${`${metric.label} — kaynak kayıtlar`} wide onClose=${onClose}>
    ${metric.k === 'expense_accrued' && html`<div class="note">Liste genel giderleri gösterir; komisyon, maaş ve servis kalemleri ilgili ekranlardadır.</div>`}
    <${Loading} state=${s}>${(d) => {
      const rows = d.rows;
      if (!rows.length) return html`<div class="empty">Bu dönemde kayıt yok</div>`;
      const cols = Object.keys(rows[0])
        .filter((k) => !['meta', 'trace'].includes(k))
        .map((k) => (k.endsWith('_minor') ? { key: k, label: k.replace('_minor', ''), money: rows[0].currency ? 'currency' : cur } : { key: k, label: k }));
      return html`<p class="muted">${rows.length} kayıt${rows.length >= 500 ? ' (ilk 500)' : ''}</p><${Table} dense columns=${cols} rows=${rows} />`;
    }}</${Loading}>
  </${Modal}>`;
}
