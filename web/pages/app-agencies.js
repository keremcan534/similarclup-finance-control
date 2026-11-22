// Uygulama › Ajans merkezi: the Similar Club app's agency network from the centre's side, through its admin API
// (server/app-admin.ts passes each call on as the signed-in panel user; the app checks and records every step as the
// Finance Control account). Özet, Ajanslar (the tree with rates, tiers and 30-day figures; status, rate, tier,
// parent, a streamer's agency, transition commission, a new agency), Başvurular, Transferler, Performans, Rapor,
// Simülasyon, Denetim and, with its own permission, the commission ledger and the network's rules. Staff roles and
// permissions, BD assignment, operations score, violations, appeals and the background jobs stay in the app.
import { Badge, Button, Card, DateRange, Form, ID_HINT, Kpi, Loading, Modal, Page, Table, Tabs, accountOf, act, dateTimeTr, dateTr, html, monthStart, num, post, showError, toast, today, useApi, useApp, useEffect, usePrompt, useState } from '../lib.js';
import { Chips } from './app-finance.js';

// The app's words (app/src/lib/agency-net.ts).
const STATUS = { draft: ['draft', 'Taslak'], pending: ['pending', 'Onay bekliyor'], approved: ['active', 'Aktif'], rejected: ['rejected', 'Reddedildi'], suspended: ['warning', 'Askıda'], closed: ['closed', 'Kapatıldı'] };
const AStatus = ({ s }) => html`<${Badge} s=${STATUS[s]?.[0] ?? 'passive'} label=${STATUS[s]?.[1] ?? s} />`;
const TRANSFER_TEXT = { streamer_move: 'Yayıncı transferi', streamer_leave: 'Ajanstan ayrılma', independence: 'Bağımsızlık', change_parent: 'Üst ajans değişikliği', sub_close: 'Alt ajans kapatma' };
const TRANSFER_STATUS = { pending: ['pending', 'Onay bekliyor'], completed: ['resolved', 'Tamamlandı'], rejected: ['rejected', 'Reddedildi'], cancelled: ['cancelled', 'İptal edildi'] };
const PARTY_TEXT = { from: 'Mevcut ajans', to: 'Yeni ajans', parent: 'Üst ajans', streamer: 'Yayıncı', center: 'Merkez' };
const CHANGE_TEXT = { up: 'Seviye yükseldi', down: 'Seviye düştü', same: 'Seviye korundu', held: 'Merkez sabitledi', waiting: 'Kesinleşmesi bekleniyor' };
const FLAG_TEXT = { decline: 'Puanı hızlı düştü', low_active: 'Aktif yayıncı az', review: 'İnceleme önerilir', spike: 'Ani hacim artışı', overtaken: 'Alt ajansı geçti' };
const INCOME_TEXT = { gift: 'Hediye', lucky_gift: 'Şans hediyesi', campaign: 'Kampanya', bonus: 'Bonus', task_reward: 'Görev ödülü', refund: 'İade', other: 'Diğer', message: 'Mesaj', call: 'Arama' };

