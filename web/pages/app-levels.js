// Uygulama › Seviyeler ve VIP: the Similar Club app's VIP, Rütbe, Cömertlik, Yankı and Abonelik, set here without an
// app update (the app's server/api/levels.mjs and levels-admin.mjs; server/app-admin.ts passes the calls on as the
// signed-in panel user). Each system is a tab with its levels (points, names; a Rütbe tier's price and days), which
// perk opens at which level, and for VIP, Cömertlik and Yankı the level drop for the inactive. Saving shows first what
// changes (who moves up or down, whom the drop takes today) and asks for a confirm when anyone would drop; a save
// someone else made meanwhile is refused (the page is read again). The last tab lists the level drops.
import { Badge, Button, Card, Loading, Modal, Page, Table, Tabs, act, dateTimeTr, html, num, post, useApi, useApp, useState } from '../lib.js';

const SYSTEMS = [
  ['vip', 'VIP'],
  ['noble', 'Rütbe'],
  ['wealth', 'Cömertlik'],
  ['charm', 'Yankı'],
  ['sub', 'Abonelik'],
];
const NAME = Object.fromEntries(SYSTEMS);
/** What counts as being active for the level drop (the app's levels-admin.mjs LAST_ACTIVE). */
const ACTIVITY = {
  vip: 'mağazadan jeton yüklemek',
  wealth: 'jeton harcamak (hediye, mağaza; oyun turları, zarf ve aktarımlar sayılmaz)',
  charm: 'birinden hediye almak',
};
const POINTS = {
  vip: 'Puan: mağazadan yüklenen jeton (1 jeton = 1 puan). Bonus, kampanya ve Jeton Noktası jetonu sayılmaz.',
  wealth: 'Puan: harcanan jeton (hediye, mağaza). Oyun turları, zarf, çanta ve jeton aktarımı sayılmaz.',
  charm: 'Puan: başkalarının hediyelerinden gelen elmas.',
};
const clone = (x) => JSON.parse(JSON.stringify(x));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const toNumber = (v) => (v === '' ? 0 : Number(String(v).replace(',', '.')));

/** The app's level curve (profile-rules.mjs levelCurve): Lv.1 and Lv.50 set it; readable steps, always growing. */
function curve(first, last, max = 50) {
  const readable = (x) => {
    if (x < 100) return Math.max(5, Math.round(x / 5) * 5);
    const step = 10 ** (Math.floor(Math.log10(x)) - 1);
    return Math.round(x / step) * step;
  };
  const g = (last / (first * max ** 1.5)) ** (1 / (max - 1));
  const a = first / g;
  const out = Array.from({ length: max + 1 }, (_, l) => (l === 0 ? 0 : readable(a * l ** 1.5 * g ** l)));
  for (let l = 1; l <= max; l++) if (out[l] <= out[l - 1]) out[l] = out[l - 1] + 1;
  return out;
}

export function AppLevels() {
  const { can, meta } = useApp();
  const list = useApi(meta.app_link ? '/api/app/levels' : null);
  const [tab, setTab] = useState('vip');
  // Unsaved changes per system, kept while switching tabs; dropped once that system is saved (its rev moves).
  const [drafts, setDrafts] = useState({});

  if (!meta.app_link)
    return html`<${Page} title="Seviyeler ve VIP"><div class="empty bad">Uygulama bağlantısı ayarlı değil: sunucuda FC_APP_API_URL ve FC_APP_API_KEY gerekli.</div></${Page}>`;
  const edit = can('app.levels');
  const dirty = (d) => SYSTEMS.filter(([s]) => {
    const v = d.systems.find((x) => x.system === s);
    return drafts[s] && drafts[s].rev === v.rev && !same(drafts[s].doc, v.doc);
  }).map(([s]) => s);

  return html`<${Page}
    title="Seviyeler ve VIP"
    subtitle="VIP, Rütbe, Cömertlik, Yankı ve Abonelik: seviye puanları, adlar, hangi hakkın hangi seviyede açıldığı ve seviye düşmesi. Kaydedince sunucunun denetimleri hemen, telefonlar bir dakika içinde yeni ayarı izler."
  >
    <${Loading} state=${list}>${(d) => {
      const open = dirty(d);
      return html`
        <${Tabs} tabs=${[...SYSTEMS.map(([k, l]) => [k, open.includes(k) ? `${l} •` : l]), ['drops', 'Seviye düşüşleri']]} value=${tab} onChange=${setTab} />
        ${open.length > 0 && html`<p class="note warn">Kaydedilmemiş değişiklik var: ${open.map((s) => NAME[s]).join(', ')}.</p>`}
        ${tab === 'drops'
          ? html`<${Drops} />`
          : (() => {
              const view = d.systems.find((x) => x.system === tab);
              const draft = drafts[tab]?.rev === view.rev ? drafts[tab].doc : view.doc;
              return html`<${SystemEditor}
                key=${tab}
                view=${view}
                perks=${d.perks}
                doc=${draft}
                setDoc=${(doc) => setDrafts((x) => ({ ...x, [tab]: { rev: view.rev, doc } }))}
                edit=${edit}
                onSaved=${() => (setDrafts((x) => ({ ...x, [tab]: undefined })), list.reload())}
              />`;
            })()}
      `;
    }}</${Loading}>
  </${Page}>`;
}

