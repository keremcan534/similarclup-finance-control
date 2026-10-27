import { Badge, Button, Card, Loading, Modal, Page, Table, Tabs, act, dateTimeTr, html, money, post, put, useApi, useApp, usePrompt, useState } from '../lib.js';
import { typeLabel } from './ledger.js';

const BEN = { agency: 'Ajans', bd: 'BD', publisher: 'Yayıncı', provider: 'Sağlayıcı', other: 'Diğer' };
const FROM = { tx_agency: 'İşlemin ajansı', tx_publisher: 'İşlemin yayıncısı', agency_bd: 'Ajansın BD’si' };

export function describe(c) {
  if (!c) return '—';
  const m = c.method;
  const how =
    m.type === 'percent' ? `%${m.percent}`
    : m.type === 'fixed' ? `sabit ${m.amount} ${c.currency}`
    : m.type === 'per_unit' ? `${m.measure === 'quantity' ? 'birim (dk)' : 'jeton'} başına ${m.price} ${c.currency}`
    : m.type === 'tiered' ? `${m.mode === 'marginal' ? 'dilimli' : 'kademeli'} (${m.tiers.map((t) => `${t.from}+ → %${t.percent}`).join(', ')})`
    : `formül: ${m.expr}`;
  const caps = [c.min && `min ${c.min}`, c.max && `maks ${c.max}`].filter(Boolean).join(', ');
  if (c.scope === 'period') return `Dönemsel · ${BEN[c.party_type]} · ölçü ${c.measure} · ${how}${caps ? ` · ${caps}` : ''}${c.condition ? ` · koşul ${c.condition}` : ''}`;
  return `${c.tx_types.map(typeLabel).join(', ')} → ${BEN[c.beneficiary.type]}${c.beneficiary.from ? ` (${FROM[c.beneficiary.from]})` : c.beneficiary.name ? ` (${c.beneficiary.name})` : ''} · matrah ${c.base} · ${how} · aşama ${c.stage}${caps ? ` · ${caps}` : ''}`;
}

export function Rules({ query }) {
  const { can } = useApp();
  const [tab, setTab] = useState(query.get('tab') ?? 'rules');
  const rules = useApi('/api/rules');
  const issues = useApi(tab === 'issues' ? '/api/rules-issues' : null);
  const [open, setOpen] = useState(null);
  const [editor, setEditor] = useState(null);
  return html`<${Page}
    title="Komisyon kuralları"
    subtitle="Oranlar, matrahlar, kademeler ve koşullar burada yönetilir; değişiklik yeni sürüm oluşturur, geçmiş hesaplar değişmez."
    actions=${can('rules.edit') && html`<${Button} kind="primary" onClick=${() => setEditor({ isNew: true })}>Yeni kural</${Button}>`}
  >
    <${Tabs} tabs=${[['rules', 'Kurallar'], ['issues', 'Hesaplama sorunları'], ['help', 'Nasıl çalışır']]} value=${tab} onChange=${setTab} />
    ${tab === 'rules' && html`<${Loading} state=${rules}>${(d) => html`<${Table}
      onRow=${(r) => setOpen(r.id)}
      columns=${[
        { key: 'code', label: 'Kod' },
        { key: 'name', label: 'Ad' },
        { key: 'category', label: 'Kategori' },
        { key: 'active', label: 'Yürürlükteki sürüm', render: (r) => (r.active ? html`v${r.active.version} <span class="muted">${dateTimeTr(r.active.valid_from)}</span>` : html`<${Badge} s="draft" label="Yürürlükte değil" />`) },
        { key: 'desc', label: 'Kural', render: (r) => html`<span class="wrap-cell" style="white-space:normal;display:block;max-width:560px">${describe(r.active?.config)}</span>` },
        { key: 'drafts', label: 'Taslak', render: (r) => (r.drafts ? html`<${Badge} s="pending" label=${`${r.drafts} taslak`} />` : '') },
      ]}
      rows=${d.rows}
      empty="Henüz kural yok. Komisyon zinciri yönetici tarafından tanımlanır; sistemde varsayılan oran yoktur."
    />`}</${Loading}>`}
    ${tab === 'issues' && html`<${Issues} state=${issues} />`}
    ${tab === 'help' && html`<${Help} />`}
    ${open && html`<${RuleDetail} id=${open} onClose=${() => setOpen(null)} onEdit=${(e) => setEditor(e)} reload=${rules.reload} />`}
    ${editor && html`<${RuleEditor} ...${editor} onClose=${() => setEditor(null)} onSaved=${() => (setEditor(null), rules.reload())} />`}
  </${Page}>`;
}

