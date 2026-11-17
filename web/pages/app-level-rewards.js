// Uygulama › Seviye ödülleri: an item (frame, entry effect, ride, chat bubble, voice wave) that goes into Çantam of
// whoever reaches a VIP, Cömertlik or Yankı level (the app's server/api/level-rewards.mjs; server/app-admin.ts passes
// the calls on as the signed-in panel user). Everyone at or above the level gets it the next time the app reads their
// bag, once per person; one they already own for good is not given again. Taking a reward off stops new ones; items
// already given stay in the bags.
import { Button, Loading, Page, Table, Tabs, act, dateTimeTr, html, num, post, toast, useApi, useApp, usePrompt, useState } from '../lib.js';

const SYSTEMS = [
  ['vip', 'VIP'],
  ['wealth', 'Cömertlik'],
  ['charm', 'Yankı'],
];
const termOf = (days) => (days === null ? 'süresiz' : `${days} gün`);

export function AppLevelRewards() {
  const { meta } = useApp();
  const list = useApi(meta.app_link ? '/api/app/level-rewards' : null);
  const [tab, setTab] = useState('vip');
  const [ask, prompt] = usePrompt();

  if (!meta.app_link)
    return html`<${Page} title="Seviye ödülleri"><div class="empty bad">Uygulama bağlantısı ayarlı değil: sunucuda FC_APP_API_URL ve FC_APP_API_KEY gerekli.</div></${Page}>`;

  const add = async (d) => {
    const sys = d.systems[tab];
    const options = d.items.map((x) => [x.sku, `${x.name} · ${x.kindName}${x.days === null ? ' · süresiz' : ` · mağazada ${x.days} gün`}`]);
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
    const days = v.days === '' || v.days === undefined ? undefined : Number(v.days);
    const r = await act(() => post('/api/app/level-rewards', { system: tab, level: Number(v.level), sku: v.sku, ...(days ? { days } : {}) }));
    if (r) (toast('Seviye ödülü eklendi'), list.reload());
  };
  const remove = async (x) => {
    if (!confirm(`${x.systemName} ${x.level}: ${x.name} ödülü kaldırılsın mı? Bundan sonra kimse almaz; verilmiş olanlar çantalarda kalır.`)) return;
    const r = await act(() => post('/api/app/level-rewards/delete', { id: x.id }));
    if (r) (toast('Ödül kaldırıldı'), list.reload());
  };

  return html`<${Page}
    title="Seviye ödülleri"
    subtitle="VIP, Cömertlik ya da Yankı'da bir seviyeye gelen kişinin Çantam'ına düşen eşyalar: çerçeve, giriş efekti, binek, sohbet balonu, ses dalgası. Kişi Çantam'da eşyanın nereden geldiğini görür (örneğin “Seviye ödülü · VIP 5”)."
  >
    ${prompt}
    <${Loading} state=${list}>${(d) => {
      const rows = d.rules.filter((x) => x.system === tab);
      const item = new Map(d.items.map((x) => [x.sku, x]));
      return html`
        <${Tabs} tabs=${SYSTEMS.map(([k, l]) => [k, `${l} (${d.rules.filter((x) => x.system === k).length})`])} value=${tab} onChange=${setTab} />
        <div class="row gap" style="align-items:center;margin:10px 0">
          <span class="muted">Ödüller seviyeye göre sıralı. Bir seviyeye birden çok eşya konabilir.</span>
          <span style="flex:1"></span>
          <${Button} kind="primary" onClick=${() => add(d)}>Ödül ekle</${Button}>
        </div>
        <${Table}
          empty=${`${d.systems[tab].name} için seviye ödülü yok`}
          columns=${[
            { key: 'level', label: 'Seviye', render: (x) => html`<strong>${x.systemName} ${x.level}</strong>` },
            { key: 'name', label: 'Eşya', render: (x) => html`${x.name} <span class="muted">${item.get(x.sku)?.kindName ?? ''}</span>${!item.has(x.sku) ? html` <span class="badge warn">Mağazada yok</span>` : ''}` },
            { key: 'days', label: 'Süre', render: (x) => (x.days !== null ? `${x.days} gün` : item.has(x.sku) ? `Mağazadaki süresi (${termOf(item.get(x.sku).days)})` : '—') },
            { key: 'given', label: 'Verilen', render: (x) => `${num(x.given)} kişi` },
            { key: 'at', label: 'Eklendi', render: (x) => dateTimeTr(x.createdAt) },
            { key: 'a', label: '', render: (x) => html`<${Button} kind="ghost" onClick=${() => remove(x)}>Kaldır</${Button}>` },
          ]}
          rows=${rows}
        />
      `;
    }}</${Loading}>
  </${Page}>`;
}