/** One system's settings: its levels, perks and level drop, with preview, save and back to today's values. */
function SystemEditor({ view, perks, doc, setDoc, edit, onSaved }) {
  const [check, setCheck] = useState(null);
  const s = view.system;
  const changed = !same(doc, view.doc);
  const set = (fn) => {
    const x = clone(doc);
    fn(x);
    setDoc(x);
  };
  const ask = async (action) => {
    const target = action === 'reset' ? view.defaults : doc;
    const r = await act(() => post('/api/app/levels/preview', { system: s, doc: target }));
    if (r) setCheck({ action, impact: r.impact, doc: target });
  };
  const top = s === 'vip' ? doc.levels.length : s === 'noble' ? doc.levels.length : s === 'sub' ? 1 : 50;
  const bottom = s === 'wealth' || s === 'charm' ? 0 : 1;

  return html`
    <${Card}
      title=${html`<span>${NAME[s]}</span> ${view.edited ? html`<${Badge} s="warning" label="Panelde değiştirildi" />` : html`<${Badge} s="info" label="Bugünkü değerler" />`}
        ${view.updatedAt && html` <small class="muted">son kayıt ${dateTimeTr(view.updatedAt)}</small>`}`}
      actions=${edit &&
      html`
        ${changed && html`<${Button} onClick=${() => setDoc(clone(view.doc))}>Vazgeç</${Button}>`}
        <${Button} onClick=${() => ask('save')} disabled=${!changed}>Önizle ve kaydet</${Button}>
        ${view.edited && html`<${Button} kind="ghost" onClick=${() => ask('reset')}>Bugünkü değerlere dön</${Button}>`}
      `}
    >
      <${Notes} system=${s} />
    </${Card}>
    ${s === 'vip' && html`<${VipLevels} doc=${doc} set=${set} edit=${edit} />`}
    ${s === 'noble' && html`<${NobleLevels} doc=${doc} set=${set} edit=${edit} />`}
    ${(s === 'wealth' || s === 'charm') && html`<${CurveLevels} system=${s} doc=${doc} set=${set} edit=${edit} />`}
    ${(s === 'wealth' || s === 'charm') && html`<${Groups} system=${s} doc=${doc} set=${set} edit=${edit} />`}
    ${s === 'sub' && html`<${SubPlans} doc=${doc} set=${set} edit=${edit} />`}
    <${Perks} system=${s} doc=${doc} set=${set} perks=${perks} edit=${edit} top=${top} bottom=${bottom} />
    ${doc.decay && s !== 'vip' && html`<${Decay} system=${s} doc=${doc} set=${set} edit=${edit} top=${top} />`}
    ${s === 'vip' && html`<${Card} title="VIP seviye koruma (aylık)"><p class="muted">Her ayın 1'i 00:00'da (Türkiye) önceki ay değerlendirilir. Ay içinde yükselen yeni seviyesinde kalır; seviyesinin koruma puanını (seviyenin puanı eksi bir alttakinin) yükleyen korur; yüklemeyen ya da yetmeyen bir seviye düşer, ikinci ay da tutmazsa VIP sıfırlanır. VIP olunan ilk ay değerlendirilmez. Her ay seviyenin kendi puanından başlar. Koruma puanları yukarıdaki seviye puanlarından hesaplanır. Yükseltme koruma dönemi (ücretli erteleme): Canlı ayarlar › VIP.</p></${Card}>`}
    ${check && html`<${Impact} system=${s} view=${view} check=${check} onClose=${() => setCheck(null)} onSaved=${() => (setCheck(null), onSaved())} />`}
  `;
}

