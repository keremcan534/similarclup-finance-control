import { Button, Card, DateRange, Loading, Page, Table, Tabs, decMoney, downloadUrl, html, money, monthStart, num, qs, today, useApi, useApp, useState } from '../lib.js';

const TABS = [
  ['pnl', 'Gelir-gider ve nakit'],
  ['agencies', 'Ajans katkısı'],
  ['bds', 'BD performansı'],
  ['publishers', 'Yayıncı hakediş ve katkı'],
  ['unit', 'Birim ekonomi'],
  ['catalog', 'Oyun ve hediye'],
];

export function Reports({ query }) {
  const { can, meta, user } = useApp();
  const agencyUser = user.scope === 'agency';
  const tabs = agencyUser ? TABS.filter(([k]) => ['agencies', 'publishers'].includes(k)) : TABS;
  const [tab, setTab] = useState(query.get('tab') ?? tabs[0][0]);
  const [range, setRange] = useState({ from: monthStart(), to: today() });
  const s = useApi(`/api/reports/${tab}${qs(range)}`);
  const cur = meta.reporting_currency;
  return html`<${Page}
    title="Raporlar"
    subtitle="Her rapor aynı defterden üretilir; bir gelir veya gider yalnız bir kalemde sayılır. Kur eksikse ilgili tutar toplama alınmaz ve belirtilir."
    actions=${html`<${DateRange} value=${range} onChange=${setRange} />${can('reports.export') && html`<${Button} onClick=${() => downloadUrl(`/api/reports/${tab}${qs({ ...range, format: 'csv' })}`)}>CSV indir</${Button}>`}`}
  >
    <${Tabs} tabs=${tabs} value=${tab} onChange=${setTab} />
    <${Loading} state=${s}>${(d) => {
      switch (tab) {
        case 'pnl':
          return html`<${Pnl} d=${d} />`;
        case 'agencies':
          return html`<${Table} columns=${[
            { key: 'name', label: 'Ajans' }, { key: 'publishers', label: 'Yayıncı', align: 'right' }, { key: 'active_publishers', label: 'Aktif', align: 'right' },
            { key: 'revenue', label: 'Uygun gelir', money: cur }, { key: 'agency_commission', label: 'Ajans komisyonu', money: cur }, { key: 'publisher_share', label: 'Yayıncı payı', money: cur },
            { key: 'bd_share', label: 'BD payı', money: cur }, { key: 'other_share', label: 'Diğer', money: cur }, { key: 'net_contribution', label: 'Net katkı', money: cur },
          ]} rows=${d.rows} />${gaps(d.gaps)}`;
        case 'bds':
        case 'publishers':
          return html`<${Table} columns=${[
            ...(tab === 'publishers' ? [{ key: 'external_id', label: 'Similar Club id' }] : [{ key: 'code', label: 'Kod' }]),
            { key: 'name', label: 'Ad' },
            { key: 'eligible_revenue', label: 'Uygun gelir', align: 'right', render: (r) => decMoney(r.eligible_revenue, r.currency) },
            { key: 'commission_total', label: 'Komisyon', align: 'right', render: (r) => decMoney(r.commission_total, r.currency) },
            ...(tab === 'bds' ? [{ key: 'agency_count', label: 'Ajans', align: 'right' }, { key: 'new_agencies', label: 'Yeni ajans', align: 'right' }, { key: 'active_publishers', label: 'Aktif yayıncı', align: 'right' }] : [{ key: 'gift_coins', label: 'Hediye jetonu', align: 'right', render: (r) => num(r.gift_coins) }, { key: 'call_minutes', label: 'Arama dk', align: 'right', render: (r) => num(r.call_minutes) }]),
            { key: 'total_minor', label: 'Dönem hakedişi', money: 'currency' },
            { key: 'paid_minor', label: 'Ödenen', money: 'currency' },
            { key: 'pending_minor', label: 'Bekleyen', money: 'currency' },
          ]} rows=${d.rows} />`;
        case 'unit':
          return html`<div class="grid cols2"><${Card} title="Birim ekonomi"><dl class="kv">
            <dt>Aktif kullanıcı</dt><dd>${num(d.active_users)}</dd>
            <dt>Ödeme yapan kullanıcı</dt><dd>${num(d.paying_users)} (${d.paying_ratio ?? '—'}%)</dd>
            <dt>Aktif kullanıcı başına net gelir</dt><dd>${dm(d.net_revenue_per_active_user)}</dd>
            <dt>Ödeme yapan başına gelir (ARPPU)</dt><dd>${dm(d.arppu)}</dd>
            <dt>Aktif kullanıcı başına toplam maliyet</dt><dd>${dm(d.cost_per_active_user)}</dd>
            <dt>Aktif kullanıcı başına servis maliyeti</dt><dd>${dm(d.service_cost_per_active_user)}</dd>
            <dt>Sesli dakika / saatlik maliyet</dt><dd>${num(d.voice_minutes)} dk · ${dm(d.voice_cost_per_hour)}</dd>
            <dt>Görüntülü dakika / saatlik maliyet</dt><dd>${num(d.video_minutes)} dk · ${dm(d.video_cost_per_hour)}</dd>
            <dt>Kullanıcı kazanım gideri</dt><dd>${money(d.acquisition_cost, cur)} · yeni ödeyen başına ${dm(d.acquisition_cost_per_new_payer)}</dd>
          </dl></${Card}><${Card} title="Yöntem"><p class="muted">Aktif kullanıcı: dönemde jeton hareketi olan farklı kullanıcı. Ödeme yapan: dönemde satın alma yapan. Saatlik ses/video maliyeti, ilgili kategorideki servis maliyetinin servis kullanım kayıtlarındaki dakikaya bölünmesidir (kayıt yoksa arama olaylarının dakikası kullanılır). Veri yoksa "—" gösterilir.</p>${gaps(d.gaps)}</${Card}></div>`;
        case 'catalog':
          return html`<${Table} columns=${[{ key: 'name', label: 'Öğe' }, { key: 'kind', label: 'Tür' }, { key: 'uses', label: 'Kullanım', align: 'right' }, { key: 'revenue', label: 'Gelir', money: cur }, { key: 'commissions', label: 'Pay', money: cur }, { key: 'total', label: 'Maliyet', money: cur }, { key: 'net_contribution', label: 'Net', money: cur }]} rows=${d.items} />`;
      }
    }}</${Loading}>
  </${Page}>`;
  function dm(v) {
    return v === null ? '—' : decMoney(v, cur);
  }
}