const pct = (r) => (r === null || r === undefined ? '—' : `%${(Number(r) * 100).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`);
const dia = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('tr-TR', { maximumFractionDigits: 2 }));
const usd = (n) => `$${num(n, 2)}`;
/** A percent as people type it (25 or 25,5) as the rate the app keeps (0.255); NaN when it isn't a number. */
const rateOf = (s) => {
  const v = Number(String(s ?? '').trim().replace(',', '.'));
  return String(s ?? '').trim() && Number.isFinite(v) ? Math.round(v * 100) / 10000 : NaN;
};
/** A day picked in a date field as the start of that day in Türkiye (the app's time), or undefined: now. */
const dayStart = (d) => (d ? `${d}T00:00:00+03:00` : undefined);
const nextDay = (d) => new Date(Date.parse(`${d}T00:00:00+03:00`) + 864e5).toISOString();
/** A request id for a write the app makes once (a manual income, an adjustment): a retry is a replay, not a second row. */
const refOf = () => `fc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const short = (id) => (id ? `${String(id).slice(0, 8)}…` : '—');
const json = (v) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export function AppAgencies() {
  const { can } = useApp();
  const [tab, setTab] = useState('overview');
  const settings = useApi('/api/app/agency/settings');
  const tabs = [
    ['overview', 'Özet'],
    ['agencies', 'Ajanslar'],
    ['applications', 'Başvurular'],
    ['transfers', 'Transferler'],
    ['performance', 'Performans'],
    ['report', 'Rapor'],
    ['simulate', 'Simülasyon'],
    ['audit', 'Denetim'],
    ...(can('app.agency_ledger') ? [['ledger', 'Defter ve kurallar']] : []),
  ];
  const s = settings.data?.values ?? null;
  return html`<${Page}
    title="Ajans merkezi"
    subtitle=${`Uygulamanın ajans ağı, merkezin gözünden: ağaç, başvurular, durum, oran ve kademe, transferler, performans, rapor ve simülasyon${can('app.agency_ledger') ? ', komisyon defteri ve ağ kuralları' : ''}. Her adımı uygulama denetler ve ajansa bildirir; geçmiş kazançlar hiçbir değişiklikle değişmez. Personel rolleri, BD atama, ihlal ve itirazlar uygulamada.`}
  >
    <${Tabs} tabs=${tabs} value=${tab} onChange=${setTab} />
    ${tab === 'overview' && html`<${Overview} onTab=${setTab} />`}
    ${tab === 'agencies' && html`<${Agencies} s=${s} />`}
    ${tab === 'applications' && html`<${Applications} />`}
    ${tab === 'transfers' && html`<${Transfers} s=${s} />`}
    ${tab === 'performance' && html`<${Performance} />`}
    ${tab === 'report' && html`<${Report} />`}
    ${tab === 'simulate' && html`<${Simulate} s=${s} />`}
    ${tab === 'audit' && html`<${Audit} />`}
    ${tab === 'ledger' && can('app.agency_ledger') && html`<${Ledger} settings=${settings} />`}
  </${Page}>`;
}

// ---- Özet -----------------------------------------------------------------------------------------------
function Overview({ onTab }) {
  const o = useApi('/api/app/agency/overview');
  return html`<${Loading} state=${o}>${(d) => html`<div class="kpis" style="margin-top:12px">
    <${Kpi} label="Üst ajans" value=${num(d.tops)} sub=${`alt ajans ${num(d.subs)}`} onClick=${() => onTab('agencies')} />
    <${Kpi} label="Bağlı yayıncı" value=${num(d.streamers)} />
    <${Kpi} label="Onay bekleyen başvuru" value=${num(d.pending)} tone=${d.pending ? 'warn' : ''} note=${d.pending ? 'Başvurular sekmesinde' : ''} onClick=${() => onTab('applications')} />
    <${Kpi} label="Askıdaki ajans" value=${num(d.suspended)} />
    <${Kpi} label="Son 30 gün matrah" value=${`${dia(d.base30)} elmas`} sub=${usd(d.usd.base30)} onClick=${() => onTab('report')} />
    <${Kpi} label="Son 30 gün ajans komisyonu" value=${`${dia(d.commission30)} elmas`} sub=${`${usd(d.usd.commission30)} · havuz sınırı ${pct(d.poolCap)}`} />
    <${Kpi} label="Son 30 gün BD payı" value=${`${dia(d.bd30)} elmas`} />
    <${Kpi} label="Açık ödeme talebi" value=${num(d.payouts_open_count)} sub=${`${dia(d.payouts_open)} elmas · Ajans ödemeleri sayfasında`} />
    <${Kpi} label="Merkez onayı bekleyen transfer" value=${num(d.transfers_waiting)} tone=${d.transfers_waiting ? 'warn' : ''} note=${d.transfers_waiting ? 'Transferler sekmesinde' : ''} onClick=${() => onTab('transfers')} />
    <${Kpi} label="Açık ajans itirazı" value=${num(d.appeals_open)} sub="uygulamada karara bağlanır" />
    <${Kpi} label="Komisyonu hesaplanmamış gelir" value=${num(d.calc_pending)} />
  </div>`}</${Loading}>
  <${Assistants} />`;
}

/**
 * Ajans asistanları (owners, 22 Nov 2026: "1 ile 10 arasında rakamı seçip tüm ajanslar için aktif yapabilmeliyiz"):
 * how many assistants every agency may add, in sight on the first tab (it was one row of the network rules' JSON).
 * The same rule as there (assistant_policy, the app's agency-lib.mjs), so it needs the ledger's permission.
 */
function Assistants() {
  const { can } = useApp();
  const settings = useApi(can('app.agency_ledger') ? '/api/app/agency/settings' : null);
  const [edit, setEdit] = useState(false);
  if (!can('app.agency_ledger')) return null;
  return html`<${Card} title="Ajans asistanları">
    <${Loading} state=${settings}>${(d) => {
      const max = d.values.assistant_policy?.max ?? 1;
      return html`<div class="row gap wrap" style="align-items:center">
        <span>Her ajans en fazla <strong>${max === 0 ? 'hiç' : `${max} kişi`}</strong> asistan ekleyebilir. Bu sayı bütün ajanslar için geçerlidir.</span>
        <span style="flex:1"></span>
        <${Button} kind="primary" onClick=${() => setEdit(true)}>Değiştir</${Button}>
      </div>
      ${edit && html`<${SettingEditor} k="assistant_policy" value=${d.values.assistant_policy} onClose=${() => setEdit(false)} onSaved=${() => (setEdit(false), toast('Asistan sınırı kaydedildi'), settings.reload())} />`}`;
    }}</${Loading}>
  </${Card}>`;
}

// ---- Ajanslar -------------------------------------------------------------------------------------------
const A_STATUS = [
  ['approved', 'Aktif'],
  ['suspended', 'Askıda'],
  ['pending', 'Onay bekliyor'],
  ['all', 'Tümü'],
];

function Agencies({ s }) {
  const { can } = useApp();
  const tree = useApi('/api/app/agency/tree');
  const [status, setStatus] = useState('approved');
  const [text, setText] = useState('');
  const [open, setOpen] = useState(null);
  const [create, setCreate] = useState(false);
  const nodes = tree.data?.nodes ?? [];
  const byId = Object.fromEntries(nodes.map((a) => [a.id, a]));
  const q = text.trim().toLocaleLowerCase('tr-TR');
  const topName = (a) => (a.parentId ? byId[a.parentId]?.name ?? '' : a.name);
  const shown = nodes
    .filter((a) => (status === 'all' || a.status === status) && (!q || a.name.toLocaleLowerCase('tr-TR').includes(q) || String(a.code ?? '').toLocaleLowerCase('tr-TR') === q))
    .sort((x, y) => topName(x).localeCompare(topName(y), 'tr') || x.level - y.level || x.name.localeCompare(y.name, 'tr'));
  return html`
    <div class="row gap wrap" style="margin:12px 0">
      <${Chips} value=${status} options=${A_STATUS.map(([k, l]) => [k, `${l} (${num(k === 'all' ? nodes.length : nodes.filter((a) => a.status === k).length)})`])} onChange=${setStatus} />
      <input value=${text} onInput=${(e) => setText(e.target.value)} placeholder="Ajans adı ya da kodu" />
      ${can('app.agencies') && html`<${Button} kind="primary" onClick=${() => setCreate(true)}>Yeni ajans</${Button}>`}
    </div>
    <${Loading} state=${tree}>${(d) => html`
      <p class="muted">Havuz sınırı ${pct(d.poolCap)} · üst ajans oranı ${pct(d.topRate)}. Bir satıra tıklayınca ayrıntı ve işlemler açılır.</p>
      <${Table}
        empty="Bu listede ajans yok"
        onRow=${(a) => setOpen(a.id)}
        columns=${[
          { key: 'name', label: 'Ajans', render: (a) => html`${a.parentId ? html`<span class="muted">↳ </span>` : ''}<strong>${a.name}</strong> <small class="muted num">${a.code ?? ''}</small><br /><small class="muted">${a.parentId ? `alt ajans · ${byId[a.parentId]?.name ?? ''}` : 'üst ajans'}${a.owner ? ` · ${a.owner}` : ''}</small>` },
          { key: 'status', label: 'Durum', render: (a) => html`<${AStatus} s=${a.status} />` },
          { key: 'tier', label: 'Kademe', render: (a) => (a.parentId ? a.tierName ?? '—' : '—') },
          { key: 'rate', label: 'Oran', align: 'right', render: (a) => html`${pct(a.rate)}${a.parentId && a.parentShare ? html`<br /><small class="muted">üste ${pct(a.parentShare)}</small>` : ''}${a.upcoming ? html`<br /><small class="muted">${dateTr(a.upcoming.effectiveFrom)}: ${pct(a.upcoming.rate)}</small>` : ''}` },
          { key: 'streamers', label: 'Yayıncı', align: 'right', render: (a) => num(a.streamers) },
          { key: 'volume30', label: '30 gün hacim', align: 'right', render: (a) => html`${dia(a.volume30)}${!a.parentId && a.orgVolume30 !== a.volume30 ? html`<br /><small class="muted">ağ ${dia(a.orgVolume30)}</small>` : ''}` },
          { key: 'earned30', label: '30 gün kazanç', align: 'right', render: (a) => dia(a.earned30) },
          { key: 'score', label: 'Puan', render: (a) => (a.score === null ? '—' : html`${num(a.score, 1)}${a.rank ? html` <small class="muted">#${a.rank}</small>` : ''}${a.flags?.length ? html`<br /><small class="muted">${a.flags.map((f) => FLAG_TEXT[f] ?? f).join(', ')}</small>` : ''}`) },
        ]}
        rows=${shown}
      />`}</${Loading}>
    ${open && byId[open] && html`<${AgencyDetail} a=${byId[open]} nodes=${nodes} s=${s} onClose=${() => setOpen(null)} onChanged=${() => tree.reload()} />`}
    ${create && html`<${CreateAgency} nodes=${nodes} onClose=${() => setCreate(false)} onSaved=${() => (setCreate(false), toast('Ajans kuruldu ve onaylandı'), tree.reload())} />`}`;
}

function AgencyDetail({ a, nodes, s, onClose, onChanged }) {
  const { can } = useApp();
  const [ask, prompt] = usePrompt();
  const [split, setSplit] = useState(null);
  const [bd, setBd] = useState(null);
  const live = a.status === 'approved' || a.status === 'suspended';
  useEffect(() => {
    if (!live) return;
    let on = true;
    post('/api/app/agency/simulate', { base: 100000, agencyId: a.id }).then((r) => on && setSplit(r), () => {});
    return () => (on = false);
  }, [a.id]);
  const tops = nodes.filter((x) => !x.parentId && x.id !== a.id && x.status === 'approved');
  const done = (text) => (r) => r && (toast(text), onChanged());
  const reason = { name: 'reason', label: 'Gerekçe (ajansa bildirilir, 3–300)', type: 'textarea', required: true, wide: true };
  const from = { name: 'from', label: 'Başlangıç günü (boş: hemen)', type: 'date', hint: 'İleri bir gün seçilebilir; geçmiş tarih kabul edilmez' };
  const hold = { name: 'hold', label: 'Performans motoru bu güne kadar değiştirmesin', type: 'date' };
  const status = async (to) => {
    const title = { suspended: 'Ajansı askıya al', approved: 'Ajansı yeniden aç', closed: 'Ajansı kapat' }[to];
    const text = to === 'closed' ? 'Ajans kapanır, yayıncıları ajanstan ayrılır, bekleyen talepleri iptal olur. Alt ajansı varsa önce onlar kapatılmalı ya da taşınmalı. Para kayıtları olduğu gibi kalır.' : to === 'suspended' ? 'Askıdaki ajans yeni komisyon kazanmaz; kayıtları ve bakiyesi olduğu gibi kalır.' : 'Ajans yeniden aktif olur.';
    const v = await ask(title, { text, fields: [reason], ok: title });
    if (v) done('Ajansın durumu değişti')(await act(() => post('/api/app/agency/status', { id: a.id, status: to, reason: v.reason })));
  };
  const rate = async () => {
    const v = await ask('Komisyon oranını düzelt', {
      text: `Şu an ${pct(a.rate)}; havuz sınırı ${pct(s?.pool_cap)}.${a.parentId ? ' Alt ajansın oranı üst ajansın oranından asgari payı düşünce kalanı aşamaz.' : ''}`,
      fields: [{ name: 'rate', label: 'Yeni oran (%)', type: 'decimal', required: true, def: String(Math.round((a.rate ?? 0) * 10000) / 100) }, from, hold, reason],
      ok: 'Kaydet',
    });
    if (!v) return;
    const r = rateOf(v.rate);
    if (!Number.isFinite(r)) return showError(new Error('Oranı yüzde olarak yazın (ör. 25 ya da 25,5)'));
    done('Oran kaydedildi')(await act(() => post('/api/app/agency/rate', { id: a.id, rate: r, reason: v.reason, ...(v.from ? { effectiveFrom: dayStart(v.from) } : {}), ...(v.hold ? { holdUntil: dayStart(v.hold) } : {}) })));
  };
  const tier = async () => {
    const v = await ask('Kademeyi değiştir', {
      text: `Şu an ${a.tierName ?? '—'}. Kademenin oranı uygulanır (üst ajansın oranı ve asgari pay sınırında).`,
      fields: [{ name: 'tier', label: 'Kademe', type: 'select', required: true, def: a.tier ?? s?.tiers?.[0]?.key, options: (s?.tiers ?? []).map((t) => [t.key, `${t.name} · ${pct(t.sub_rate)}`]) }, from, hold, reason],
      ok: 'Kaydet',
    });
    if (v) done('Kademe kaydedildi')(await act(() => post('/api/app/agency/tier', { id: a.id, tier: v.tier, reason: v.reason, ...(v.from ? { effectiveFrom: dayStart(v.from) } : {}), ...(v.hold ? { holdUntil: dayStart(v.hold) } : {}) })));
  };
  const parent = async () => {
    const v = await ask('Üst ajansı değiştir', {
      text: 'Ajans seçilen üst ajansın altına taşınır ya da bağımsız (üst ajans) olur. Geçmiş komisyonlar değişmez.',
      fields: [{ name: 'parent', label: 'Yeni üst ajans', type: 'select', options: [['', 'Bağımsız (üst ajans yok)'], ...tops.map((t) => [t.id, `${t.name} (${t.code})`])], required: true, def: a.parentId ?? '' }, reason],
      ok: 'Taşı',
    });
    if (v) done('Ajans taşındı')(await act(() => post('/api/app/agency/parent', { id: a.id, parentId: v.parent || null, reason: v.reason })));
  };
  const assign = async (link) => {
    const v = await ask(link ? 'Yayıncıyı bu ajansa bağla' : 'Yayıncıyı ajansından çıkar', {
      text: link ? 'Yayıncı bulunduğu ajanstan çıkıp bu ajansa bağlanır (merkez kararı; transfer ücreti yok).' : 'Yayıncı bağlı olduğu ajanstan çıkar ve ajanssız kalır.',
      fields: [{ name: 'streamer', label: 'Yayıncının ID’si', type: 'text', required: true, wide: true, hint: ID_HINT }, reason],
      ok: link ? 'Bağla' : 'Çıkar',
    });
    if (v) done(link ? 'Yayıncı bu ajansa bağlandı' : 'Yayıncı ajansından çıktı')(await act(async () => post('/api/app/agency/assign', { streamer: await accountOf(v.streamer), ...(link ? { agencyId: a.id } : {}), reason: v.reason })));
  };
  const transition = async () => {
    const v = await ask('Geçiş komisyonu', {
      text: 'Bağımsızlaşan bu ajansın eski üst ajansı, belirlenen süre boyunca matrahtan bu oranda pay almaya devam eder.',
      fields: [
        { name: 'old', label: 'Eski üst ajans', type: 'select', required: true, def: tops[0]?.id ?? '', options: tops.map((t) => [t.id, `${t.name} (${t.code})`]) },
        { name: 'rate', label: 'Oran (%)', type: 'decimal', required: true },
        { name: 'start', label: 'Başlangıç günü (boş: hemen)', type: 'date' },
        { name: 'end', label: 'Bitiş günü', type: 'date', required: true },
        { name: 'scope', label: 'Kapsam', type: 'select', required: true, def: 'existing', options: [['existing', 'Yalnız mevcut yayıncılar'], ['all', 'Bütün yayıncılar']] },
        reason,
      ],
      ok: 'Kaydet',
    });
    if (!v) return;
    const r = rateOf(v.rate);
    if (!Number.isFinite(r)) return showError(new Error('Oranı yüzde olarak yazın'));
    done('Geçiş komisyonu kaydedildi')(await act(() => post('/api/app/agency/transition', { agencyId: a.id, oldParentId: v.old, rate: r, ...(v.start ? { startsAt: dayStart(v.start) } : {}), endsAt: dayStart(v.end), scope: v.scope, reason: v.reason })));
  };
  const bdReport = useApi(bd === 'open' && a.bd ? `/api/app/agency/bd-report?bd=${encodeURIComponent(a.bd)}` : null);
  return html`<${Modal} title=${a.name} wide onClose=${onClose}>
    ${prompt}
    <div class="kpis">
      <${Kpi} label="Durum" value=${STATUS[a.status]?.[1] ?? a.status} sub=${`${a.parentId ? 'alt ajans' : 'üst ajans'} · kod ${a.code ?? '—'}`} />
      <${Kpi} label="Oran" value=${pct(a.rate)} sub=${a.parentId ? `üst ajansa ${pct(a.parentShare)} · ${a.tierName ?? ''}` : `havuz sınırı ${pct(s?.pool_cap)}`} note=${a.upcoming ? `${dateTr(a.upcoming.effectiveFrom)} itibarıyla ${pct(a.upcoming.rate)}` : ''} />
      <${Kpi} label="Yayıncı" value=${num(a.streamers)} sub=${a.owner ? `yönetici ${a.owner}` : ''} />
      <${Kpi} label="30 gün hacim" value=${`${dia(a.volume30)} elmas`} sub=${a.parentId ? '' : `ağın tamamı ${dia(a.orgVolume30)}`} />
      <${Kpi} label="30 gün kazanç" value=${`${dia(a.earned30)} elmas`} />
      <${Kpi} label="Performans" value=${a.score === null ? '—' : num(a.score, 1)} sub=${a.rank ? `sıra #${a.rank}${a.overtakes ? ' · üst ajansı geçti' : ''}` : ''} note=${(a.flags ?? []).map((f) => FLAG_TEXT[f] ?? f).join(', ')} />
    </div>
    ${split && html`<${Card} title="100.000 elmasın bugünkü bölüşümü">
      <${Table} dense columns=${[
        { key: 'agency', label: 'Ajans' },
        { key: 'kind', label: 'Pay', render: (x) => (x.kind === 'direct' ? 'Doğrudan' : 'Fark (üst ajans)') },
        { key: 'rate', label: 'Oran', align: 'right', render: (x) => pct(x.rate) },
        { key: 'amount', label: 'Elmas', align: 'right', render: (x) => dia(x.amount) },
      ]} rows=${split.shares} />
      <p class="muted">Toplam ${pct(split.totalRate)} · havuz ${dia(split.pool)} elmas · platforma kalan ${dia(split.platformKeeps)} elmas</p>
    </${Card}>`}
    ${a.bd && html`<${Card} title="BD" actions=${bd !== 'open' && html`<${Button} onClick=${() => setBd('open')}>BD raporunu göster</${Button}>`}>
      <p class="muted num">${a.bd}</p>
      ${bd === 'open' && html`<${Loading} state=${bdReport}>${(r) => html`
        <p class="muted">BD payı ${pct(r.policy?.rate)} · ${num(r.agencies.length)} ajans</p>
        <${Table} dense empty="Dönem kaydı yok" columns=${[
          { key: 'period', label: 'Dönem' },
          { key: 'amount', label: 'Elmas', align: 'right', render: (x) => dia(x.amount) },
          { key: 'usd', label: 'USD', align: 'right', render: (x) => usd(x.usd) },
        ]} rows=${r.ledger} />`}</${Loading}>`}
    </${Card}>`}
    ${can('app.agencies') &&
    html`<div class="row gap wrap" style="margin-top:12px">
      ${a.status === 'approved' && html`<${Button} kind="danger" onClick=${() => status('suspended')}>Askıya al</${Button}>`}
      ${a.status === 'suspended' && html`<${Button} kind="primary" onClick=${() => status('approved')}>Yeniden aç</${Button}>`}
      ${live && html`<${Button} kind="danger" onClick=${() => status('closed')}>Kapat</${Button}>`}
      ${live && html`<${Button} onClick=${rate}>Oranı düzelt</${Button}>`}
      ${live && a.parentId && html`<${Button} onClick=${tier}>Kademe</${Button}>`}
      ${a.status === 'approved' && html`<${Button} onClick=${parent}>Üst ajansı değiştir</${Button}>`}
      ${live && html`<${Button} onClick=${() => assign(true)}>Yayıncı bağla</${Button}>`}
      <${Button} kind="ghost" onClick=${() => assign(false)}>Yayıncıyı ajanstan çıkar</${Button}>
      ${!a.parentId && live && html`<${Button} kind="ghost" onClick=${transition}>Geçiş komisyonu</${Button}>`}
    </div>`}
  </${Modal}>`;
}

function CreateAgency({ nodes, onClose, onSaved }) {
  const tops = nodes.filter((x) => !x.parentId && x.status === 'approved');
  return html`<${Modal} title="Yeni ajans" onClose=${onClose}>
    <p class="muted">Merkezin kurduğu ajans hemen onaylanır. Yönetici hesabı verilirse ajansın sahibi o olur.</p>
    <${Form}
      submitLabel="Kur ve onayla"
      onCancel=${onClose}
      fields=${[
        { name: 'name', label: 'Ajans adı (2–60)', required: true },
        { name: 'parentId', label: 'Üst ajans (boş: üst ajans olarak)', type: 'select', options: tops.map((t) => [t.id, `${t.name} (${t.code})`]) },
        { name: 'owner', label: 'Yöneticinin ID’si (isteğe bağlı)', hint: ID_HINT },
        { name: 'country', label: 'Ülke' },
        { name: 'region', label: 'Bölge' },
        { name: 'contactName', label: 'Yetkili adı' },
        { name: 'contactPhone', label: 'Yetkili telefonu' },
        { name: 'contactEmail', label: 'Yetkili e-postası' },
        { name: 'expectedStreamers', label: 'Beklenen yayıncı sayısı', type: 'number' },
        { name: 'description', label: 'Açıklama', type: 'textarea', wide: true },
      ]}
      onSubmit=${async (v) => {
        const body = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== ''));
        if (body.expectedStreamers !== undefined) body.expectedStreamers = Number(body.expectedStreamers);
        if (await act(async () => post('/api/app/agency/create', { ...body, ...(body.owner ? { owner: await accountOf(body.owner) } : {}) }))) onSaved();
      }}
    />
  </${Modal}>`;
}

// ---- Başvurular -----------------------------------------------------------------------------------------
function Applications() {
  const { can } = useApp();
  const list = useApi('/api/app/agency/list?status=pending');
  const [ask, prompt] = usePrompt();
  const approve = async (a) => confirm(`${a.name} onaylanır ve ajans olarak açılır${a.parent ? ` (${a.parent.name} altında)` : ''}.`) && (await act(() => post('/api/app/agency/decide', { id: a.id, approve: true, note: '' }))) && (toast('Başvuru onaylandı'), list.reload());
  const reject = async (a) => {
    const v = await ask('Başvuruyu reddet', { text: 'Gerekçe başvurana bildirilir.', label: 'Gerekçe (3–300)', ok: 'Reddet' });
    if (v && (await act(() => post('/api/app/agency/decide', { id: a.id, approve: false, note: v.reason })))) (toast('Başvuru reddedildi'), list.reload());
  };
  return html`${prompt}<${Loading} state=${list}>${(d) => html`<div style="margin-top:12px"><${Table}
    empty="Onay bekleyen ajans başvurusu yok"
    columns=${[
      { key: 'createdAt', label: 'Başvuru', render: (a) => dateTimeTr(a.createdAt) },
      { key: 'name', label: 'Ajans', render: (a) => html`<strong>${a.name}</strong> <small class="muted num">${a.code ?? ''}</small><br /><small class="muted">${a.parent ? `${a.parent.name} altında alt ajans` : 'üst ajans'}</small>` },
      { key: 'owner', label: 'Başvuran', render: (a) => html`${a.owner?.name ?? '—'}${a.contact?.name ? html`<br /><small class="muted">${a.contact.name}${a.contact.phone ? ` · ${a.contact.phone}` : ''}${a.contact.email ? ` · ${a.contact.email}` : ''}</small>` : ''}` },
      { key: 'country', label: 'Yer', render: (a) => [a.country, a.region].filter(Boolean).join(' / ') || '—' },
      { key: 'expectedStreamers', label: 'Beklenen yayıncı', align: 'right', render: (a) => num(a.expectedStreamers) },
      { key: 'description', label: 'Açıklama', render: (a) => a.description || '—' },
      { key: 'pendingWith', label: 'Kimde', render: (a) => (a.pendingWith === 'parent' ? 'Üst ajans' : 'Merkez') },
      { key: 'x', label: '', render: (a) => can('app.agencies') && html`<span class="row gap"><${Button} kind="primary" onClick=${() => approve(a)}>Onayla</${Button}><${Button} kind="danger" onClick=${() => reject(a)}>Reddet</${Button}></span>` },
    ]}
    rows=${d.agencies}
  /></div>`}</${Loading}>`;
}

// ---- Transferler ----------------------------------------------------------------------------------------
function Transfers({ s }) {
  const { can } = useApp();
  const [status, setStatus] = useState('pending');
  const list = useApi(`/api/app/agency/transfers?status=${status}`);
  const [ask, prompt] = usePrompt();
  const waiting = (t) => t.status === 'pending' && (t.needs ?? []).includes('center') && !t.approvals?.center;
  const approve = async (t) => {
    const fields = [{ name: 'mode', label: 'Ücret', type: 'select', required: true, def: '', options: [['', `Kurala göre (${t.mode === 'free' ? 'ücretsiz' : `${dia(t.fee)} elmas`})`], ['free', 'Ücretsiz'], ['paid', 'Ücretli (kurala göre ücret)']] }];
    if (t.kind === 'independence')
      fields.push(
        { name: 'rate', label: 'Geçiş komisyonu oranı (%; boş: yok)', type: 'decimal' },
        { name: 'days', label: 'Geçiş süresi (gün, 1–730)', type: 'number', def: '90' },
        { name: 'scope', label: 'Kapsam', type: 'select', required: true, def: 'existing', options: [['existing', 'Yalnız mevcut yayıncılar'], ['all', 'Bütün yayıncılar']] },
      );
    fields.push({ name: 'note', label: 'Not (isteğe bağlı)', type: 'textarea', wide: true });
    const v = await ask(`${TRANSFER_TEXT[t.kind] ?? t.kind}: merkez onayı`, { text: 'Diğer tarafların onayı da tamamsa transfer hemen gerçekleşir.', fields, ok: 'Onayla' });
    if (!v) return;
    const body = { transferId: t.id, approve: true, note: v.note ?? '', ...(v.mode ? { mode: v.mode } : {}) };
    if (t.kind === 'independence' && String(v.rate ?? '').trim()) {
      const r = rateOf(v.rate);
      if (!Number.isFinite(r)) return showError(new Error('Geçiş oranını yüzde olarak yazın'));
      body.transition = { rate: r, days: Number(v.days), scope: v.scope, incomeTypes: [] };
    }
    if (await act(() => post('/api/app/agency/transfers/decide', body))) (toast('Merkez onayı verildi'), list.reload());
  };
  const reject = async (t) => {
    const v = await ask('Transferi reddet', { text: 'Gerekçe taraflara bildirilir.', label: 'Gerekçe (3–300)', ok: 'Reddet' });
    if (v && (await act(() => post('/api/app/agency/transfers/decide', { transferId: t.id, approve: false, note: v.reason })))) (toast('Transfer reddedildi'), list.reload());
  };
  const who = (x) => (x ? x.name ?? short(x.id) : '—');
  return html`${prompt}
    <div style="margin:12px 0"><${Chips} value=${status} options=${Object.entries(TRANSFER_STATUS).map(([k, [, l]]) => [k, l])} onChange=${setStatus} /></div>
    ${s?.transfer_policy && html`<p class="muted">Kural: ${num(s.transfer_policy.decision_days)} gün içinde karar; ${dia(s.transfer_policy.free_below_diamonds)} elmasın altı ücretsiz, üstü %${num(s.transfer_policy.fee_rate * 100)} ücret.${s.transfer_policy.require_center ? ' Her transfer merkez onayı ister.' : ''}</p>`}
    <${Loading} state=${list}>${(d) => html`<${Table}
      empty="Bu listede transfer yok"
      columns=${[
        { key: 'createdAt', label: 'Tarih', render: (t) => html`${dateTimeTr(t.createdAt)}${t.decidedAt ? html`<br /><small class="muted">karar ${dateTimeTr(t.decidedAt)}</small>` : ''}` },
        { key: 'kind', label: 'Tür', render: (t) => TRANSFER_TEXT[t.kind] ?? t.kind },
        { key: 'subject', label: 'Kim', render: (t) => (t.streamer ? html`${who(t.streamer)}<br /><small class="muted">yayıncı</small>` : html`${who(t.agency)}<br /><small class="muted">ajans</small>`) },
        { key: 'route', label: 'Nereden → nereye', render: (t) => `${who(t.from)} → ${t.to ? who(t.to) : t.kind === 'independence' ? 'bağımsız' : '—'}` },
        { key: 'needs', label: 'Onaylar', render: (t) => (t.needs ?? []).map((p) => html`<div>${t.approvals?.[p] ? '✓' : '…'} ${PARTY_TEXT[p] ?? p}</div>`) },
        { key: 'fee', label: 'Ücret', align: 'right', render: (t) => (t.mode === 'free' || !t.fee ? 'Ücretsiz' : `${dia(t.fee)} elmas`) },
        { key: 'reason', label: 'Gerekçe / karar', render: (t) => html`${t.reason || '—'}${t.decisionNote ? html`<br /><small class="muted">${t.decisionNote}</small>` : ''}` },
        { key: 'status', label: 'Durum', render: (t) => html`<${Badge} s=${TRANSFER_STATUS[t.status]?.[0] ?? 'pending'} label=${TRANSFER_STATUS[t.status]?.[1] ?? t.status} />` },
        { key: 'x', label: '', render: (t) => can('app.agencies') && t.status === 'pending' && html`<span class="row gap">${waiting(t) && html`<${Button} kind="primary" onClick=${() => approve(t)}>Onayla</${Button}>`}<${Button} kind="danger" onClick=${() => reject(t)}>Reddet</${Button}></span>` },
      ]}
      rows=${d.transfers}
    />`}</${Loading}>`;
}

// ---- Performans -----------------------------------------------------------------------------------------
function Performance() {
  const { can } = useApp();
  const [runId, setRunId] = useState('');
  const p = useApi(`/api/app/agency/performance${runId ? `?runId=${runId}` : ''}`);
  const [ask, prompt] = usePrompt();
  const run = async () => {
    const v = await ask('Performans değerlendirmesi', {
      text: 'Bütün ajansların puanı ve kademesi hesaplanır. Deneme işaretliyse hiçbir kademe ve oran değişmez; yalnız sonuç görülür.',
      fields: [
        { name: 'dryRun', label: 'Deneme (kademe değiştirme)', type: 'checkbox', def: true },
        { name: 'from', label: 'Kademe değişikliklerinin başlangıç günü (boş: kurala göre)', type: 'date' },
        { name: 'note', label: 'Not', type: 'text', wide: true },
      ],
      ok: 'Değerlendir',
    });
    if (!v) return;
    const r = await act(() => post('/api/app/agency/performance/run', { dryRun: !!v.dryRun, ...(v.note ? { note: v.note } : {}), ...(v.from ? { effectiveFrom: dayStart(v.from) } : {}) }));
    if (r) (toast(`${num(r.rows?.length ?? 0)} ajans değerlendirildi${v.dryRun ? ' (deneme)' : ''}`), setRunId(String(r.runId)), p.reload());
  };
  return html`${prompt}<${Loading} state=${p}>${(d) => html`
    <div class="row gap wrap" style="margin:12px 0">
      <select value=${String(d.runId ?? '')} onChange=${(e) => setRunId(e.target.value)}>
        ${d.runs.map((r) => html`<option value=${String(r.id)}>#${r.id} · ${dateTimeTr(r.asOf)}${r.dryRun ? ' · deneme' : ''}${r.runBy ? ` · ${r.runBy}` : ''}${r.note ? ` · ${r.note}` : ''}</option>`)}
      </select>
      ${can('app.agencies') && html`<${Button} kind="primary" onClick=${run}>Değerlendir</${Button}>`}
    </div>
    <${Table}
      empty=${d.runs.length ? 'Bu değerlendirmede ajans yok' : 'Henüz değerlendirme yapılmadı'}
      columns=${[
        { key: 'rank', label: 'Sıra', align: 'right', render: (x) => num(x.rank) },
        { key: 'name', label: 'Ajans', render: (x) => html`<strong>${x.name}</strong>${x.parent ? html`<br /><small class="muted">↳ ${x.parent.name}</small>` : ''}` },
        { key: 'score', label: 'Puan', align: 'right', render: (x) => html`${num(x.score, 1)}${x.parentScore !== null ? html`<br /><small class="muted">üst ${num(x.parentScore, 1)}</small>` : ''}` },
        { key: 'tier', label: 'Kademe', render: (x) => html`${x.assignedName ?? x.assigned ?? '—'}<br /><small class="muted">${CHANGE_TEXT[x.change] ?? x.change ?? ''}${x.streak ? ` · ${x.streak}. dönem` : ''}</small>` },
        { key: 'flags', label: 'Uyarılar', render: (x) => (x.flags?.length ? x.flags.map((f) => FLAG_TEXT[f] ?? f).join(', ') : '—') },
      ]}
      rows=${d.scores}
    />`}</${Loading}>`;
}

