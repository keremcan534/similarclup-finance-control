// Sunucu kapasitesi: what the app's machine is doing now (measured on it, the app's GET /api/admin/capacity) and a
// plain "if this many people come" calculator: how full the machine gets, how many it holds, the month's traffic
// and what Oracle bills (web/capacity-model.js). Kept simple on purpose: a few boxes, a few numbers, one answer.
import { Button, Card, Kpi, Loading, Page, html, num, useApi, useEffect, useState } from '../lib.js';
import { LIMITS, ORACLE, modelNow, simulate } from '../capacity-model.js';

const STATUS = {
  ok: { tone: 'ok', note: '', text: 'Rahat' },
  tight: { tone: 'warn', note: 'warn', text: 'Sınırda: büyük bir kalabalıkta yavaşlayabilir' },
  bad: { tone: 'bad', note: 'bad', text: 'Kaldırmaz: ses bozulur, uygulama yavaşlar' },
};
const usd = (v) => `${num(v, 2)} USD`;

function Number_({ label, hint, value, set, presets }) {
  return html`<label class="field">
    <span>${label}</span>
    <input inputmode="numeric" value=${value} onInput=${(e) => set(e.target.value.replace(/[^\d.,]/g, '').replace(',', '.'))} />
    ${presets && html`<div class="row gap wrap">${presets.map((p) => html`<${Button} onClick=${() => set(String(p))}>${num(p)}</${Button}>`)}</div>`}
    ${hint && html`<small class="muted">${hint}</small>`}
  </label>`;
}

function Choice({ label, value, set, options }) {
  return html`<label class="field">
    <span>${label}</span>
    <select value=${value} onChange=${(e) => set(e.target.value)}>${options.map(([v, t]) => html`<option value=${v}>${t}</option>`)}</select>
  </label>`;
}