function gaps(g) {
  return g?.length ? html`<div class="note warn">Kur eksikliği nedeniyle toplama alınmayan ${g.length} kalem var (${[...new Set(g.map((x) => x.currency))].join(', ')}).</div>` : '';
}

function Pnl({ d }) {
  const c = d.currency;
  const L = (label, v, strong) => html`<tr><td>${strong ? html`<strong>${label}</strong>` : label}</td><td class="r num">${strong ? html`<strong>${money(v, c)}</strong>` : money(v, c)}</td></tr>`;
  const neg = (v) => -BigInt(v);
  return html`<div class="grid cols2">
    <${Card} title="Gelir tablosu (tahakkuk esaslı)">
      <div class="table-wrap"><table>
        ${L('Brüt satış', d.revenue.gross_sales)}
        ${L('İade ve ters ibraz', d.revenue.refunds)}
        ${L('Vergi', neg(d.revenue.taxes))}
        ${L('Ödeme kanalı kesintisi', neg(d.revenue.channel_fees))}
        ${L('Net tahsilat (net gelir)', d.revenue.net_collected, true)}
        ${Object.entries(d.commissions.by_beneficiary).map(([k, v]) => L(`Komisyon · ${({ agency: 'ajans', bd: 'BD', publisher: 'yayıncı', other: 'diğer', provider: 'sağlayıcı' })[k] ?? k}`, neg(v)))}
        ${Object.entries(d.payroll.by_kind).map(([k, v]) => L(`Hakediş · ${({ salary: 'sabit maaş', min_guarantee_topup: 'garanti tamamlaması', bonus: 'bonus/prim', deduction: 'kesinti', adjustment: 'düzeltme' })[k] ?? k}`, neg(v)))}
        ${Object.entries(d.services.by_category).map(([k, v]) => L(`Servis · ${k}`, neg(v)))}
        ${L('Oyun, hediye, emoji, PK', neg(d.catalog.total))}
        ${Object.entries(d.expenses.by_category).map(([k, v]) => L(`Gider · ${k}`, neg(v)))}
        ${L('Net işletme sonucu', d.totals.operating_result, true)}
      </table></div>
      ${BigInt(d.services.estimated) > 0n && html`<p class="muted">Servis maliyetlerinin ${money(d.services.estimated, c)} kadarı faturayla doğrulanmamış tahmindir.</p>`}
      ${gaps(d.data_quality.fx_gaps)}
    </${Card}>
    <${Card} title="Nakit akışı ve yükümlülükler">
      <div class="table-wrap"><table>
        ${L('Mevcut nakit', d.totals.cash ?? 0)}
        ${L('Bekleyen kanal tahsilatı', d.pending_collections)}
        ${L('Onaylı ödenmemiş hakedişler', neg(d.obligations.approved_unpaid))}
        ${L('Vadesi gelen giderler', neg(d.obligations.expenses_due))}
        ${L('Vadesi gelen faturalar', neg(d.obligations.invoices_due))}
        ${L('Tahmini ay sonu nakit', d.totals.month_end_cash_forecast ?? 0, true)}
      </table></div>
      ${d.totals.cash === null && html`<div class="note warn">Nakit bakiyesi girilmediği için nakit tahmini hesaplanamaz.</div>`}
      <h3>Hakedişe henüz girmemiş tahakkuklar</h3>
      <dl class="kv">${Object.entries(d.obligations.unstated_commissions).map(([k, v]) => html`<dt>${({ agency: 'Ajans', bd: 'BD', publisher: 'Yayıncı' })[k]}</dt><dd>${money(v, c)}</dd>`)}</dl>
      <h3>Dönemde gerçekleşen çıkışlar</h3>
      <dl class="kv"><dt>Hakediş ödemeleri</dt><dd>${money(d.totals.commissions_paid, c)}</dd><dt>Toplam ödenen</dt><dd>${money(d.totals.expense_paid, c)}</dd></dl>
    </${Card}>
  </div>`;
}