// ---- Rapor ----------------------------------------------------------------------------------------------
function Report() {
  const [range, setRange] = useState({ from: monthStart(), to: today() });
  const r = useApi(`/api/app/agency/report?${new URLSearchParams({ from: dayStart(range.from), to: nextDay(range.to) })}`);
  return html`
    <div style="margin:12px 0"><${DateRange} value=${range} onChange=${setRange} /></div>
    <${Loading} state=${r}>${(d) => html`
      <div class="kpis">
        <${Kpi} label="Matrah" value=${`${dia(d.totals.base)} elmas`} sub=${usd(d.totals.usd.base)} />
        <${Kpi} label="Ajans komisyonu" value=${`${dia(d.totals.commission)} elmas`} sub=${`${usd(d.totals.usd.commission)} · doğrudan ${dia(d.totals.direct)} · fark ${dia(d.totals.difference)}${d.totals.transition ? ` · geçiş ${dia(d.totals.transition)}` : ''}`} />
        <${Kpi} label="BD payı" value=${`${dia(d.totals.bd)} elmas`} sub=${usd(d.totals.usd.bd)} />
        <${Kpi} label="Platforma kalan" value=${`${dia(d.totals.platformKeeps)} elmas`} />
        <${Kpi} label="İşlem / yayıncı" value=${`${num(d.totals.events)} / ${num(d.totals.streamers)}`} />
        ${d.activity && html`<${Kpi} label="Dönemde" value=${`${num(d.activity.newAgencies)} yeni ajans`} sub=${`${num(d.activity.newStreamers)} yeni yayıncı · ${num(d.activity.transfers)} transfer`} />
        <${Kpi} label="Ödenen ajans ödemesi" value=${`${dia(d.activity.paid)} elmas`} sub=${`açık ${dia(d.activity.openPayouts)} elmas`} />`}
      </div>
      <${Card} title="Üst ajanslar"><${Table} dense empty="Bu dönemde komisyon yok" columns=${[
        { key: 'name', label: 'Ajans' },
        { key: 'base', label: 'Matrah', align: 'right', render: (x) => dia(x.base) },
        { key: 'commission', label: 'Komisyon', align: 'right', render: (x) => dia(x.commission) },
        { key: 'subs', label: 'Alt ajans', align: 'right', render: (x) => num(x.subs) },
        { key: 'streamers', label: 'Yayıncı', align: 'right', render: (x) => num(x.streamers) },
      ]} rows=${d.byTop} /></${Card}>
      <div class="grid cols2">
        <${Card} title="Alt ajanslar"><${Table} dense empty="Alt ajans komisyonu yok" columns=${[
          { key: 'name', label: 'Ajans', render: (x) => html`${x.name}<br /><small class="muted">↳ ${x.parent ?? ''}</small>` },
          { key: 'base', label: 'Matrah', align: 'right', render: (x) => dia(x.base) },
          { key: 'own', label: 'Kendi payı', align: 'right', render: (x) => dia(x.own) },
          { key: 'toParent', label: 'Üste', align: 'right', render: (x) => dia(x.toParent) },
        ]} rows=${d.bySub} /></${Card}>
        <${Card} title="En çok kazandıran yayıncılar"><${Table} dense empty="Yayıncı yok" columns=${[
          { key: 'name', label: 'Yayıncı' },
          { key: 'base', label: 'Matrah', align: 'right', render: (x) => dia(x.base) },
          { key: 'commission', label: 'Komisyon', align: 'right', render: (x) => dia(x.commission) },
        ]} rows=${d.topStreamers} /></${Card}>
      </div>`}</${Loading}>`;
}