/** What older APKs see and what the server applies for everyone. */
function Notes({ system }) {
  if (system === 'noble')
    return html`<p class="note">Kademenin adı, fiyatı ya da günü değişince yeni uygulama yeni fiyatı ve günü gösterir. Eski APK'lar kendi içindeki kademeyi gösterdiği için bu kademeyi alamaz, "uygulamayı güncelle" görür. Kimse gördüğünden farklı bir fiyat ya da gün için ödemez. Süren rütbeler değişmez.</p>`;
  if (system === 'sub')
    return html`<p class="note">Ödenen fiyatı mağaza belirler (Play Console); buradaki fiyat yalnız uygulamada yazar, mağazadakiyle aynı tutulmalı. Gizlenen paket yeni uygulamada görünmez; eski APK'lar kendi içindeki paketleri göstermeye devam eder. Satışı gerçekten durdurmak için paketi Play Console'da da kapatın.</p>`;
  return html`<p class="note">Sunucunun denetimleri (VIP hediyeleri, mağaza, oda şifresi, sessiz ziyaret, Oyun Salonu, Anlar) herkes için hemen yeni ayara uyar. Eski APK'lar seviyeyi kendi içindeki eşiklerle gösterir: eşik değişirse kişinin kendi telefonunda gördüğü seviye yeni APK'ya geçene kadar farklı olabilir.</p>`;
}

const cell = (label, input) => html`<label class="field" style="margin:0"><span class="sr-only">${label}</span>${input}</label>`;

function VipLevels({ doc, set, edit }) {
  const add = () =>
    set((d) => {
      const n = d.levels.length + 1;
      d.levels.push({ level: n, points: Math.round((d.levels.at(-1)?.points ?? 500_000) * 1.5), name: `VIP ${n}` });
    });
  const pop = () =>
    set((d) => {
      d.levels.pop();
      const top = d.levels.length;
      for (const p of d.perks) p.from = Math.min(p.from, top);
      if (d.decay) d.decay.floor = Math.min(d.decay.floor, top);
    });
  return html`<${Card}
    title="Seviyeler"
    actions=${edit &&
    html`<${Button} onClick=${add} disabled=${doc.levels.length >= 15}>Seviye ekle</${Button}>
      <${Button} onClick=${pop} disabled=${doc.levels.length <= 1}>Son seviyeyi sil</${Button}>`}
  >
    <p class="muted">${POINTS.vip} En çok 15 seviye. Rütbe sahibi ayrıca her kademe için 3 VIP seviyesi sayılır (çerçeve ve mağaza için).</p>
    <div class="table-wrap"><table class="dense levels">
      <thead><tr><th>Seviye</th><th>Ad</th><th class="r">Puan (jeton)</th></tr></thead>
      <tbody>${doc.levels.map(
        (l, i) => html`<tr key=${i}>
          <td>VIP ${l.level}</td>
          <td>${cell(`VIP ${l.level} adı`, html`<input value=${l.name} maxlength="24" disabled=${!edit} onInput=${(e) => set((d) => (d.levels[i].name = e.target.value))} />`)}</td>
          <td class="r"><div class="row gap">${cell(`VIP ${l.level} puanı`, html`<input type="number" min="1" step="1" value=${l.points} disabled=${!edit} style="text-align:right" onInput=${(e) => set((d) => (d.levels[i].points = toNumber(e.target.value)))} />`)}<small class="muted readable">${num(l.points)}</small></div></td>
        </tr>`,
      )}</tbody>
    </table></div>
  </${Card}>`;
}

