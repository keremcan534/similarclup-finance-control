// Uygulama › Seviye ve görev ödülleri: an item (frame, entry effect, ride, chat bubble, voice wave) that goes into
// Çantam of whoever reaches a VIP, Cömertlik or Yankı level (the app's server/api/level-rewards.mjs), or takes a
// task's reward (task-rewards.mjs: the daily video call today); server/app-admin.ts passes the calls on as the
// signed-in panel user. A level's reward: everyone at or above the level gets it the next time the app reads their
// bag, once per person; one they already own for good is not given again. A task's: each time the task is taken (a
// daily task each day, its days added to what they have). Taking a reward off stops new ones; items already given
// stay in the bags.
import { Button, Loading, Page, Table, Tabs, act, dateTimeTr, html, num, post, toast, useApi, useApp, usePrompt, useState } from '../lib.js';

const SYSTEMS = [
  ['vip', 'VIP'],
  ['wealth', 'Cömertlik'],
  ['charm', 'Yankı'],
];
const termOf = (days) => (days === null ? 'süresiz' : `${days} gün`);
const optionsOf = (items) => items.map((x) => [x.sku, `${x.name} · ${x.kindName}${x.days === null ? ' · süresiz' : ` · mağazada ${x.days} gün`}`]);
const daysOf = (v) => (v.days === '' || v.days === undefined ? undefined : Number(v.days));

export function AppLevelRewards() {
  const { meta } = useApp();
  const [tab, setTab] = useState('vip');
  if (!meta.app_link)
    return html`<${Page} title="Seviye ve görev ödülleri"><div class="empty bad">Uygulama bağlantısı ayarlı değil: sunucuda FC_APP_API_URL ve FC_APP_API_KEY gerekli.</div></${Page}>`;
  return html`<${Page}
    title="Seviye ve görev ödülleri"
    subtitle="VIP, Cömertlik ya da Yankı'da bir seviyeye gelen, ya da bir görevi tamamlayan kişinin Çantam'ına düşen eşyalar: çerçeve, giriş efekti, binek, sohbet balonu, ses dalgası. Kişi Çantam'da eşyanın nereden geldiğini görür (örneğin “Seviye ödülü · VIP 5”, “Görev ödülü · Günlük görüntülü arama”)."
  >
    <${Tabs} tabs=${[...SYSTEMS, ['task', 'Görev']]} value=${tab} onChange=${setTab} />
    ${tab === 'task' ? html`<${TaskRewards} />` : html`<${LevelRewards} key=${tab} system=${tab} />`}
  </${Page}>`;
}

function LevelRewards({ system }) {
  const list = useApi('/api/app/level-rewards');
  const [ask, prompt] = usePrompt();
  const add = async (d) => {
    const sys = d.systems[system];
    const options = optionsOf(d.items);
    const v = await ask(`${sys.name}: seviye ödülü ekle`, {
      text: `Bu seviyeye gelen herkes eşyayı Çantam'ında bulur. Seviyeyi daha önce geçmiş olanlar da alır (uygulamayı bir sonraki açışında). Herkes bir kez alır; ücretsizdir.`,
      fields: [
        { name: 'level', label: `${sys.name} seviyesi (1–${sys.top})`, type: 'number', required: true },
        { name: 'sku', label: 'Eşya', type: 'select', required: true, options, def: options[0]?.[0], wide: true },
        { name: 'days', label: 'Gün', type: 'number', hint: `Boş: mağazadaki süresi. Süresiz eşyaya gün verilmez. En fazla ${d.limits.daysMax}.` },
      ],
      ok: 'Ekle',
    });
    if (!v) return;
    const days = daysOf(v);
    const r = await act(() => post('/api/app/level-rewards', { system, level: Number(v.level), sku: v.sku, ...(days ? { days } : {}) }));
    if (r) (toast('Seviye ödülü eklendi'), list.reload());
  };
  const remove = async (x) => {
    if (!confirm(`${x.systemName} ${x.level}: ${x.name} ödülü kaldırılsın mı? Bundan sonra kimse almaz; verilmiş olanlar çantalarda kalır.`)) return;
    const r = await act(() => post('/api/app/level-rewards/delete', { id: x.id }));
    if (r) (toast('Ödül kaldırıldı'), list.reload());
  };
  return html`${prompt}<${Loading} state=${list}>${(d) => {
    const item = new Map(d.items.map((x) => [x.sku, x]));
    return html`
      <div class="row gap" style="align-items:center;margin:10px 0">
        <span class="muted">Ödüller seviyeye göre sıralı. Bir seviyeye birden çok eşya konabilir.</span>
        <span style="flex:1"></span>
        <${Button} kind="primary" onClick=${() => add(d)}>Ödül ekle</${Button}>
      </div>
      <${Table}
        empty=${`${d.systems[system].name} için seviye ödülü yok`}
        columns=${[
          { key: 'level', label: 'Seviye', render: (x) => html`<strong>${x.systemName} ${x.level}</strong>` },
          { key: 'name', label: 'Eşya', render: (x) => html`${x.name} <span class="muted">${item.get(x.sku)?.kindName ?? ''}</span>${!item.has(x.sku) ? html` <span class="badge warn">Mağazada yok</span>` : ''}` },
          { key: 'days', label: 'Süre', render: (x) => (x.days !== null ? `${x.days} gün` : item.has(x.sku) ? `Mağazadaki süresi (${termOf(item.get(x.sku).days)})` : '—') },
          { key: 'given', label: 'Verilen', render: (x) => `${num(x.given)} kişi` },
          { key: 'at', label: 'Eklendi', render: (x) => dateTimeTr(x.createdAt) },
          { key: 'a', label: '', render: (x) => html`<${Button} kind="ghost" onClick=${() => remove(x)}>Kaldır</${Button}>` },
        ]}
        rows=${d.rules.filter((x) => x.system === system)}
      />
    `;
  }}</${Loading}>`;
}