// ---- Simülasyon -----------------------------------------------------------------------------------------
function Simulate({ s }) {
  const tree = useApi('/api/app/agency/tree');
  const [out, setOut] = useState(null);
  const live = (tree.data?.nodes ?? []).filter((a) => a.status === 'approved' || a.status === 'suspended');
  return html`<div style="margin-top:12px">
    <p class="muted">Bir matrahın bugünkü kurallarla nasıl bölüşüleceği: seçilen ajansın zinciriyle ya da elle yazılan oranlarla. Hiçbir şey kaydedilmez.</p>
    <${Loading} state=${tree}>${() => html`<${Form}
      submitLabel="Hesapla"
      fields=${[
        { name: 'base', label: 'Matrah (elmas)', type: 'number', required: true, def: '100000' },
        { name: 'agencyId', label: 'Ajans (boş: aşağıdaki oranlarla)', type: 'select', options: live.map((a) => [a.id, `${a.parentId ? '↳ ' : ''}${a.name}`]) },
        { name: 'topRate', label: 'Üst ajans oranı (%)', type: 'decimal', def: s ? String(Math.round(s.top_rate * 10000) / 100) : '', show: (v) => !v.agencyId },
        { name: 'subRate', label: 'Alt ajans oranı (%; boş: alt ajans yok)', type: 'decimal', show: (v) => !v.agencyId },
        { name: 'tier', label: 'Alt ajans kademesi', type: 'select', options: (s?.tiers ?? []).map((t) => [t.key, t.name]), show: (v) => !v.agencyId && !!String(v.subRate ?? '').trim() },
      ]}
      onSubmit=${async (v) => {
        const body = { base: Number(v.base) };
        if (v.agencyId) body.agencyId = v.agencyId;
        else {
          if (String(v.topRate ?? '').trim()) body.topRate = rateOf(v.topRate);
          if (String(v.subRate ?? '').trim()) body.subRate = rateOf(v.subRate);
          if (v.tier) body.tier = v.tier;
        }
        try {
          setOut(await post('/api/app/agency/simulate', body));
        } catch (e) {
          showError(e);
        }
      }}
    />`}</${Loading}>
    ${out && html`<${Card} title=${`${dia(out.base)} elmas (${usd(out.usd.base)})`}>
      <${Table} dense columns=${[
        { key: 'agency', label: 'Ajans' },
        { key: 'kind', label: 'Pay', render: (x) => (x.kind === 'direct' ? 'Doğrudan' : 'Fark (üst ajans)') },
        { key: 'rate', label: 'Oran', align: 'right', render: (x) => pct(x.rate) },
        { key: 'amount', label: 'Elmas', align: 'right', render: (x) => dia(x.amount) },
      ]} rows=${out.shares} />
      <p class="muted">Toplam ajans payı ${pct(out.totalRate)} (havuz sınırı ${pct(out.poolCap)}) · havuz ${dia(out.pool)} elmas (${usd(out.usd.pool)}) · platforma kalan ${dia(out.platformKeeps)} elmas</p>
    </${Card}>`}
  </div>`;
}

