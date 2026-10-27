import { Badge, Button, Card, DateRange, Loading, Modal, Page, Table, Tabs, act, dateTimeTr, html, monthStart, num, post, qs, today, useApi, useApp, useState } from '../lib.js';

export function Lucky() {
  const { can } = useApp();
  const [tab, setTab] = useState('analysis');
  const [range, setRange] = useState({ from: monthStart(), to: today() });
  const cfg = useApi('/api/lucky');
  const an = useApi(tab === 'analysis' ? `/api/lucky/analysis${qs(range)}` : null);
  const res = useApi(tab === 'results' ? '/api/lucky/results?limit=300' : null);
  const [edit, setEdit] = useState(null);
  return html`<${Page}
    title="Lucky Gift ve çarpanlı ödül ekonomisi"
    subtitle="Ödül jetonları doğrudan para gideri değildir; teorik ve gerçekleşen geri ödeme, rezerv ve sapmalar izlenir. Olasılık tablosu değişikliği yeni sürüm ve ikinci onay gerektirir."
    actions=${can('lucky.edit') && html`<${Button} kind="primary" onClick=${() => setEdit({ isNew: true })}>Yeni yapılandırma</${Button}>`}
  >
    <${Tabs} tabs=${[['analysis', 'Ekonomik analiz'], ['configs', 'Olasılık tabloları'], ['results', 'Sonuç kayıtları']]} value=${tab} onChange=${setTab} />
    ${tab === 'analysis' && html`<div class="row" style="margin-bottom:10px"><${DateRange} value=${range} onChange=${setRange} /></div><${Loading} state=${an}>${(d) =>
      d.rows.length
        ? d.rows.map((a) => html`<${Card} title=${`${a.name} (${a.code}) v${a.version}`} actions=${html`<${Badge} s=${a.status} />${a.reserve_warning ? html` <${Badge} s="critical" label="Rezerv yetersiz" />` : ''}`}>
            <div class="kpis">
              <div class="kpi"><span class="kpi-l">Çekiliş</span><strong class="kpi-v">${num(a.draws)}</strong></div>
              <div class="kpi"><span class="kpi-l">Harcanan jeton</span><strong class="kpi-v">${num(a.spent_coins)}</strong></div>
              <div class="kpi"><span class="kpi-l">Verilen ödül jetonu</span><strong class="kpi-v">${num(a.reward_coins)}</strong></div>
              <div class="kpi"><span class="kpi-l">Beklenen ödül</span><strong class="kpi-v">${num(a.expected_reward_coins)}</strong><span class="kpi-s">Fark ${num(a.difference_coins)}</span></div>
              <div class="kpi"><span class="kpi-l">Gerçekleşen / teorik ort. çarpan</span><strong class="kpi-v">${a.realised_multiplier ?? '—'} / ${a.expected_multiplier}</strong></div>
              <div class="kpi"><span class="kpi-l">Kalan ödül bütçesi</span><strong class="kpi-v">${a.reserve_left === null ? 'sınırsız' : num(a.reserve_left)}</strong><span class="kpi-s">Rezerv ${num(a.reserve_coins)}</span></div>
            </div>
            <${Table} dense columns=${[
              { key: 'multiplier', label: 'Çarpan', render: (r) => `${r.multiplier}x` },
              { key: 'probability', label: 'Olasılık', align: 'right' },
              { key: 'count', label: 'Gerçekleşen', align: 'right' },
              { key: 'expected_count', label: 'Beklenen', align: 'right' },
              { key: 'z', label: 'Sapma (z)', align: 'right', render: (r) => html`<span class=${r.unusual ? 'badge bad' : ''}>${r.z}</span>` },
            ]} rows=${a.distribution} />
          </${Card}>`)
        : html`<div class="empty">Yürürlükte Lucky yapılandırması yok</div>`}</${Loading}>`}
    ${tab === 'configs' && html`<${Loading} state=${cfg}>${(d) => d.rows.map((c) => html`<${Card} title=${`${c.name} (${c.code})`} actions=${can('lucky.edit') && html`<${Button} onClick=${() => setEdit({ code: c.code, from: c.versions[0] })}>Yeni sürüm</${Button}>`}>
      <${Table} dense columns=${[
        { key: 'version', label: 'Sürüm', render: (v) => `v${v.version}` },
        { key: 'status', label: 'Durum', render: (v) => html`<${Badge} s=${v.status} />` },
        { key: 'gift_cost_coins', label: 'Hediye maliyeti', align: 'right' },
        { key: 'odds', label: 'Tablo', render: (v) => v.odds.map((o) => `${o.multiplier}x:${o.probability}`).join('  ') },
        { key: 'expected_multiplier', label: 'Teorik geri ödeme', align: 'right' },
        { key: 'max_reward_coins', label: 'Maks. ödül', align: 'right' },
        { key: 'limits', label: 'Limitler', render: (v) => `günlük ${v.daily_reward_limit_coins ?? '∞'} · kişi ${v.per_user_daily_limit_coins ?? '∞'} · bütçe ${v.total_budget_coins ?? '∞'} · rezerv ${v.reserve_coins}` },
        { key: 'valid', label: 'Geçerlilik', render: (v) => (v.status === 'draft' ? '—' : `${dateTimeTr(v.valid_from)} → ${v.valid_to ? dateTimeTr(v.valid_to) : 'süresiz'}`) },
        { key: 'a', label: '', render: (v) => v.status === 'draft' && can('lucky.edit') && html`<${Button} kind="primary" onClick=${async () => (await act(() => post(`/api/lucky/versions/${v.id}/activate`), (r) => (r.status === 'pending' ? 'Onay talebi oluşturuldu' : 'Yürürlüğe alındı'))) && cfg.reload()}>Yürürlüğe al</${Button}>` },
      ]} rows=${c.versions} />
    </${Card}>`)}</${Loading}>`}
    ${tab === 'results' && html`<${Loading} state=${res}>${(d) => html`<${Table} dense columns=${[
      { key: 'occurred_at', label: 'Zaman', render: (r) => dateTimeTr(r.occurred_at) }, { key: 'code', label: 'Yapılandırma', render: (r) => `${r.code} v${r.version}` },
      { key: 'idempotency_key', label: 'İşlem' }, { key: 'user_ref', label: 'Kullanıcı' }, { key: 'spent_coins', label: 'Harcanan', align: 'right' },
      { key: 'random_value', label: 'Rastgele değer', align: 'right' }, { key: 'multiplier', label: 'Çarpan', align: 'right' }, { key: 'reward_coins', label: 'Ödül', align: 'right' },
      { key: 'capped', label: 'Sınır', render: (r) => (r.capped ? 'evet' : '') }, { key: 'source', label: 'Kaynak' },
    ]} rows=${d.rows} />`}</${Loading}>`}
    ${edit && html`<${LuckyEditor} ...${edit} onClose=${() => setEdit(null)} onSaved=${() => (setEdit(null), cfg.reload(), setTab('configs'))} />`}
  </${Page}>`;
}

