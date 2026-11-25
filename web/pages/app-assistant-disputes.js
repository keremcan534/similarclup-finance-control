// Asistan itirazları (the app's agency-assistants.mjs, owners 25 Nov 2026): an agency owner can no longer end an
// assistant alone. The owner asks; the assistant accepts, rejects or disputes; after a rejection the owner may
// dispute. A dispute lands here: staff talk to both sides, then decide (remove the assistant, or keep them).
import { Badge, Button, Form, Loading, Modal, Page, Table, Tabs, act, dateTimeTr, html, post, toast, useApi, useApp, useState } from '../lib.js';

const STATUS = {
  pending: 'Asistanın cevabı bekleniyor',
  accepted: 'Asistan onayladı (çıktı)',
  rejected: 'Asistan reddetti',
  disputed: 'İtiraz: yönetim kararı bekliyor',
  removed: 'Yönetim: çıkarıldı',
  kept: 'Yönetim: asistan kaldı',
  closed: 'Kapandı (asistanlık başka yolla bitti)',
};
const person = (p) => html`${p.name}${p.no ? html` <small class="muted num">· ID ${p.no}</small>` : ''}`;

export function AppAssistantDisputes() {
  const { can } = useApp();
  const [tab, setTab] = useState('open');
  const list = useApi(`/api/app/agency/assistant-removals${tab === 'all' ? '?status=all' : ''}`, [tab]);
  const [open, setOpen] = useState(null);
  return html`<${Page}
    title="Asistan itirazları"
    subtitle="Ajans sahibi bir asistanı çıkarmak isteyince asistana sorulur: onaylarsa çıkar, reddederse kalır. Asistan itiraz ederse ya da sahip retten sonra itiraz ederse konu buraya düşer. İki tarafla iletişime geçip karar verin."
  >
    <${Tabs} tabs=${[['open', 'Karar bekleyenler'], ['all', 'Tüm istekler']]} value=${tab} onChange=${setTab} />
    <${Loading} state=${list}>${(d) => html`<${Table}
      empty=${tab === 'open' ? 'Karar bekleyen itiraz yok' : 'İstek yok'}
      columns=${[
        { key: 'agency', label: 'Ajans', render: (r) => html`<strong>${r.agency.name}</strong>` },
        { key: 'owner', label: 'Ajans sahibi', render: (r) => person(r.owner) },
        { key: 'assistant', label: 'Asistan', render: (r) => person(r.assistant) },
        { key: 'status', label: 'Durum', render: (r) => html`<${Badge} s=${r.status === 'disputed' ? 'pending' : r.status === 'removed' || r.status === 'accepted' ? 'rejected' : 'approved'} label=${STATUS[r.status] ?? r.status} />` },
        { key: 'note', label: 'İtiraz', render: (r) => (r.disputeNote ? html`<small><b>${r.disputedBy === 'owner' ? 'Sahip' : 'Asistan'}:</b> ${r.disputeNote}</small>` : '—') },
        { key: 'askedAt', label: 'İstek', render: (r) => dateTimeTr(r.askedAt) },
      ]}
      rows=${d.requests}
      onRow=${(r) => setOpen(r)}
    />`}<//>
    ${open && html`<${Resolve} r=${open} canDecide=${can('app.agencies') && open.status === 'disputed'} onClose=${() => setOpen(null)} onSaved=${() => (setOpen(null), toast('Karar kaydedildi; iki tarafa bildirim gitti'), list.reload())} />`}
  <//>`;
}

function Resolve({ r, canDecide, onClose, onSaved }) {
  return html`<${Modal} title="Asistan itirazı" onClose=${onClose}>
    <p><strong>${r.agency.name}</strong> · sahibi ${person(r.owner)} · asistan ${person(r.assistant)}</p>
    <p class="muted">Durum: ${STATUS[r.status] ?? r.status}. İstek ${dateTimeTr(r.askedAt)}${r.disputedAt ? `, itiraz ${dateTimeTr(r.disputedAt)}` : ''}.</p>
    ${r.disputeNote && html`<p><b>${r.disputedBy === 'owner' ? 'Ajans sahibinin' : 'Asistanın'} itirazı:</b> ${r.disputeNote}</p>`}
    ${r.resolutionNote && html`<p><b>Karar notu:</b> ${r.resolutionNote}</p>`}
    ${canDecide
      ? html`<${Form}
          submitLabel="Kararı kaydet"
          onCancel=${onClose}
          fields=${[
            { name: 'outcome', label: 'Karar', type: 'select', required: true, options: [['keep', 'Asistan kalsın'], ['remove', 'Asistanlıktan çıkarılsın']] },
            { name: 'note', label: 'Karar notu (3–500; iki tarafla görüşmenin özeti)', type: 'textarea', required: true },
          ]}
          onSubmit=${async (v) => {
            if (await act(() => post('/api/app/agency/assistant-removals/resolve', { requestId: r.id, outcome: v.outcome, note: v.note.trim() }))) onSaved();
          }}
        />`
      : html`<div class="row gap end"><${Button} onClick=${onClose}>Kapat<//></div>`}
  <//>`;
}