// ---- Denetim --------------------------------------------------------------------------------------------
const AUDIT_TYPES = [
  ['', 'Hepsi'],
  ['agency', 'Ajans'],
  ['streamer', 'Yayıncı'],
  ['transfer', 'Transfer'],
  ['commission', 'Komisyon'],
  ['setting', 'Ayar'],
  ['period', 'Dönem'],
  ['payout', 'Ödeme'],
  ['role', 'Rol'],
  ['user', 'Personel'],
  ['appeal', 'İtiraz'],
];
function Audit() {
  const [type, setType] = useState('');
  const [result, setResult] = useState('');
  const [target, setTarget] = useState('');
  const [find, setFind] = useState('');
  const rows = useApi(`/api/app/agency/audit?${new URLSearchParams({ ...(type ? { type } : {}), ...(result ? { result } : {}), ...(find ? { target: find } : {}) })}`);
  return html`
    <div class="row gap wrap" style="margin:12px 0">
      <select value=${type} onChange=${(e) => setType(e.target.value)}>${AUDIT_TYPES.map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>
      <select value=${result} onChange=${(e) => setResult(e.target.value)}><option value="">Her sonuç</option><option value="ok">Yapıldı</option><option value="denied">Reddedildi</option></select>
      <form class="row gap" onSubmit=${(e) => (e.preventDefault(), setFind(target.trim()))}>
        <input value=${target} onInput=${(e) => setTarget(e.target.value)} placeholder="Hedef kimliği" />
        <button class="btn" type="submit">Süz</button>
      </form>
    </div>
    <${Loading} state=${rows}>${(d) => html`<${Table}
      dense
      empty="Kayıt yok"
      columns=${[
        { key: 'at', label: 'Zaman', render: (x) => dateTimeTr(x.at) },
        { key: 'actor', label: 'Kim', render: (x) => x.actor?.name ?? 'Sistem' },
        { key: 'action', label: 'İşlem', render: (x) => html`<code>${x.action}</code>` },
        { key: 'target', label: 'Hedef', render: (x) => html`${x.targetType}<br /><small class="muted num">${short(x.targetId)}</small>` },
        { key: 'result', label: 'Sonuç', render: (x) => html`<${Badge} s=${x.result === 'ok' ? 'active' : 'rejected'} label=${x.result === 'ok' ? 'Yapıldı' : 'Reddedildi'} />` },
        { key: 'reason', label: 'Gerekçe', render: (x) => x.reason || '—' },
        { key: 'change', label: 'Önce → sonra', render: (x) => html`<small class="num">${json(x.before)} → ${json(x.after)}</small>` },
      ]}
      rows=${d.rows}
    />`}</${Loading}>`;
}