function LuckyEditor({ isNew, code, from, onClose, onSaved }) {
  const [v, setV] = useState({
    code: code ?? '',
    name: '',
    gift_cost_coins: String(from?.gift_cost_coins ?? 100),
    max_reward_coins: String(from?.max_reward_coins ?? 100000),
    daily_reward_limit_coins: from?.daily_reward_limit_coins ?? '',
    per_user_daily_limit_coins: from?.per_user_daily_limit_coins ?? '',
    total_budget_coins: from?.total_budget_coins ?? '',
    reserve_coins: String(from?.reserve_coins ?? 0),
  });
  const [odds, setOdds] = useState(from?.odds ?? [{ multiplier: '0', probability: '0.7' }, { multiplier: '2', probability: '0.25' }, { multiplier: '10', probability: '0.049' }, { multiplier: '100', probability: '0.001' }]);
  // Float only for the on-screen hint; the server validates the exact decimal sum.
  const sum = odds.reduce((s, o) => s + Number(o.probability || 0), 0);
  const ev = odds.reduce((s, o) => s + Number(o.multiplier || 0) * Number(o.probability || 0), 0);
  const f = (k, label) => html`<label class="field"><span>${label}</span><input value=${v[k]} onInput=${(e) => setV({ ...v, [k]: e.target.value })} /></label>`;
  return html`<${Modal} title=${isNew ? 'Yeni Lucky yapılandırması' : `${code} · yeni sürüm`} wide onClose=${onClose}>
    <div class="form"><div class="grid2">
      ${isNew && html`${f('code', 'Kod')}${f('name', 'Ad')}`}
      ${f('gift_cost_coins', 'Hediye maliyeti (jeton)')}
      ${f('max_reward_coins', 'Tek ödülde maksimum (jeton)')}
      ${f('daily_reward_limit_coins', 'Günlük toplam ödül limiti (boş = sınırsız)')}
      ${f('per_user_daily_limit_coins', 'Kullanıcı başına günlük limit')}
      ${f('total_budget_coins', 'Toplam ödül bütçesi')}
      ${f('reserve_coins', 'Uyarı için rezerv eşiği')}
    </div></div>
    <h3>Olasılık tablosu</h3>
    ${odds.map((o, i) => html`<div class="row gap" style="margin-bottom:4px">
      <input aria-label="Çarpan" value=${o.multiplier} onInput=${(e) => setOdds(odds.map((x, j) => (j === i ? { ...x, multiplier: e.target.value } : x)))} /><span>x</span>
      <input aria-label="Olasılık" value=${o.probability} onInput=${(e) => setOdds(odds.map((x, j) => (j === i ? { ...x, probability: e.target.value } : x)))} />
      <${Button} kind="ghost" onClick=${() => setOdds(odds.filter((_, j) => j !== i))}>✕</${Button}>
    </div>`)}
    <${Button} onClick=${() => setOdds([...odds, { multiplier: '1', probability: '0' }])}>Satır ekle</${Button}>
    <p class=${Math.abs(sum - 1) > 1e-12 ? 'note bad' : 'note'}>Olasılık toplamı ≈ ${sum.toFixed(6)} (tam olarak 1 olmalı) · Teorik geri ödeme ≈ ${ev.toFixed(4)} (1’in altı: harcanan jetonun ortalama ${((1 - ev) * 100).toFixed(2)}%’i kullanıcıya dönmez)</p>
    <div class="row end gap"><${Button} onClick=${onClose}>Vazgeç</${Button}><${Button} kind="primary" onClick=${async () => {
      const body = { ...v, odds };
      for (const k of ['gift_cost_coins', 'max_reward_coins', 'daily_reward_limit_coins', 'per_user_daily_limit_coins', 'total_budget_coins', 'reserve_coins']) body[k] = body[k] === '' ? null : Number(body[k]);
      (await act(() => post(`/api/lucky/${encodeURIComponent(v.code)}/versions`, body), 'Taslak sürüm kaydedildi')) && onSaved();
    }}>Taslak kaydet</${Button}></div>
  </${Modal}>`;
}