export function Capacity() {
  const live = useApi('/api/app/capacity');
  const [f, setF] = useState({ voice: '100', speakers: '2', app: '200', busyHours: '6', cores: '1', account: 'free', rate: '49.8' });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  // Start from the machine as it is.
  useEffect(() => {
    if (live.data?.machine?.cores) setF((x) => ({ ...x, cores: String(live.data.machine.cores) }));
  }, [live.data?.machine?.cores]);
  const r = simulate(f);
  const s = STATUS[r.status];
  const tl = (v) => `${num(v * Number(f.rate || 0), 0)} TL`;

  return html`<${Page} title="Sunucu kapasitesi" subtitle="Sunucunun şu anki durumu ve 'şu kadar kişi gelirse ne olur' hesabı. Ölçümler sunucunun kendisinden dakikada bir alınır.">
    <${Card} title="Şu an">
      <${Loading} state=${live}>${(d) =>
        !d.measuring
          ? html`<div class="note">Sunucu henüz ölçüm kaydetmedi. Yeni sürüm yüklendikten birkaç dakika sonra burada görünür.</div>`
          : html`<div class="kpis">
              <${Kpi} label="İşlemci" value=${`%${num(d.now.cpu, 0)}`} tone=${d.now.cpu > LIMITS.bad ? 'bad' : d.now.cpu > LIMITS.ok ? 'warn' : 'ok'} sub=${`Son 24 saatte en çok %${num(d.peak24h.cpu, 0)}`} />
              <${Kpi} label="Seslide kişi" value=${num(d.now.voice)} sub=${`${num(d.now.speakers)} mikrofon açık · ${num(d.now.rooms)} oda`} note=${`24 saatte en çok ${num(d.peak24h.voice)} kişi`} />
              <${Kpi} label="Bu ay dışarı giden trafik" value=${`${num(d.month.txGb / 1000, 2)} TB`} sub=${`${ORACLE.freeEgressTb} TB'ı ücretsiz`} tone=${d.month.txGb / 1000 > ORACLE.freeEgressTb ? 'bad' : ''} />
              <${Kpi} label="Makine" value=${`${num(d.machine.cores)} çekirdek · ${num(d.machine.memGb, 0)} GB`} sub=${`Bellek %${num(d.now.mem, 0)} dolu`} />
            </div>
            ${d.now.voice > 0 && html`<div class="note">Hesap bu kalabalık için işlemciyi %${num(modelNow(d.now, d.machine.cores), 0)} tahmin ediyor; ölçülen %${num(d.now.cpu, 0)}. Fark büyükse aşağıdaki tahminler de o kadar şaşar.</div>`}`}
      </${Loading}>
    </${Card}>

    <div class="grid" style="grid-template-columns:minmax(260px,380px) minmax(0,1fr)">
      <${Card} title="Şu kadar kişi gelirse">
        <${Number_} label="Aynı anda seslide kişi" value=${f.voice} set=${set('voice')} presets=${[50, 100, 200, 500, 1000]} />
        <${Choice} label="Bir odada aynı anda konuşan" value=${f.speakers} set=${set('speakers')} options=${[1, 2, 3, 5, 10].map((x) => [String(x), `${x} kişi`])} />
        <${Number_} label="Aynı anda uygulamada gezen (seslide olmayan)" value=${f.app} set=${set('app')} />
        <${Number_} label="Günde kaç saat bu kadar kalabalık" hint="Gerisinde altıda biri kadar kişi olduğu varsayılır." value=${f.busyHours} set=${set('busyHours')} />
        <${Choice} label="Makine" value=${f.cores} set=${set('cores')} options=${[1, 2, 4, 8].map((x) => [String(x), `${x} çekirdek · ${x * 6} GB`])} />
        <${Choice} label="Oracle hesabı" value=${f.account} set=${set('account')} options=${[['free', 'Ücretsiz hesap'], ['payg', 'Kullandıkça öde (PAYG)']]} />
        <${Number_} label="Dolar kuru (TL)" value=${f.rate} set=${set('rate')} />
      </${Card}>

      <${Card} title="Sonuç">
        <div class=${`note ${s.note}`} style="font-size:16px"><strong>${s.text}</strong> · işlemci yaklaşık %${num(r.cpu, 0)}</div>
        ${r.needsPayg && html`<div class="note bad">Ücretsiz hesapta en fazla ${ORACLE.freeAccount.cores} çekirdek / ${ORACLE.freeAccount.memGb} GB çalışır. Bu makine için hesabı Kullandıkça öde (PAYG) yapın.</div>`}
        <div class="kpis">
          <${Kpi} label="Bu makinenin kaldırdığı" value=${`~${num(r.maxVoice)} kişi seslide`} sub=${`${f.speakers} konuşan oda ve ${num(f.app)} gezenle`} />
          <${Kpi} label="Aylık dışarı trafik" value=${`${num(r.monthTb, 2)} TB`} sub=${r.monthTb > ORACLE.freeEgressTb ? `${ORACLE.freeEgressTb} TB ücretsiz sınırı aşar` : `${num(r.freeEgressLeftTb, 2)} TB ücretsiz pay kalır`} tone=${r.monthTb > ORACLE.freeEgressTb ? 'bad' : 'ok'} />
          <${Kpi} label="Aylık Oracle faturası" value=${r.totalUsd > 0 ? usd(r.totalUsd) : 'Ücretsiz'} sub=${r.totalUsd > 0 ? `≈ ${tl(r.totalUsd)}` : 'Ücretsiz sınırların içinde'} tone=${r.totalUsd > 0 ? 'warn' : 'ok'} />
        </div>
        ${r.totalUsd > 0 &&
        html`<div class="note">Makine: ${usd(r.computeUsd)} · Trafik: ${usd(r.egressUsd)}. Fiyatlar Oracle'ın Kasım 2026 listesi; makinenin ücretsiz payı PAYG hesapta ayda ${num(ORACLE.paygFree.ocpuHours)} çekirdek-saat ve ${num(ORACLE.paygFree.gbHours)} GB-saat.</div>`}
        <div class="note">Tahmin, uygulamanın yük testinden çıkan katsayılarla yapılır. Ses için asıl yük konuşan sayısıdır: dinleyici az, konuşan çok yorar. Bir odada 5000 kişi tek makineye sığmaz; ses sunucusu ayrı makineye geçmeli.</div>
      </${Card}>
    </div>
  </${Page}>`;
}
