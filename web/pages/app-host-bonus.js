// Uygulama › Yayıncı haftalık bonusu: what each agency streamer got when a week closed (the app's host-bonus.mjs:
// GET /api/admin/host-bonus, POST …/pay, …/reverse; permission app.host_bonus). The app pays it by itself every Monday
// 00:00 Türkiye time; the tiers and the on/off switch are in Canlı ayarlar › Yayıncı haftalık bonusu. Here: the weeks,
// the week still running (who would get what if it ended now), a week skipped while the bonus was off paid, and a
// bonus taken back (what of it may still leave the account).
import { Badge, Button, Card, Kpi, Loading, Page, Table, act, dateTimeTr, html, num, post, toast, useApi, useApp, usePrompt, useState } from '../lib.js';

export function AppHostBonus() {
  const { can } = useApp();
  const [week, setWeek] = useState('');
  const data = useApi(`/api/app/host-bonus${week ? `?week=${week}` : ''}`);
  const [ask, prompt] = usePrompt();
  const edit = can('app.host_bonus');

  const pay = async (d) => {
    const v = await ask(`${d.label} haftasını öde`, {
      text: 'Bu hafta bonus kapalıyken kapandı. Şimdiki baremlerle, ajansa bağlı ya da yönetim yayıncısı olup bareme ulaşan her yayıncıya bonusu elmas olarak yüklenir ve SimilarClub Sistem’den bildirim gider.',
      label: 'Neden',
      ok: 'Öde',
    });
    if (!v) return;
    const r = await act(() => post('/api/app/host-bonus/pay', { week: d.week, reason: v.reason }));
    if (r) {
      toast(`${num(r.people)} yayıncıya toplam ${num(r.diamonds)} elmas ödendi`);
      data.reload();
    }
  };
  const reverse = async (row) => {
    const v = await ask('Bonusu geri al', {
      text: `${row.name}: ${num(row.bonus)} elmas. Hesapta çekilebilir elmas kadarı düşülür (kilitli elmas kalır); kişiye SimilarClub Sistem’den bildirim gider. Geri alınan bonus tekrar ödenmez.`,
      label: 'Neden',
      ok: 'Geri al',
    });
    if (!v) return;
    const r = await act(() => post('/api/app/host-bonus/reverse', { id: row.id, reason: v.reason }));
    if (r) {
      toast(r.taken === r.bonus ? `${num(r.taken)} elmas geri alındı` : `${num(r.taken)} / ${num(r.bonus)} elmas geri alındı (kalanı hesapta yoktu)`);
      data.reload();
    }
  };

  return html`<${Page} title="Yayıncı haftalık bonusu" subtitle="Ajansa bağlı yayıncılar ve yönetim yayıncıları (kayıttan 3 gün sonra ajansı olmayan ya da ajanstan düşen), haftada (Pazartesi 00:00 – Pazar 23:59:59, Türkiye saati) kazandıkları elmasla ulaştıkları baremin bonusunu her Pazartesi 00:00’da elmas olarak alır; bildirim SimilarClub Sistem’den gider. Bonustan ajans komisyonu çıkmaz. Baremler ve açma/kapama: Canlı ayarlar › Yayıncı haftalık bonusu.">
    ${prompt}
    <${Loading} state=${data}>${(d) => html`
      ${!d.on && html`<p class="note bad">Bonus şu an kapalı: kapalıyken biten hafta ödenmez (atlanır). Atlanan haftayı bu sayfadan ödeyebilirsiniz.</p>`}
      <div class="row gap wrap" style="margin-bottom:10px">
        <button class=${`chip ${d.week >= d.current ? 'on' : ''}`} onClick=${() => setWeek(d.current)}>Bu hafta (${d.currentLabel})</button>
        ${d.weeks.map((w) => html`<button class=${`chip ${d.week === w.week ? 'on' : ''}`} onClick=${() => setWeek(w.week)}>${w.label}${w.on ? '' : ' · atlandı'}</button>`)}
      </div>
      <div class="kpis">
        <${Kpi} label="Hafta" value=${d.label} sub=${d.preview ? 'sürüyor: bitse kim ne alırdı' : d.run ? (d.run.on ? (d.run.doneAt ? `ödendi ${dateTimeTr(d.run.doneAt)}` : 'ödeniyor') : 'atlandı (bonus kapalıydı)') : 'kapanmadı'} />
        <${Kpi} label="Yayıncı" value=${num(d.rows.length)} />
        <${Kpi} label=${d.preview ? 'Ödenecek (şu ana kadar)' : 'Ödenen (geri alınanlar düşülmüş)'} value=${`${num(d.total)} 💎`} />
      </div>
      ${!d.preview && d.run && !d.run.on && edit && html`<p><${Button} kind="primary" onClick=${() => pay(d)}>Bu haftayı öde</${Button}></p>`}
      <${Card} title=${d.preview ? 'Bu hafta şu ana kadar' : 'Ödenen bonuslar'}>
        <${Table}
          empty=${d.preview ? 'Henüz bareme ulaşan yayıncı yok' : d.run && !d.run.on ? 'Bu hafta atlandı; bonus ödenmedi' : 'Bu hafta bonus alan yok'}
          columns=${[
            { key: 'name', label: 'Yayıncı', render: (r) => html`${r.name}<br /><small class="muted">${r.userId}</small>` },
            { key: 'agency', label: 'Ajans', render: (r) => (r.kind === 'management' ? html`<span class="muted">Yönetim yayıncısı</span>` : r.agency || '—') },
            { key: 'earned', label: 'Haftalık kazanç', align: 'right', render: (r) => `${num(r.earned)} 💎` },
            { key: 'tierFrom', label: 'Barem', align: 'right', render: (r) => num(r.tierFrom) },
            { key: 'bonus', label: 'Bonus', align: 'right', render: (r) => `${num(r.bonus)} 💎` },
            {
              key: 'status',
              label: 'Durum',
              render: (r) =>
                d.preview
                  ? html`<span class="muted">hafta sürüyor</span>`
                  : r.reversed
                    ? html`<${Badge} s="cancelled" label="Geri alındı" /><br /><small class="muted">${num(r.reversed.amount)} 💎 · ${dateTimeTr(r.reversed.at)}${r.reversed.by ? ` · ${r.reversed.by}` : ''}<br />${r.reversed.reason}</small>`
                    : html`<${Badge} s="paid" label="Ödendi" />`,
            },
            { key: 'a', label: '', render: (r) => !d.preview && !r.reversed && edit && html`<${Button} kind="danger" onClick=${() => reverse(r)}>Geri al</${Button}>` },
          ]}
          rows=${d.rows}
        />
      </${Card}>
      <${Card} title="Baremler (şu an)">
        <${Table} dense columns=${[
          { key: 'from', label: 'Haftalık kazanç', render: (t) => `${num(t.from)}${t.to ? ` – ${num(t.to)}` : ' ve üstü'} 💎` },
          { key: 'bonus', label: 'Bonus', align: 'right', render: (t) => `${num(t.bonus)} 💎` },
        ]} rows=${d.tiers.map((t, i) => ({ ...t, to: d.tiers[i + 1] ? d.tiers[i + 1].from - 1 : null }))} />
      </${Card}>`}</${Loading}>
  </${Page}>`;
}