function NobleLevels({ doc, set, edit }) {
  // Rütbe's packages (21 Nov 2026): the main term (the one older APKs buy) and at most two more (7 and 90 days by
  // default), each with its own price; the app shows the saving against the shortest one's daily rate.
  const plansOf = (l) => l.plans ?? [];
  const perDay = (price, days) => (days > 0 ? Math.round(price / days) : 0);
  return html`<${Card} title="Kademeler ve paketler">
    <p class="muted">Rütbe jetonla satın alınır ve süresi dolunca biter; seviye düşmesi yoktur. Yüksek kademe sürerken düşüğü alınamaz; aynı kademe yeniden alınınca süresi uzar (en fazla 365 gün). Ana süre eski APK'ların sattığı pakettir; yanına en fazla iki paket daha eklenir (uygulama 7, 30 ve 90 gün önerir). Uygulama her paketin indirimini en kısa paketin günlük fiyatına göre gösterir.</p>
    <div class="table-wrap"><table class="dense levels">
      <thead><tr><th>Kademe</th><th>Ad</th><th class="r">Ana süre (gün)</th><th class="r">Ana fiyat (jeton)</th><th>Diğer paketler (gün · jeton)</th></tr></thead>
      <tbody>${doc.levels.map(
        (l, i) => html`<tr key=${i}>
          <td>${l.level}</td>
          <td>${cell(`Kademe ${l.level} adı`, html`<input value=${l.name} maxlength="24" disabled=${!edit} onInput=${(e) => set((d) => (d.levels[i].name = e.target.value))} />`)}</td>
          <td class="r">${cell(`Kademe ${l.level} süresi`, html`<input type="number" min="1" max="365" step="1" value=${l.days} disabled=${!edit} style="text-align:right;width:70px" onInput=${(e) => set((d) => (d.levels[i].days = toNumber(e.target.value)))} />`)}</td>
          <td class="r"><div class="row gap">${cell(`Kademe ${l.level} fiyatı`, html`<input type="number" min="1" step="1" value=${l.price} disabled=${!edit} style="text-align:right" onInput=${(e) => set((d) => (d.levels[i].price = toNumber(e.target.value)))} />`)}<small class="muted readable">${num(l.price)} · günü ${num(perDay(l.price, l.days))}</small></div></td>
          <td>
            ${plansOf(l).map(
              (p, j) => html`<div class="row gap" key=${j} style="margin-bottom:4px;align-items:center">
                ${cell(`Kademe ${l.level} paket ${j + 1} günü`, html`<input type="number" min="1" max="365" step="1" value=${p.days} disabled=${!edit} style="text-align:right;width:64px" onInput=${(e) => set((d) => (d.levels[i].plans[j].days = toNumber(e.target.value)))} />`)}
                <span class="muted">gün</span>
                ${cell(`Kademe ${l.level} paket ${j + 1} fiyatı`, html`<input type="number" min="1" step="1" value=${p.price} disabled=${!edit} style="text-align:right;width:110px" onInput=${(e) => set((d) => (d.levels[i].plans[j].price = toNumber(e.target.value)))} />`)}
                <small class="muted readable">${num(p.price)} · günü ${num(perDay(p.price, p.days))}</small>
                ${edit && html`<button type="button" class="btn link" onClick=${() => set((d) => d.levels[i].plans.splice(j, 1))}>Kaldır</button>`}
              </div>`,
            )}
            ${edit && plansOf(l).length < 2 && html`<button type="button" class="btn link" onClick=${() => set((d) => (d.levels[i].plans = [...(d.levels[i].plans ?? []), { days: 7, price: d.levels[i].price }]))}>+ Paket ekle</button>`}
            ${!plansOf(l).length && !edit && html`<span class="muted">Yalnız ana süre</span>`}
          </td>
        </tr>`,
      )}</tbody>
    </table></div>
  </${Card}>`;
}

