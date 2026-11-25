// Aileler (the app's families.mjs, 25 Nov 2026): the open families, and a family founded by staff for a person, free
// (no founding fee): its name and the founder's ID; the founder leads it and is told in the app.
import { Button, ID_HINT, Loading, Modal, Page, Table, Form, accountOf, act, dateTimeTr, html, num, post, toast, useApi, useApp, useState } from '../lib.js';

export function AppFamilies() {
  const { can } = useApp();
  const list = useApi('/api/app/families');
  const [create, setCreate] = useState(false);
  const [q, setQ] = useState('');
  return html`<${Page}
    title="Aileler"
    subtitle="Uygulamadaki açık aileler. Yönetim bir kişi için ücretsiz aile kurabilir: kurucu ailenin lideri olur ve uygulamada haber alır."
    actions=${can('app.users') && html`<${Button} kind="primary" onClick=${() => setCreate(true)}>+ Aile oluştur</${Button}>`}
  >
    <${Loading} state=${list}>${(d) => {
      const rows = d.families.filter((f) => !q.trim() || f.name.toLocaleLowerCase('tr-TR').includes(q.trim().toLocaleLowerCase('tr-TR')) || (f.leader.no ?? '').includes(q.trim()));
      return html`
        <input class="bm-search" style="margin-bottom:12px;max-width:360px" placeholder="🔍 Aile adı ya da liderin ID’si" value=${q} onInput=${(e) => setQ(e.target.value)} />
        <${Table}
          empty="Açık aile yok"
          columns=${[
            { key: 'name', label: 'Aile', render: (f) => html`<strong>${f.name}</strong>` },
            { key: 'leader', label: 'Lider', render: (f) => html`${f.leader.name}${f.leader.no ? html` <small class="muted num">· ID ${f.leader.no}</small>` : ''}` },
            { key: 'members', label: 'Üye', align: 'right', render: (f) => num(f.members) },
            { key: 'createdAt', label: 'Kuruluş', render: (f) => dateTimeTr(f.createdAt) },
          ]}
          rows=${rows}
        />`;
    }}</${Loading}>
    ${create && html`<${CreateFamily} onClose=${() => setCreate(false)} onSaved=${(f) => (setCreate(false), toast(`${f.name} kuruldu`), list.reload())} />`}
  </${Page}>`;
}

function CreateFamily({ onClose, onSaved }) {
  return html`<${Modal} title="Aile oluştur" onClose=${onClose}>
    <p class="muted">Aile ücretsiz kurulur (kurma ücreti alınmaz). Kurucu ailenin lideri olur; zaten bir ailede olan kişi için kurulamaz. Aile adı 2–24 karakter, açık ailelerde tekrar etmez.</p>
    <${Form}
      submitLabel="Aileyi kur"
      onCancel=${onClose}
      fields=${[
        { name: 'name', label: 'Aile adı (2–24)', required: true },
        { name: 'founder', label: 'Kurucunun ID’si', required: true, hint: ID_HINT },
      ]}
      onSubmit=${async (v) => {
        const r = await act(async () => post('/api/app/families/create', { name: v.name.trim(), founder: await accountOf(v.founder) }));
        if (r) onSaved(r.family);
      }}
    />
  </${Modal}>`;
}