// ---- Komisyon defteri ve ağ kuralları -------------------------------------------------------------------
const SETTING_TEXT = {
  pool_cap: 'Toplam ajans komisyon sınırı (havuz)',
  top_rate: 'Üst ajans oranı',
  max_levels: 'Ajans katmanı',
  subagency_policy: 'Alt ajans kuralları',
  join_policy: 'Katılma kuralı',
  streamer_policy: 'Yayıncı kuralları',
  income_types: 'Komisyona giren gelir türleri',
  commission_period: 'Komisyon dönemi',
  period_close_days: 'Dönem kapanış günü',
  payout_policy: 'Ödeme kuralları',
  transfer_policy: 'Transfer kuralları',
  performance: 'Performans değerlendirmesi',
  weights: 'Performans ağırlıkları',
  tiers: 'Kademeler',
  parent_min_rate: 'Üst ajansın asgari payı',
  parent_zero: 'Üst ajans payını sıfırlama',
  parent_sees_sub_earnings: 'Üst ajans alt ajansın kazancını görür',
  parent_sees_subs: 'Üst ajans referans ajanslarının yayıncılarını ve rakamlarını görür',
  bd_policy: 'BD payı',
  suspension_policy: 'Askıya alma kuralı',
  assistant_policy: 'Ajans asistanı',
};

