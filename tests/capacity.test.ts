// Sunucu kapasitesi (web/capacity-model.js): the calculator against the app's load test (its docs/YUK_TESTI.md, one
// core) and Oracle's November 2026 prices, and the page's route in APP_ROUTES.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { APP_ROUTES } from '../server/app-admin.ts';

const m: any = await import(new URL('../web/capacity-model.js', import.meta.url).href);

test('yük testindeki ölçümlere yakın ve temkinli: ortalamadan az değil, tepeden çok fazla değil', () => {
  // [konuşan, dinleyen, ölçülen ortalama %, ölçülen tepe %] on one core.
  const rows = [
    [10, 50, 28, 28],
    [3, 200, 35, 57],
    [10, 200, 84, 99],
  ];
  for (const [talk, listen, avg, peak] of rows) {
    const r = m.simulate({ voice: talk + listen, speakers: talk, app: 0, cores: 1 });
    assert.ok(r.cpu >= avg - 2 && r.cpu <= peak + 12, `${talk}+${listen}: ${r.cpu} (ölçülen ${avg}–${peak})`);
  }
});

test('100 kişi seslide tek çekirdekte rahat; 1000 kişi bozulur; çekirdek eklenince kaldırdığı artar', () => {
  const small = m.simulate({ voice: 100, speakers: 2, app: 200, cores: 1 });
  assert.equal(small.status, 'ok');
  assert.equal(m.simulate({ voice: 1000, speakers: 3, app: 500, cores: 1 }).status, 'bad');
  const one = m.simulate({ voice: 0, speakers: 2, app: 200, cores: 1 }).maxVoice;
  const four = m.simulate({ voice: 0, speakers: 2, app: 200, cores: 4 }).maxVoice;
  assert.ok(four > one * 3.5, `${one} → ${four}`);
  // At its own limit the machine is at about 85 %.
  const at = m.simulate({ voice: one, speakers: 2, app: 200, cores: 1 });
  assert.ok(at.cpu <= 85 && at.cpu > 83, `${at.cpu}`);
});

test('Oracle: ücretsiz hesapta 2 çekirdek bedava, fazlası PAYG ister; PAYG 4 çekirdeğe kadar bedava, 8 çekirdek ücretli', () => {
  assert.equal(m.simulate({ voice: 50, cores: 2, account: 'free' }).needsPayg, false);
  assert.equal(m.simulate({ voice: 50, cores: 4, account: 'free' }).needsPayg, true);
  assert.equal(m.simulate({ voice: 50, cores: 4, account: 'payg' }).computeUsd, 0);
  // 8 cores / 48 GB: (5840 − 3000) × 0,01 + (35040 − 18000) × 0,0015 = 28,40 + 25,56.
  assert.equal(m.simulate({ voice: 50, cores: 8, account: 'payg' }).computeUsd, 53.96);
});

test('trafik: ilk 10 TB ücretsiz, fazlası GB başına; günün geri kalanı altıda biri', () => {
  const quiet = m.simulate({ voice: 100, speakers: 2, busyHours: 6, cores: 2, account: 'payg' });
  assert.equal(quiet.egressUsd, 0);
  assert.ok(quiet.monthTb > 0 && quiet.monthTb < 10);
  const busy = m.simulate({ voice: 3000, speakers: 3, busyHours: 24, cores: 8, account: 'payg' });
  // 9000 streams × 0,025 Mbit/s = 225 Mbit/s all month ≈ 72,9 TB.
  assert.ok(Math.abs(busy.monthTb - 72.9) < 0.2, `${busy.monthTb}`);
  assert.ok(Math.abs(busy.egressUsd - (busy.monthTb - 10) * 8.5) < 1, `${busy.egressUsd}`);
});

test('sayfanın verisi uygulamadan, maliyet görme yetkisiyle gelir', () => {
  assert.deepEqual(APP_ROUTES.find(([meth, p]) => meth === 'GET' && p === '/api/admin/capacity')?.[2], 'costs.view');
});