function TaskRewards() {
  const list = useApi('/api/app/task-rewards');
  const [ask, prompt] = usePrompt();
  const add = async (d) => {
    const tasks = Object.entries(d.tasks);
    const options = optionsOf(d.items);
    const v = await ask('Görev ödülü ekle', {
      text: 'Görevi tamamlayıp ödülünü alan kişi eşyayı Çantam\'ında da bulur, ücretsiz. Günlük görev her gün verir: süreli eşyanın günü her seferinde eklenir (1 gün önerilir: görevi her gün yapan eşyayı hep kullanır).',
      fields: [
        { name: 'task', label: 'Görev', type: 'select', required: true, options: tasks, def: tasks[0]?.[0] },
        { name: 'sku', label: 'Eşya', type: 'select', required: true, options, def: options[0]?.[0], wide: true },
        { name: 'days', label: 'Gün', type: 'number', def: '1', hint: `Boş: mağazadaki süresi. Süresiz eşyaya gün verilmez. En fazla ${d.limits.daysMax}.` },
      ],
      ok: 'Ekle',
    });
    if (!v) return;
    const days = daysOf(v);
    const r = await act(() => post('/api/app/task-rewards', { task: v.task, sku: v.sku, ...(days ? { days } : {}) }));
    if (r) (toast('Görev ödülü eklendi'), list.reload());
  };
  const remove = async (x) => {
    if (!confirm(`${x.taskName}: ${x.name} ödülü kaldırılsın mı? Bundan sonra görev bunu vermez; verilmiş olanlar çantalarda kalır.`)) return;
    const r = await act(() => post('/api/app/task-rewards/delete', { id: x.id }));
    if (r) (toast('Ödül kaldırıldı'), list.reload());
  };
  return html`${prompt}<${Loading} state=${list}>${(d) => {
    const item = new Map(d.items.map((x) => [x.sku, x]));
    return html`
      <div class="row gap" style="align-items:center;margin:10px 0">
        <span class="muted">Sunucuda sayılan görevler: ${Object.values(d.tasks).join(', ')}. Görevin jeton ödülü ve çanta hediyesi Canlı ayarlar'da.</span>
        <span style="flex:1"></span>
        <${Button} kind="primary" onClick=${() => add(d)}>Ödül ekle</${Button}>
      </div>
      <${Table}
        empty="Görev ödülü yok"
        columns=${[
          { key: 'task', label: 'Görev', render: (x) => html`<strong>${x.taskName}</strong>` },
          { key: 'name', label: 'Eşya', render: (x) => html`${x.name} <span class="muted">${item.get(x.sku)?.kindName ?? ''}</span>${!item.has(x.sku) ? html` <span class="badge warn">Mağazada yok</span>` : ''}` },
          { key: 'days', label: 'Her seferinde', render: (x) => (x.days !== null ? `${x.days} gün` : item.has(x.sku) ? `Mağazadaki süresi (${termOf(item.get(x.sku).days)})` : '—') },
          { key: 'given', label: 'Verilen', render: (x) => `${num(x.given)} kez` },
          { key: 'at', label: 'Eklendi', render: (x) => dateTimeTr(x.createdAt) },
          { key: 'a', label: '', render: (x) => html`<${Button} kind="ghost" onClick=${() => remove(x)}>Kaldır</${Button}>` },
        ]}
        rows=${d.rules}
      />
    `;
  }}</${Loading}>`;
}