function Ledger({ settings }) {
  const tree = useApi('/api/app/agency/tree');
  const [edit, setEdit] = useState(null);
  const agencies = (tree.data?.nodes ?? []).filter((a) => a.status !== 'pending' && a.status !== 'draft');
  const run = async () => {
    const r = await act(() => post('/api/app/agency/commissions/run', {}));
    if (r) toast(`${num(r.checked)} gelir okundu, ${num(r.computed)} komisyon yazıldı`);
  };
  const s = settings.data?.values;
  return html`<div style="margin-top:12px">
    <p class="note warn">Bu bölümdeki kayıtlar ajansların bakiyesini ve komisyon kurallarını değiştirir; her biri gerekçesiyle ajansın denetim kaydına ve bildirimlerine geçer. Geçmiş kazançlar hiçbir ayar değişikliğiyle değişmez.</p>
    <div class="grid cols2">
      <${Card} title="Komisyon hesabı" actions=${html`<${Button} onClick=${run}>Bekleyenleri hesapla</${Button}>`}>
        <p class="muted">Komisyonu henüz yazılmamış gelirleri (en çok 2000) bugünkü zincir ve oranlarla hesaplar. Uygulama bunu kendiliğinden de yapar; elle başlatmak güvenlidir.</p>
      </${Card}>
      <${Card} title="Dönem kapat">
        <${Form}
          submitLabel="Kapat"
          fields=${[{ name: 'period', label: `Dönem (${s?.commission_period === 'week' ? 'ör. 2026-W45' : 'ör. 2026-10'})`, required: true, hint: 'Bitmemiş dönem kapatılamaz; kapanan dönemin kazancı ödeme talebine açılır' }]}
          onSubmit=${async (v, setV) => {
            if (!confirm(`${v.period} dönemi kapatılır. Bu geri alınamaz.`)) return;
            const r = await act(() => post('/api/app/agency/periods/close', { period: v.period.trim() }));
            if (r) (toast(r.replay ? 'Dönem zaten kapalıydı' : 'Dönem kapatıldı'), setV({ period: '' }));
          }}
        />
      </${Card}>
      <${Card} title="Elle gelir kaydı">
        <p class="muted">Hediye dışından gelen ve komisyona girecek gelir (kampanya, bonus, görev ödülü…); iade negatif yazılır. Yayıncının cüzdanına elmas eklemez.</p>
        <${Form}
          submitLabel="Kaydet"
          fields=${[
            { name: 'streamer', label: 'Yayıncının ID’si', required: true, wide: true, hint: ID_HINT },
            { name: 'type', label: 'Gelir türü', type: 'select', required: true, def: 'bonus', options: Object.entries(INCOME_TEXT) },
            { name: 'diamonds', label: 'Elmas (iade: eksi)', type: 'number', required: true },
          ]}
          onSubmit=${async (v, setV) => {
            const r = await act(async () => post('/api/app/agency/income', { streamer: await accountOf(v.streamer), type: v.type, diamonds: Number(v.diamonds), ref: refOf() }));
            if (r) (toast(r.commission ? `Gelir kaydedildi; komisyon ${pct(r.commission.totalRate)} (${dia(r.commission.agencyAmount)} elmas ajansa)` : 'Gelir kaydedildi'), setV({ streamer: '', type: v.type, diamonds: '' }));
          }}
        />
      </${Card}>
      <${Card} title="Komisyon ters kaydı">
        <p class="muted">Bir komisyonun ajans (ve üst ajans, asistan) satırları bu dönemde eksiyle düzeltilir. Bir kez yapılabilir.</p>
        <${Form}
          submitLabel="Ters kaydı yap"
          fields=${[
            { name: 'commissionId', label: 'Komisyon numarası', type: 'number', required: true },
            { name: 'reason', label: 'Gerekçe (ajansa bildirilir)', type: 'textarea', required: true, wide: true },
          ]}
          onSubmit=${async (v, setV) => {
            if (!confirm(`#${v.commissionId} numaralı komisyon ters kaydedilir. Geri alınamaz.`)) return;
            const r = await act(() => post('/api/app/agency/commissions/reverse', { commissionId: Number(v.commissionId), reason: v.reason }));
            if (r) (toast(`${num(r.reversed)} satır ters kaydedildi (${r.period})`), setV({ commissionId: '', reason: '' }));
          }}
        />
      </${Card}>
      <${Card} title="Düzeltme kaydı">
        <p class="muted">Bir ajansın bu dönemki bakiyesine artı ya da eksi elle düzeltme.</p>
        <${Loading} state=${tree}>${() => html`<${Form}
          submitLabel="Kaydet"
          fields=${[
            { name: 'agencyId', label: 'Ajans', type: 'select', required: true, def: agencies[0]?.id ?? '', options: agencies.map((a) => [a.id, `${a.parentId ? '↳ ' : ''}${a.name} (${a.code})`]) },
            { name: 'amount', label: 'Elmas (eksi olabilir)', type: 'decimal', required: true },
            { name: 'reason', label: 'Gerekçe (ajansa bildirilir)', type: 'textarea', required: true, wide: true },
          ]}
          onSubmit=${async (v, setV) => {
            const amount = Number(String(v.amount).replace(',', '.'));
            if (!Number.isFinite(amount) || !amount) return showError(new Error('Tutar sıfırdan farklı bir sayı olmalı'));
            const r = await act(() => post('/api/app/agency/adjust', { agencyId: v.agencyId, amount, reason: v.reason, ref: refOf() }));
            if (r) (toast(`Düzeltme kaydedildi (${r.period})`), setV({ agencyId: v.agencyId, amount: '', reason: '' }));
          }}
        />`}</${Loading}>
      </${Card}>
    </div>
    <${Card} title="Ağ kuralları">
      <${Loading} state=${settings}>${(d) => html`
        <${Table} dense columns=${[
          { key: 'k', label: 'Kural', render: ([k]) => html`<strong>${SETTING_TEXT[k] ?? k}</strong><br /><small class="muted num">${k}</small>` },
          { key: 'v', label: 'Şu an', render: ([, v]) => html`<small class="num">${json(v)}</small>` },
          { key: 'x', label: '', render: ([k, v]) => html`<${Button} onClick=${() => setEdit({ key: k, value: v })}>Değiştir</${Button}>` },
        ]} rows=${Object.entries(d.values)} />
        <h3 style="margin-top:14px">Son değişiklikler</h3>
        <${Table} dense empty="Varsayılanlar kullanılıyor" columns=${[
          { key: 'created_at', label: 'Zaman', render: (x) => dateTimeTr(x.created_at) },
          { key: 'key', label: 'Kural', render: (x) => SETTING_TEXT[x.key] ?? x.key },
          { key: 'value', label: 'Değer', render: (x) => html`<small class="num">${json(x.value)}</small>` },
          { key: 'reason', label: 'Gerekçe' },
          { key: 'set_by', label: 'Kim', render: (x) => x.set_by ?? '—' },
        ]} rows=${d.history.slice(0, 30)} />`}</${Loading}>
    </${Card}>
    ${edit && html`<${SettingEditor} k=${edit.key} value=${edit.value} onClose=${() => setEdit(null)} onSaved=${() => (setEdit(null), toast('Kural kaydedildi'), settings.reload())} />`}
  </div>`;
}

function SettingEditor({ k, value, onClose, onSaved }) {
  const [text, setText] = useState(JSON.stringify(value, null, 2));
  const [reason, setReason] = useState('');
  // Ajans asistanı: how many assistants an agency may have at once, picked rather than written as JSON.
  const assistants = k === 'assistant_policy';
  const [max, setMax] = useState(String(value?.max ?? 1));
  const save = async () => {
    let v;
    try {
      v = assistants ? { max: Number(max) } : JSON.parse(text);
    } catch {
      return showError(new Error('Değer geçerli JSON değil'));
    }
    if (reason.trim().length < 3) return showError(new Error('Gerekçe yazın'));
    if (!confirm(`${SETTING_TEXT[k] ?? k} değişir; yeni kazançlar yeni kurala göre hesaplanır.`)) return;
    if (await act(() => post('/api/app/agency/settings', { key: k, value: v, reason: reason.trim() }))) onSaved();
  };
  return html`<${Modal} title=${SETTING_TEXT[k] ?? k} onClose=${onClose}>
    ${assistants
      ? html`<p class="muted">Bir ajans aynı anda en fazla bu kadar asistan ekleyebilir. Sınır düşürülürse var olan asistanlar kalır, yenisi eklenemez.</p>
          <label class="field"><span>Ajans başına asistan</span><select value=${max} onChange=${(e) => setMax(e.target.value)}>${(max === '0' ? [0] : []).concat(Array.from({ length: 10 }, (_, i) => i + 1)).map((n) => html`<option value=${String(n)}>${n === 0 ? 'Asistan eklenemez' : `${n} kişi`}</option>`)}</select></label>`
      : html`<p class="muted">Oranlar kesir olarak yazılır (0.25 = %25). Uygulama değeri denetler; uymayan değer nedeniyle reddedilir.</p>
          <label class="field"><span>Değer (JSON)</span><textarea rows="10" class="num" value=${text} onInput=${(e) => setText(e.target.value)}></textarea></label>`}
    <label class="field" style="margin-top:10px"><span>Gerekçe (3–300) *</span><input value=${reason} maxlength="300" onInput=${(e) => setReason(e.target.value)} /></label>
    <div class="row gap end"><${Button} onClick=${onClose}>Vazgeç</${Button}><${Button} kind="primary" onClick=${save}>Kaydet</${Button}></div>
  </${Modal}>`;
}