/** Cömertlik and Yankı: Lv.0–50, each level's points, with a helper that fills them on the app's curve. */
function CurveLevels({ system, doc, set, edit }) {
  const [first, setFirst] = useState(String(doc.levels[1].points));
  const [last, setLast] = useState(String(doc.levels[50].points));
  const fill = () => {
    const a = toNumber(first);
    const b = toNumber(last);
    if (!(a >= 1 && b > a * 50)) return alert('Lv.1 puanı en az 1, Lv.50 puanı Lv.1’in 50 katından büyük olmalı.');
    const pts = curve(a, b);
    set((d) => d.levels.forEach((l, i) => (l.points = pts[i])));
  };
  return html`<${Card} title="Seviyeler (Lv.0–50)">
    <p class="muted">${POINTS[system]} Her seviye bir öncekinden büyük olmalı; Lv.0 her zaman 0.</p>
    ${edit &&
    html`<div class="row gap wrap" style="margin-bottom:10px">
      <label class="row gap">Lv.1 <input type="number" min="1" value=${first} onInput=${(e) => setFirst(e.target.value)} style="width:110px" /></label>
      <label class="row gap">Lv.50 <input type="number" min="1" value=${last} onInput=${(e) => setLast(e.target.value)} style="width:140px" /></label>
      <${Button} onClick=${fill}>Aradakileri eğriyle doldur</${Button}>
      <small class="muted">Uygulamanın eğrisi: her seviye bir öncekinden biraz daha fazla ister.</small>
    </div>`}
    <div class="level-grid">${doc.levels.map(
      (l, i) => html`<label key=${i}><b>Lv.${l.level}</b>
        <input type="number" min=${i ? 1 : 0} step="1" value=${l.points} disabled=${!edit || i === 0} aria-label=${`Lv.${l.level} puanı`}
          onInput=${(e) => set((d) => (d.levels[i].points = toNumber(e.target.value)))} /></label>`,
    )}</div>
  </${Card}>`;
}

/** The named level groups (Kuvars Lv.0–4, …): one after another from Lv.0 to Lv.50. */
function Groups({ system, doc, set, edit }) {
  const fix = (d) => {
    d.groups.forEach((g, i) => (g.from = i ? d.groups[i - 1].to + 1 : 0));
    d.groups.at(-1).to = 50;
  };
  const add = () =>
    set((d) => {
      const g = d.groups.at(-1);
      if (g.to - g.from < 1) return;
      const mid = Math.floor((g.from + g.to) / 2);
      d.groups.push({ from: mid + 1, to: g.to, name: 'Yeni grup' });
      g.to = mid;
      fix(d);
    });
  const remove = (i) =>
    set((d) => {
      if (d.groups.length <= 1) return;
      if (i > 0) d.groups[i - 1].to = d.groups[i].to;
      d.groups.splice(i, 1);
      fix(d);
    });
  return html`<${Card} title="Seviye grupları" actions=${edit && html`<${Button} onClick=${add} disabled=${doc.groups.length >= 20}>Grup ekle</${Button}>`}>
    <p class="muted">${NAME[system]} rozetinde seviyenin grubu yazar. Gruplar Lv.0'dan Lv.50'ye boşluksuz sıralanır; bir grubun bitişini değiştirince sonraki oradan başlar.</p>
    <div class="table-wrap"><table class="dense levels">
      <thead><tr><th>Seviyeler</th><th>Ad</th><th class="r">Bitiş</th><th></th></tr></thead>
      <tbody>${doc.groups.map(
        (g, i) => html`<tr key=${i}>
          <td>Lv.${g.from}–${g.to}</td>
          <td>${cell('Grup adı', html`<input value=${g.name} maxlength="24" disabled=${!edit} onInput=${(e) => set((d) => (d.groups[i].name = e.target.value))} />`)}</td>
          <td class="r">${i === doc.groups.length - 1
            ? cell('Grubun bitişi', html`<input value="50" disabled style="width:80px;text-align:right" />`)
            : cell('Grubun bitişi', html`<input type="number" min=${g.from} max="49" value=${g.to} disabled=${!edit} style="width:80px;text-align:right"
                onInput=${(e) => set((d) => ((d.groups[i].to = Math.max(d.groups[i].from, Math.min(49, toNumber(e.target.value)))), fix(d)))} />`)}</td>
          <td class="r">${edit && doc.groups.length > 1 && html`<${Button} kind="ghost" class="btn tiny" onClick=${() => remove(i)}>Sil</${Button}>`}</td>
        </tr>`,
      )}</tbody>
    </table></div>
  </${Card}>`;
}