function Issues({ state }) {
  const { can } = useApp();
  return html`<${Card} title="Hesaplanamayan işlemler" actions=${can('rules.edit') && html`<${Button} onClick=${async () => (await act(() => post('/api/rules-issues/retry'), (r) => `${r.retried} işlem yeniden denendi, ${r.resolved} çözüldü`), state.reload())}>Yeniden hesapla</${Button}>`}>
    <div class="note">Bir işlemde dağıtım dağıtılabilir tutarı aşarsa, formül hata verirse ya da kur eksikse o işlem için hiçbir komisyon yazılmaz. Kuralı veya kuru düzeltip yeniden hesaplayın.</div>
    <${Loading} state=${state}>${(d) => html`<${Table} dense columns=${[{ key: 'id', label: '#' }, { key: 'tx', label: 'İşlem', render: (r) => html`<a href=${`#/ledger?tab=${r.tx_kind}`}>${r.tx_kind} #${r.tx_id}</a>` }, { key: 'kind', label: 'Tür' }, { key: 'message', label: 'Açıklama' }, { key: 'status', label: 'Durum', render: (r) => html`<${Badge} s=${r.status} />` }, { key: 'created_at', label: 'Zaman', render: (r) => dateTimeTr(r.created_at) }]} rows=${d.rows} empty="Sorun yok" />`}</${Loading}>
  </${Card}>`;
}

function Help() {
  const { meta } = useApp();
  return html`<div class="grid cols2">
    <${Card} title="Hesaplama sırası">
      <ol>
        <li>Her defter işlemi için, işlem tarihinde yürürlükte olan sürümler bulunur.</li>
        <li>Kurallar aşamaya göre sıralanır. Aynı aşamadaki kurallar <strong>paralel</strong> çalışır, yani aynı matrahı görür.</li>
        <li><code>remaining</code> değeri dağıtılabilir tutardan önceki aşamaların toplamı düşülerek bulunur. Bu, <strong>ardışık</strong> dağıtımı sağlar.</li>
        <li><code>r_kod</code> değişkeni önceki bir kuralın sonucunu verir.</li>
        <li>Sonuç min/maks sınırlarına çekilir ve seçilen yuvarlama ile kuruşa yuvarlanır.</li>
        <li>Toplam dağıtılabilir tutarı aşarsa hiçbir pay yazılmaz ve sorun kaydı açılır.</li>
        <li>İade olduğunda orijinal paylar iade oranında ters kayıtla geri alınır.</li>
      </ol>
      <p class="muted">Dönemsel kurallar (hedef, kademe, bonus, kesinti) hakediş hesaplanırken dönem toplamları üzerinden çalışır.</p>
    </${Card}>
    <${Card} title="Değişkenler ve fonksiyonlar">
      <h3>Para hareketi (financial)</h3><p><code>${meta.rule_variables.transaction.financial.join(', ')}</code></p>
      <h3>Jeton hareketi (wallet)</h3><p><code>${meta.rule_variables.transaction.wallet.join(', ')}</code></p>
      <h3>Dönemsel</h3>${Object.entries(meta.rule_variables.period).map(([k, v]) => html`<p>${BEN[k]}: <code>${v.join(', ')}</code></p>`)}
      <h3>Fonksiyonlar</h3><ul>${Object.values(meta.functions).map((d) => html`<li><code>${d}</code></li>`)}</ul>
      <p class="muted">Formüllerde serbest kod çalışmaz; yalnız bu değişkenler, sayılar, + − × ÷, karşılaştırmalar, && || ve yukarıdaki fonksiyonlar kullanılabilir.</p>
    </${Card}>
  </div>`;
}

function RuleDetail({ id, onClose, onEdit, reload }) {
  const { can } = useApp();
  const s = useApi(`/api/rules/${id}`);
  const [ask, prompt] = usePrompt();
  const activate = async (v) => {
    const r = await ask(`v${v.version} yürürlüğe alınsın mı?`, {
      text: 'Yürürlük tarihi bugünden önce olamaz. Çift onay açıksa talep başka bir yetkiliye düşer.',
      fields: [{ name: 'valid_from', label: 'Yürürlük tarihi (boş = hemen)', type: 'date' }],
      required: false,
      ok: 'Talep et',
    });
    if (!r) return;
    const out = await act(() => post(`/api/rules/versions/${v.id}/activate`, r.valid_from ? { valid_from: r.valid_from } : {}), (x) => (x.status === 'pending' ? 'Onay talebi oluşturuldu' : 'Yürürlüğe alındı'));
    if (out?.conflicts?.length) act(() => Promise.reject(new Error('Çakışma uyarısı: ' + out.conflicts.map((c) => `${c.rule} v${c.version}: ${c.reason}`).join(' · '))));
    s.reload();
    reload();
  };
  const retire = async () => {
    const r = await ask('Kural emekliye ayrılsın mı?', { text: 'Yeni işlemlere uygulanmaz; geçmiş hesaplar korunur.' });
    if (r && (await act(() => post(`/api/rules/${id}/retire`, r), 'Kural emekliye ayrıldı'))) (s.reload(), reload());
  };
  return html`<${Modal} title="Kural ayrıntısı" wide onClose=${onClose}>
    <${Loading} state=${s}>${(d) => html`
      <div class="row between wrap gap">
        <div><h2>${d.rule.code} · ${d.rule.name}</h2><p class="muted">${d.rule.description ?? ''}</p></div>
        <div class="row gap">
          ${can('rules.edit') && html`<${Button} kind="primary" onClick=${() => onEdit({ rule: d.rule, config: (d.versions.find((v) => v.status === 'active') ?? d.versions[0]).config })}>Yeni sürüm</${Button}>`}
          ${can('rules.activate') && d.versions.some((v) => v.status === 'active') && html`<${Button} kind="danger" onClick=${retire}>Emekliye ayır</${Button}>`}
        </div>
      </div>
      <${Table}
        columns=${[
          { key: 'version', label: 'Sürüm', render: (v) => `v${v.version}` },
          { key: 'status', label: 'Durum', render: (v) => html`<${Badge} s=${v.status} />` },
          { key: 'valid', label: 'Geçerlilik', render: (v) => (v.status === 'draft' ? '—' : `${dateTimeTr(v.valid_from)} → ${v.valid_to ? dateTimeTr(v.valid_to) : 'süresiz'}`) },
          { key: 'cfg', label: 'Kural', render: (v) => html`<span style="white-space:normal;display:block;max-width:520px">${describe(v.config)}</span>` },
          { key: 'act', label: '', render: (v) => v.status === 'draft' && can('rules.edit') && html`<div class="row gap"><${Button} onClick=${(e) => (e.stopPropagation(), onEdit({ rule: d.rule, config: v.config, versionId: v.id }))}>Düzenle</${Button}><${Button} kind="primary" onClick=${(e) => (e.stopPropagation(), activate(v))}>Yürürlüğe al</${Button}></div>` },
        ]}
        rows=${d.versions}
      />
      <h3>Kullanım</h3>
      <${Table} dense columns=${[{ key: 'version', label: 'Sürüm', render: (u) => `v${u.version}` }, { key: 'n', label: 'Kayıt', align: 'right' }, { key: 'total', label: 'Toplam', money: 'currency' }]} rows=${d.usage} empty="Bu kural henüz bir işleme uygulanmadı" />
    `}</${Loading}>
    ${prompt}
  </${Modal}>`;
}

const blank = (meta) => ({
  scope: 'transaction',
  tx_kind: 'wallet',
  tx_types: ['gift_receive'],
  beneficiary: { type: 'agency', from: 'tx_agency' },
  base: 'coin_value',
  method: { type: 'percent', percent: '10' },
  currency: meta.reporting_currency,
  rounding: 'half_even',
  stage: 1,
  refund: 'reverse_proportional',
  min: '',
  max: '',
  condition: '',
  filters: {},
  party_type: 'agency',
  measure: 'eligible_revenue',
  line_kind: 'bonus',
  party_ids: [],
});

function RuleEditor({ isNew, rule, config, versionId, onClose, onSaved }) {
  const { meta } = useApp();
  const [meta0, setMeta0] = useState({ code: '', name: '', category: 'agency', description: '' });
  const [c, setC] = useState(() => ({ ...blank(meta), ...(config ?? {}), method: { ...(config?.method ?? blank(meta).method) } }));
  const [check, setCheck] = useState(null);
  const [preview, setPreview] = useState(null);
  const [sample, setSample] = useState({ gross_amount: '120.00', tax_amount: '20.00', channel_fee: '18.00', coins: '1000', value: '100.00', units: '1000', quantity: '30', agency_id: '', publisher_id: '' });
  const set = (k, v) => setC((s) => ({ ...s, [k]: v }));
  const setM = (k, v) => setC((s) => ({ ...s, method: { ...s.method, [k]: v } }));
  const vars = c.scope === 'transaction' ? meta.rule_variables.transaction[c.tx_kind] : meta.rule_variables.period[c.party_type] ?? [];
  const build = () => {
    const out = { ...c };
    for (const k of ['min', 'max', 'condition']) if (!out[k]) delete out[k];
    if (out.scope === 'transaction') {
      delete out.party_type, delete out.measure, delete out.line_kind, delete out.party_ids;
      out.stage = Number(out.stage);
      const b = { type: out.beneficiary.type };
      if (out.beneficiary.from) b.from = out.beneficiary.from;
      else if (out.beneficiary.id) b.id = Number(out.beneficiary.id);
      else if (out.beneficiary.name) b.name = out.beneficiary.name;
      out.beneficiary = b;
    } else {
      for (const k of ['tx_kind', 'tx_types', 'beneficiary', 'base', 'stage', 'refund', 'filters']) delete out[k];
    }
    const m = out.method;
    out.method =
      m.type === 'percent' ? { type: 'percent', percent: m.percent }
      : m.type === 'fixed' ? { type: 'fixed', amount: m.amount }
      : m.type === 'per_unit' ? { type: 'per_unit', measure: m.measure ?? 'quantity', price: m.price }
      : m.type === 'tiered' ? { type: 'tiered', mode: m.mode ?? 'whole', tiers: m.tiers ?? [] }
      : { type: 'formula', expr: m.expr };
    return out;
  };
  const validate = async () => setCheck(await act(() => post('/api/rules/validate', { config: build(), rule_id: rule?.id })));
  const runPreview = async () => {
    const cfg = build();
    setPreview(await act(() => post('/api/rules/preview', { config: cfg, sample: { ...sample, currency: cfg.currency, units: Number(sample.units), coins: Number(sample.coins) } })));
  };
  const save = async () => {
    const cfg = build();
    let r;
    if (isNew) r = await act(() => post('/api/rules', { ...meta0, config: cfg }), 'Kural taslak olarak kaydedildi');
    else if (versionId) r = await act(() => put(`/api/rules/versions/${versionId}`, { config: cfg }), 'Taslak güncellendi');
    else r = await act(() => post(`/api/rules/${rule.id}/versions`, { config: cfg }), 'Yeni sürüm taslak olarak kaydedildi');
    if (r) {
      if (r.conflicts?.length) act(() => Promise.reject(new Error('Çakışma uyarısı: ' + r.conflicts.map((x) => `${x.rule}: ${x.reason}`).join(' · '))));
      onSaved();
    }
  };
  const types = meta.tx_types[c.tx_kind] ?? [];
  const sel = (label, value, onChange, options, hint) => html`<label class="field"><span>${label}</span><select value=${value} onChange=${(e) => onChange(e.target.value)}>${options.map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>${hint && html`<small class="muted">${hint}</small>`}</label>`;
  const inp = (label, value, onChange, hint, wide) => html`<label class=${`field ${wide ? 'wide' : ''}`}><span>${label}</span><input value=${value ?? ''} onInput=${(e) => onChange(e.target.value)} />${hint && html`<small class="muted">${hint}</small>`}</label>`;
  return html`<${Modal} title=${isNew ? 'Yeni komisyon kuralı' : `${rule.code} · ${versionId ? 'taslağı düzenle' : 'yeni sürüm'}`} wide onClose=${onClose}>
    <div class="form"><div class="grid2">
      ${isNew && html`
        ${inp('Kod (BÜYÜK_HARF)', meta0.code, (v) => setMeta0({ ...meta0, code: v.toUpperCase() }))}
        ${inp('Ad', meta0.name, (v) => setMeta0({ ...meta0, name: v }))}
        ${sel('Kategori', meta0.category, (v) => setMeta0({ ...meta0, category: v }), [['agency', 'Ajans'], ['bd', 'BD'], ['publisher', 'Yayıncı'], ['provider', 'Sağlayıcı'], ['other', 'Diğer']])}
        ${inp('Açıklama', meta0.description, (v) => setMeta0({ ...meta0, description: v }))}
      `}
      ${sel('Kapsam', c.scope, (v) => set('scope', v), [['transaction', 'İşlem bazlı (her işlemde)'], ['period', 'Dönemsel (hakediş hesaplanırken)']])}
      ${c.scope === 'transaction'
        ? html`
          ${sel('İşlem tipi', c.tx_kind, (v) => setC((s) => ({ ...s, tx_kind: v, tx_types: [], base: v === 'wallet' ? 'coin_value' : 'net_collected' })), [['wallet', 'Jeton hareketi (hediye, arama, oyun, Lucky)'], ['financial', 'Para hareketi (satın alma)']])}
          <fieldset class="field wide"><span>Uygulanacak işlem türleri</span><div class="row gap wrap">${types.map(
            (t) => html`<label class="chip ${c.tx_types.includes(t) ? 'on' : ''}"><input type="checkbox" style="display:none" checked=${c.tx_types.includes(t)} onChange=${(e) => set('tx_types', e.target.checked ? [...c.tx_types, t] : c.tx_types.filter((x) => x !== t))} />${typeLabel(t)}</label>`,
          )}</div></fieldset>
          ${sel('Alıcı türü', c.beneficiary.type, (v) => set('beneficiary', { type: v, from: { agency: 'tx_agency', publisher: 'tx_publisher', bd: 'agency_bd' }[v] }), Object.entries(BEN))}
          ${sel('Alıcı nasıl bulunur', c.beneficiary.from ?? '', (v) => set('beneficiary', { ...c.beneficiary, from: v || undefined }), [['', 'Sabit alıcı (aşağıda)'], ...Object.entries(FROM).filter(([k]) => ({ tx_agency: 'agency', tx_publisher: 'publisher', agency_bd: 'bd' })[k] === c.beneficiary.type)])}
          ${!c.beneficiary.from && html`${inp('Sabit alıcı id (ajans/BD/yayıncı)', c.beneficiary.id ?? '', (v) => set('beneficiary', { ...c.beneficiary, id: v }))}${inp('veya alıcı adı (sağlayıcı/diğer)', c.beneficiary.name ?? '', (v) => set('beneficiary', { ...c.beneficiary, name: v }))}`}
          ${inp('Matrah (değişken veya formül)', c.base, (v) => set('base', v), `Değişkenler: ${vars.join(', ')}`, true)}
          ${inp('Aşama', c.stage, (v) => set('stage', v), 'Aynı aşama = paralel (aynı matrah); sonraki aşama = remaining üzerinden')}
          ${sel('İade davranışı', c.refund, (v) => set('refund', v), [['reverse_proportional', 'İade oranında ters kayıt'], ['none', 'İadeden etkilenmez']])}
          ${inp('Filtre: ürün/öğe kodları (virgülle)', [...(c.filters?.product_refs ?? []), ...(c.filters?.item_refs ?? [])].join(','), (v) => set('filters', { ...c.filters, [c.tx_kind === 'financial' ? 'product_refs' : 'item_refs']: v.split(',').map((x) => x.trim()).filter(Boolean) }))}
          ${c.tx_kind === 'financial' && inp('Filtre: ödeme kanalı kodları', (c.filters?.channel_codes ?? []).join(','), (v) => set('filters', { ...c.filters, channel_codes: v.split(',').map((x) => x.trim()).filter(Boolean) }))}
          ${inp('Filtre: ajans id’leri', (c.filters?.agency_ids ?? []).join(','), (v) => set('filters', { ...c.filters, agency_ids: v.split(',').map((x) => Number(x.trim())).filter(Boolean) }))}
        `
        : html`
          ${sel('Taraf', c.party_type, (v) => set('party_type', v), [['agency', 'Ajans'], ['bd', 'BD'], ['publisher', 'Yayıncı']])}
          ${inp('Yalnız şu id’ler (boş = hepsi)', (c.party_ids ?? []).join(','), (v) => set('party_ids', v.split(',').map((x) => Number(x.trim())).filter(Boolean)))}
          ${inp('Ölçü (değişken veya formül)', c.measure, (v) => set('measure', v), `Değişkenler: ${vars.join(', ')}`, true)}
          ${sel('Satır türü', c.line_kind, (v) => set('line_kind', v), [['bonus', 'Bonus / prim (+)'], ['deduction', 'Kesinti (−)']])}
        `}
      ${sel('Hesaplama yöntemi', c.method.type, (v) => setM('type', v), [['percent', 'Yüzde'], ['fixed', 'Sabit tutar'], ['per_unit', 'Birim başına'], ['tiered', 'Kademeli'], ['formula', 'Formül']])}
      ${c.method.type === 'percent' && inp('Yüzde (%)', c.method.percent, (v) => setM('percent', v))}
      ${c.method.type === 'fixed' && inp(`Tutar (${c.currency})`, c.method.amount, (v) => setM('amount', v))}
      ${c.method.type === 'per_unit' && html`${sel('Birim', c.method.measure ?? 'quantity', (v) => setM('measure', v), [['quantity', 'Miktar (dakika vb.)'], ['units', 'Jeton adedi']])}${inp(`Birim fiyat (${c.currency})`, c.method.price, (v) => setM('price', v))}`}
      ${c.method.type === 'formula' && inp('Formül', c.method.expr, (v) => setM('expr', v), '"base" matrahı verir. Örn: if(base > 10000, base * pct(12), base * pct(10))', true)}
      ${c.method.type === 'tiered' && html`
        ${sel('Kademe türü', c.method.mode ?? 'whole', (v) => setM('mode', v), [['whole', 'Tüm tutara ulaşılan kademe oranı'], ['marginal', 'Dilimli (her dilim kendi oranıyla)']])}
        <div class="field wide"><span>Kademeler (eşik → %)</span>
          ${(c.method.tiers ?? []).map((t, i) => html`<div class="row gap"><input value=${t.from} aria-label="Eşik" onInput=${(e) => setM('tiers', c.method.tiers.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} /><input value=${t.percent} aria-label="Yüzde" onInput=${(e) => setM('tiers', c.method.tiers.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)))} /><${Button} kind="ghost" onClick=${() => setM('tiers', c.method.tiers.filter((_, j) => j !== i))}>✕</${Button}></div>`)}
          <${Button} onClick=${() => setM('tiers', [...(c.method.tiers ?? []), { from: '0', percent: '0' }])}>Kademe ekle</${Button}>
        </div>`}
      ${inp(`Minimum (${c.currency})`, c.min, (v) => set('min', v))}
      ${inp(`Maksimum (${c.currency})`, c.max, (v) => set('max', v))}
      ${sel('Para birimi (sabit tutar/sınırlar)', c.currency, (v) => set('currency', v), meta.currencies.filter((x) => x.kind === 'fiat').map((x) => [x.code, x.code]))}
      ${sel('Yuvarlama', c.rounding, (v) => set('rounding', v), meta.rounding_modes.map((m) => [m, { half_even: 'Yarımda çifte (banker)', half_up: 'Yarımda yukarı', half_down: 'Yarımda aşağı', down: 'Sıfıra doğru', up: 'Sıfırdan uzağa', floor: 'Aşağı', ceil: 'Yukarı' }[m]]))}
      ${inp('Koşul (isteğe bağlı formül)', c.condition, (v) => set('condition', v), 'Örn: coin_value >= 50 · doğru değilse kural atlanır', true)}
    </div></div>
    <div class="row gap wrap end">
      <${Button} onClick=${validate}>Doğrula</${Button}>
      ${c.scope === 'transaction' && html`<${Button} onClick=${runPreview}>Örnek işlemle dene</${Button}>`}
      <${Button} kind="primary" onClick=${save}>Taslak olarak kaydet</${Button}>
    </div>
    ${check && html`<div class=${`note ${check.ok ? '' : 'bad'}`} style="margin-top:10px">${check.ok ? 'Yapılandırma geçerli.' : check.errors.map((e) => html`<div>• ${e}</div>`)}${check.conflicts?.length ? html`<div class="note warn">${check.conflicts.map((x) => html`<div>Çakışma: ${x.rule} v${x.version} — ${x.reason}</div>`)}</div>` : ''}</div>`}
    ${c.scope === 'transaction' && html`<${Card} title="Örnek işlem">
      <div class="row gap wrap">
        ${(c.tx_kind === 'financial' ? ['gross_amount', 'tax_amount', 'channel_fee', 'coins'] : ['value', 'units', 'quantity']).map((k) => html`<label class="field"><span>${k}</span><input value=${sample[k]} onInput=${(e) => setSample({ ...sample, [k]: e.target.value })} /></label>`)}
        <label class="field"><span>agency_id</span><input value=${sample.agency_id} onInput=${(e) => setSample({ ...sample, agency_id: e.target.value })} /></label>
        <label class="field"><span>publisher_id</span><input value=${sample.publisher_id} onInput=${(e) => setSample({ ...sample, publisher_id: e.target.value })} /></label>
      </div>
      ${preview && html`
        ${preview.issues.map((i) => html`<div class="note bad">${i.message}</div>`)}
        <${Table} dense columns=${[{ key: 'beneficiary_type', label: 'Alıcı' }, { key: 'beneficiary_id', label: 'Id' }, { key: 'base_minor', label: 'Matrah', money: 'currency' }, { key: 'amount_minor', label: 'Sonuç', money: 'currency' }, { key: 'trace', label: 'İz', render: (r) => html`<code>${JSON.stringify(r.trace.capped ?? r.trace.tier ?? r.trace.raw)}</code>` }]} rows=${preview.allocations} empty="Kural bu örnekte uygulanmadı (filtre, koşul veya alıcı yok)" />
        <p class="muted">Dağıtılabilir: ${money(preview.distributable_minor, preview.currency)}</p>`}
    </${Card}>`}
  </${Modal}>`;
}

export function Approvals() {
  const [status, setStatus] = useState('pending');
  const s = useApi(`/api/approvals?status=${status}`);
  const [ask, prompt] = usePrompt();
  const decide = async (a, approve) => {
    const r = await ask(approve ? 'Onayla' : 'Reddet / geri çek', { label: 'Not', required: !approve, ok: approve ? 'Onayla' : 'Reddet' });
    if (r && (await act(() => post(`/api/approvals/${a.id}/decide`, { approve, note: r.reason }), approve ? 'Onaylandı ve uygulandı' : 'Reddedildi'))) s.reload();
  };
  return html`<${Page} title="Onay bekleyenler" subtitle="Kritik işlemler (kural yürürlüğü, dönem kapatma, Lucky olasılık tablosu) ikinci bir yetkilinin onayıyla uygulanır.">
    <${Tabs} tabs=${[['pending', 'Bekleyen'], ['all', 'Tümü']]} value=${status} onChange=${setStatus} />
    <${Loading} state=${s}>${(d) => html`<${Table}
      columns=${[
        { key: 'id', label: '#' },
        { key: 'summary', label: 'Talep' },
        { key: 'requested_by_name', label: 'Talep eden' },
        { key: 'requested_at', label: 'Zaman', render: (a) => dateTimeTr(a.requested_at) },
        { key: 'status', label: 'Durum', render: (a) => html`<${Badge} s=${a.status} />` },
        { key: 'conf', label: 'Uyarı', render: (a) => (a.payload.conflicts?.length ? html`<${Badge} s="warning" label=${`${a.payload.conflicts.length} çakışma`} />` : '') },
        { key: 'decided_by_name', label: 'Karar veren' },
        { key: 'act', label: '', render: (a) => a.status === 'pending' && html`<div class="row gap"><${Button} kind="primary" onClick=${() => decide(a, true)}>Onayla</${Button}><${Button} onClick=${() => decide(a, false)}>Reddet</${Button}></div>` },
      ]}
      rows=${d.rows}
      empty="Bekleyen onay yok"
    />`}</${Loading}>
    ${prompt}
  </${Page}>`;
}