function SubPlans({ doc, set, edit }) {
  return html`<${Card} title="Paketler">
    <p class="note warn">Üstü çizili "eski fiyat", ancak paket gerçekten o fiyata satıldıysa gösterilmeli; satılmadıysa yanıltıcı indirim sayılabilir (Ticari Reklam ve Haksız Ticari Uygulamalar Yönetmeliği). Emin değilseniz 0 yazın (gösterilmez).</p>
    <div class="table-wrap"><table class="dense levels">
      <thead><tr><th>Paket</th><th>Görünür</th><th>Etiket</th><th class="r">Uygulamada yazan (TL)</th><th class="r">Üstü çizili (TL)</th></tr></thead>
      <tbody>${doc.plans.map(
        (p, i) => html`<tr key=${p.productId}>
          <td><code>${p.productId}</code> <small class="muted">${p.days} gün</small></td>
          <td><input type="checkbox" checked=${p.visible} disabled=${!edit} aria-label=${`${p.productId} görünür`} onChange=${(e) => set((d) => (d.plans[i].visible = e.target.checked))} /></td>
          <td>${cell(`${p.productId} etiketi`, html`<input value=${p.label} maxlength="30" disabled=${!edit} onInput=${(e) => set((d) => (d.plans[i].label = e.target.value))} />`)}</td>
          <td class="r">${cell(`${p.productId} fiyatı`, html`<input inputmode="decimal" value=${p.tl} disabled=${!edit} style="width:100px;text-align:right" onInput=${(e) => set((d) => (d.plans[i].tl = toNumber(e.target.value)))} />`)}</td>
          <td class="r">${cell(`${p.productId} üstü çizili fiyatı`, html`<input inputmode="decimal" value=${p.was} disabled=${!edit} style="width:100px;text-align:right" onInput=${(e) => set((d) => (d.plans[i].was = toNumber(e.target.value)))} />`)}</td>
        </tr>`,
      )}</tbody>
    </table></div>
  </${Card}>`;
}

/** Every perk this system may give: on / off and from which level; the ones not built yet are listed, closed. */
function Perks({ system, doc, set, perks, edit, top, bottom }) {
  const list = perks.filter((p) => p.systems.includes(system));
  const levels = Array.from({ length: top - bottom + 1 }, (_, i) => bottom + i);
  const label = (n) => (system === 'vip' ? `VIP ${n}` : system === 'noble' ? `Kademe ${n}` : `Lv.${n}`);
  const entry = (key) => doc.perks.find((x) => x.key === key);
  const toggle = (p, on) =>
    set((d) => {
      const x = d.perks.find((y) => y.key === p.key);
      if (x) x.on = on;
      else d.perks.push({ key: p.key, from: bottom || 1, on });
    });
  const move = (p, from) =>
    set((d) => {
      const x = d.perks.find((y) => y.key === p.key);
      if (x) x.from = from;
      else d.perks.push({ key: p.key, from, on: true });
    });
  return html`<${Card} title="Haklar">
    <p class="muted">Hazır haklar istediğiniz seviyeye bağlanır, açılır, kapatılır; sunucu da öyle uygular. "Kapı" olanlar (Oyun Salonu, Anlar, VIP hediyeleri ve mağaza eşyaları) kapatılamaz, yalnız seviyesi değişir. "Henüz yapılmadı" olanlar bir kez kodla yapılınca açılabilir.</p>
    <div class="table-wrap"><table class="dense levels">
      <thead><tr><th>Hak</th><th>Durum</th><th>Açık</th>${system !== 'sub' && html`<th>Şu seviyeden</th>`}</tr></thead>
      <tbody>${list.map((p) => {
        const x = entry(p.key);
        const on = !!x?.on;
        return html`<tr key=${p.key} class=${p.ready ? '' : 'muted'}>
          <td>${p.name}</td>
          <td>${!p.ready ? html`<${Badge} s="passive" label="Henüz yapılmadı" />` : p.gate ? html`<${Badge} s="info" label="Kapı" />` : html`<${Badge} s="active" label="Hazır" />`}</td>
          <td><input type="checkbox" checked=${on} disabled=${!edit || !p.ready || p.gate} aria-label=${`${p.name} açık`} onChange=${(e) => toggle(p, e.target.checked)} /></td>
          ${system !== 'sub' &&
          html`<td>${p.ready
            ? html`<select value=${x?.from ?? bottom} disabled=${!edit || (!on && !p.gate)} aria-label=${`${p.name} seviyesi`} onChange=${(e) => move(p, Number(e.target.value))}>
                ${levels.map((n) => html`<option value=${n}>${label(n)}</option>`)}
              </select>`
            : '—'}</td>`}
        </tr>`;
      })}</tbody>
    </table></div>
  </${Card}>`;
}

/** The level drop for the inactive (VIP, Cömertlik, Yankı); off until turned on here. */
function Decay({ system, doc, set, edit, top }) {
  const r = doc.decay;
  const unit = system === 'vip' ? 'VIP ' : 'Lv.';
  const field = (key, label, min, max, hint) => html`<label class="field">
    <span>${label}</span>
    <input type="number" min=${min} max=${max} step="1" value=${r[key]} disabled=${!edit} onInput=${(e) => set((d) => (d.decay[key] = toNumber(e.target.value)))} />
    ${hint && html`<small class="muted">${hint}</small>`}
  </label>`;
  return html`<${Card} title="Seviye düşmesi">
    <label class="field inline"><span>Açık: hareket etmeyenin seviyesi düşer</span><input type="checkbox" checked=${r.on} disabled=${!edit} onChange=${(e) => set((d) => (d.decay.on = e.target.checked))} /></label>
    <p class="muted">Hareket: ${ACTIVITY[system]}. ${r.on
      ? `${r.idleDays} gün hareket etmeyenin seviyesi ${r.drop} düşer ve puanı yeni seviyesinin başına iner; hareketsizlik sürerse ${r.everyDays} günde bir yeniden düşer; ${unit}${r.floor} altına inmez. Yeniden hareket edince puanı her zamanki gibi artar.`
      : 'Kapalıyken kimsenin seviyesi düşmez.'}</p>
    <div class="grid2" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px">
      ${field('idleDays', 'Hareketsizlik (gün)', 1, 365, 'Bu kadar gün hareket yoksa düşer')}
      ${field('drop', 'Kaç seviye', 1, 10, 'Her düşüşte')}
      ${field('everyDays', 'Ne sıklıkla (gün)', 1, 365, 'Hareketsizlik sürerken')}
      ${field('floor', 'Taban', 0, top, `Bunun altına düşmez (${unit}${r.floor})`)}
    </div>
    ${r.on && html`<p class="note warn">Düşen herkese bildirim gider; yeni uygulamanın seviye sayfası kuralı yazar. Parayla kazanılan VIP düşebilecekse bu Kullanım Koşulları'nda açıkça yazmalı.</p>`}
  </${Card}>`;
}

/** Before saving: what changes, and a confirm when anyone would drop. */
function Impact({ system, view, check, onClose, onSaved }) {
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const i = check.impact;
  const risky = i.down > 0 || i.decayToday > 0;
  const unit = system === 'vip' ? 'VIP ' : system === 'noble' ? 'Kademe ' : 'Lv.';
  const counts = Object.entries(i.levels ?? {}).sort((a, b) => Number(a[0]) - Number(b[0]));
  const commit = async () => {
    setBusy(true);
    const reset = check.action === 'reset';
    const r = await act(
      () => post(reset ? '/api/app/levels/reset' : '/api/app/levels/save', reset ? { system, rev: view.rev, confirm: true } : { system, doc: check.doc, rev: view.rev, confirm: true }),
      reset ? 'Bugünkü değerlere dönüldü' : 'Kaydedildi',
    );
    setBusy(false);
    if (r) onSaved();
  };
  return html`<${Modal} title=${check.action === 'reset' ? `${NAME[system]}: bugünkü değerlere dön` : `${NAME[system]}: kaydetmeden önce`} onClose=${onClose}>
    ${system === 'sub'
      ? html`<p>Abonelik ayarı kimsenin seviyesini değiştirmez.</p>`
      : system === 'noble'
        ? html`<p>Şu an rütbesi süren: <b>${num(i.people)}</b> kişi. Süren rütbeler değişmez; yeni ad, fiyat ve gün yeni alımlarda geçer.</p>`
        : html`<p>Puanı olan <b>${num(i.people)}</b> kişiden <b>${num(i.up)}</b> kişi yükselir, <b>${num(i.down)}</b> kişi düşer.${i.decayToday ? html` Seviye düşmesi bugün <b>${num(i.decayToday)}</b> kişiyi düşürür.` : ''}</p>`}
    ${check.doc.decay?.on && !view.doc.decay?.on && html`<p>Seviye düşmesi açılıyor. Hareket: ${ACTIVITY[system]}. ${check.doc.decay.idleDays} gün hareket etmeyenin seviyesi düşer; sunucu buna günde birkaç kez bakar. ${i.decayToday ? `İlk bakışta ${num(i.decayToday)} kişi düşer.` : 'Bugün kimse düşmez.'}</p>`}
    ${check.doc.decay && !check.doc.decay.on && view.doc.decay?.on && html`<p>Seviye düşmesi kapanıyor: bundan sonra kimsenin seviyesi düşmez (düşmüş puanlar geri gelmez).</p>`}
    ${counts.length > 0 && html`<p class="muted">Sonra: ${counts.map(([l, n]) => `${l === '0' && system === 'vip' ? 'VIP değil' : `${unit}${l}`}: ${num(n)}`).join(' · ')}</p>`}
    ${risky &&
    html`<p class="note warn">
        ${i.down > 0 && html`Kaydedince ${num(i.down)} kişinin seviyesi düşer; eşiği geri alırsanız seviyeleri geri gelir (puanları değişmez). `}
        ${i.decayToday > 0 && html`Seviye düşmesi bugün ${num(i.decayToday)} kişinin puanını düşürür ve onlara bildirim gider; bu puan, kural kapatılsa da geri gelmez.`}
      </p>
      <label class="field inline"><span>Anladım</span><input type="checkbox" checked=${sure} onChange=${(e) => setSure(e.target.checked)} /></label>`}
    <div class="row gap end">
      <${Button} onClick=${onClose}>Vazgeç</${Button}>
      <${Button} kind="primary" onClick=${commit} disabled=${busy || (risky && !sure)}>${busy ? 'Kaydediliyor…' : 'Kaydet'}</${Button}>
    </div>
  </${Modal}>`;
}

/** The latest level drops: who, which system, from which level to which, how long they had been inactive. */
function Drops() {
  const [system, setSystem] = useState('');
  const list = useApi(`/api/app/levels/drops${system ? `?system=${system}` : ''}`);
  const unit = (s) => (s === 'vip' ? 'VIP ' : 'Lv.');
  return html`<${Card} title="Seviye düşüşleri">
    <div class="row gap wrap" style="margin-bottom:10px">
      ${[['', 'Hepsi'], ['vip', 'VIP'], ['wealth', 'Cömertlik'], ['charm', 'Yankı']].map(
        ([k, l]) => html`<button class=${`chip ${system === k ? 'on' : ''}`} onClick=${() => setSystem(k)}>${l}</button>`,
      )}
    </div>
    <${Loading} state=${list}>${(d) => html`<${Table}
      dense
      empty="Henüz seviye düşüşü yok. Seviye düşmesi her sistemde ayrı açılır."
      columns=${[
        { key: 'at', label: 'Tarih', render: (r) => dateTimeTr(r.at) },
        { key: 'name', label: 'Kişi', render: (r) => html`${r.name} <small class="muted">${r.userId.slice(0, 8)}</small>` },
        { key: 'system', label: 'Sistem', render: (r) => NAME[r.system] ?? r.system },
        { key: 'from', label: 'Seviye', render: (r) => `${unit(r.system)}${r.from} → ${unit(r.system)}${r.to}` },
        { key: 'pointsBefore', label: 'Puan', align: 'right', render: (r) => `${num(r.pointsBefore)} → ${num(r.pointsAfter)}` },
        { key: 'idleDays', label: 'Hareketsiz', align: 'right', render: (r) => `${num(r.idleDays)} gün` },
      ]}
      rows=${d.drops}
    />`}</${Loading}>
  </${Card}>`;
}
