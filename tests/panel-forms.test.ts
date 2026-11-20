// The Uygulama pages' form rules, apart from the pages (no browser): Şanslı hediye ayarı's odds editor and new package
// (web/lucky-odds.js) and Hediyeler's Global hediye box and Profil izi fields (web/gift-fields.js). What they check is
// what the app's server checks (its lucky-rules.mjs, global-gifts.mjs, profile-mark-rules.mjs), so a save the page
// lets through isn't refused there for a reason the page could have said, and the body sent is what the app reads.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const odds: any = await import(new URL('../web/lucky-odds.js', import.meta.url).href);
const gift: any = await import(new URL('../web/gift-fields.js', import.meta.url).href);

test('Şanslı olasılıkları: yüzde 3 ondalıkla yazılır, "Ödül yok" kalanı alır; toplam %100 değilse kaydedilmez', () => {
  assert.equal(odds.weightOf('12,5'), 12_500);
  assert.equal(odds.weightOf('0.001'), 1);
  assert.equal(odds.weightOf(' %3 '), 3_000);
  assert.equal(odds.weightOf(''), 0);
  assert.equal(odds.weightOf('100'), 100_000);
  for (const t of ['0,0001', '100,001', '-1', 'abc', '1.2.3']) assert.equal(odds.weightOf(t), null, t);
  assert.equal(odds.pctOf(12_500), '12,5');
  assert.equal(odds.pctOf(1), '0,001');
  assert.equal(odds.pctOf(100_000), '100');
  // The app's Kayan Yıldız table round-trips through the fields.
  const tiers = [{ mult: 0, weight: 81_600 }, { mult: 2, weight: 14_000 }, { mult: 5, weight: 3_200 }, { mult: 10, weight: 900 }, { mult: 20, weight: 200 }, { mult: 50, weight: 70 }, { mult: 100, weight: 25 }, { mult: 200, weight: 5 }];
  const draft = odds.draftOf(tiers);
  assert.equal(draft[200], '0,005');
  assert.equal(draft[1000], '');
  const back = odds.oddsOf(draft);
  assert.deepEqual(back.tiers, tiers);
  assert.equal(back.ok, true);
  assert.equal(back.total, odds.TOTAL);
  assert.equal(odds.topOf(back.tiers), 200);
  assert.equal(odds.rtpOf(back.tiers), 0.64);
  // Over %100: "Ödül yok" can't go below 0; the badge shows the sum, the save stays off.
  const over = odds.oddsOf({ ...draft, 2: '99' });
  assert.equal(over.ok, false);
  assert.equal(over.none, odds.TOTAL - 99_000 - 4_400);
  assert.equal(over.total, 99_000 + 4_400);
  assert.equal(over.tiers[0].weight, 0);
  const typo = odds.oddsOf({ ...draft, 5: '3,2x' });
  assert.equal(typo.ok, false);
  assert.deepEqual(typo.bad, [5]);
  // Every saved table adds up to exactly 100,000, each multiplier at most once, as the app's server wants.
  const sum = (t: { weight: number }[]) => t.reduce((n, x) => n + x.weight, 0);
  for (const d of [draft, { 2: '33,333', 5: '33,333', 10: '33,334' }, {}, { 1000: '100' }]) {
    const o = odds.oddsOf(d);
    assert.equal(o.ok, true);
    assert.equal(sum(o.tiers), odds.TOTAL);
    assert.equal(new Set(o.tiers.map((t: { mult: number }) => t.mult)).size, o.tiers.length);
  }
});

test('yeni Şanslı paket: kimlik lkN, ad ayrı, fiyat ve simge sınırları; kaydedilecek ayarlar', () => {
  const gifts = [
    { id: 'lk1', name: 'Şans Yoncası', emoji: '🍀', price: 20, enabled: true, tiers: [{ mult: 0, weight: 100_000 }], since: 2 },
    { id: 'lk4', name: 'Kayan Yıldız', emoji: '🌠', price: 1000, enabled: true, tiers: [{ mult: 0, weight: 100_000 }], since: 1 },
    { id: 'lkxmas', name: 'Yılbaşı', emoji: '🎄', price: 50, enabled: false, tiers: [{ mult: 0, weight: 100_000 }] },
  ];
  assert.equal(odds.nextId(gifts), 'lk5');
  assert.equal(odds.nextId([]), 'lk1');
  const p = { id: 'lk5', name: 'Altın Yonca', emoji: '☘️', price: '250', enabled: false, draft: { 2: '15', 1000: '0,5' } };
  assert.deepEqual(odds.packageProblems(p, gifts), []);
  const problems = (x: object) => odds.packageProblems({ ...p, ...x }, gifts).join(' | ');
  assert.match(problems({ id: 'lk1' }), /“lk1” kimliği başka bir pakette var/);
  assert.match(problems({ id: 'yonca' }), /"lk" ile başlamalı/);
  assert.match(problems({ id: 'LK5' }), /"lk" ile başlamalı/);
  // Names compared as the app compares them: Turkish lower case (İ and i alike).
  assert.match(problems({ name: 'ŞANS YONCASI' }), /“ŞANS YONCASI” adında başka bir paket var/);
  assert.match(problems({ name: 'YILBAŞI' }), /adında başka bir paket var/);
  assert.match(problems({ name: '   ' }), /Ad 1–30 karakter/);
  assert.match(problems({ name: 'x'.repeat(31) }), /Ad 1–30 karakter/);
  assert.match(problems({ emoji: '' }), /Simge 1–8 karakter/);
  for (const price of ['4', '100001', '12.5', '']) assert.match(problems({ price }), /Fiyat 5 ile 100.000 jeton/, price);
  assert.match(problems({ draft: { 2: '60', 5: '40,5' } }), /Olasılıkların toplamı %100,5; %100 olmalı/);
  assert.match(problems({ draft: { 2: '1,2345' } }), /2x: yüzde en çok 3 ondalıklı/);
  // The settings saved: the new one at the end, `since` left to the app's server, the others as they were.
  const pkg = odds.packageOf(p);
  assert.deepEqual(pkg, { id: 'lk5', name: 'Altın Yonca', emoji: '☘️', price: 250, enabled: false, tiers: [{ mult: 0, weight: 84_500 }, { mult: 2, weight: 15_000 }, { mult: 1000, weight: 500 }] });
  const config = { gifts, dailyPayoutLimit: 20_000_000, announceFrom: 50 };
  const added = odds.withPackage(config, pkg);
  assert.deepEqual(added.gifts.map((g: { id: string }) => g.id), ['lk1', 'lk4', 'lkxmas', 'lk5']);
  assert.ok(added.gifts.every((g: object) => !('since' in g)));
  assert.equal(added.dailyPayoutLimit, 20_000_000);
  const edited = odds.withPackage(config, { ...gifts[1], price: 2000 }, 'lk4');
  assert.deepEqual(edited.gifts.map((g: { id: string; price: number }) => [g.id, g.price]), [['lk1', 20], ['lk4', 2000], ['lkxmas', 50]]);
  assert.equal(config.gifts.length, 3);
});

test('Global hediye kutusu: en düşük fiyatın altında işaretlenemez, işaretliyse kalkabilir; bağ hediyesi ve Koruma Kartında yok', () => {
  const min = 300_000;
  assert.deepEqual(gift.globalBox({ id: 'a1', price: 300_000, global: false, mark: null, min }), { hidden: false, disabled: false, hint: 'En az 300.000 jeton' });
  assert.deepEqual(gift.globalBox({ id: 'a1', price: 299_999, global: false, mark: null, min }), { hidden: false, disabled: true, hint: 'En az 300.000 jeton' });
  // A gift left under a minimum raised later: the box stays on and can come off.
  assert.deepEqual(gift.globalBox({ id: 'a1', price: 100_000, global: true, mark: null, min }), { hidden: false, disabled: false, hint: 'En az 300.000 jeton: bu fiyatla duyurulmaz' });
  assert.equal(gift.globalBox({ id: 'a1', price: 500_000, global: false, mark: { role: 'leave', kind: 'kaka' }, min }).disabled, true);
  for (const id of ['bag-kardes', 'koruma']) assert.equal(gift.globalBox({ id, price: 900_000, global: false, mark: null, min }).hidden, true, id);
  // The refusals the app's server would give, in its words; only when ticked now or the price moves.
  assert.equal(gift.globalProblem({ id: 'a1', price: 100_000, global: true, was: false, min }), 'Global hediye en az 300.000 jeton olmalı (bu 100.000 jeton)');
  assert.equal(gift.globalProblem({ id: 'a1', price: 100_000, global: true, was: true, priceChanged: true, min }), 'Global hediye en az 300.000 jeton olmalı (bu 100.000 jeton)');
  assert.equal(gift.globalProblem({ id: 'a1', price: 100_000, global: true, was: true, priceChanged: false, min }), null);
  assert.equal(gift.globalProblem({ id: undefined, price: 300_000, global: true, was: false, priceChanged: true, min }), null);
  assert.equal(gift.globalProblem({ id: 'a1', price: 100, global: false, was: true, min }), null);
  assert.match(gift.globalProblem({ id: 'k1', price: 900_000, global: true, was: true, mark: { role: 'leave', kind: 'kaka' }, min }), /Profil izi bırakan ya da temizleyen hediye global olamaz/);
  assert.match(gift.globalProblem({ id: 'bag-kanka', price: 900_000, global: true, min }), /Bağ hediyesi global olamaz/);
  assert.equal(gift.globalProblem({ id: 'koruma', price: 900_000, global: true, min }), 'Koruma Kartı global olamaz');
  // The list's note.
  assert.equal(gift.globalNote({ global: true, price: 100_000 }, min), 'duyurulmuyor: fiyat sınırın altında');
  assert.equal(gift.globalNote({ global: true, price: 300_000 }, min), null);
  assert.equal(gift.globalNote({ global: false, price: 1 }, min), null);
  assert.equal(gift.globalNote({ global: true, price: 1 }, undefined), null);
});

test('Profil izi alanları: yok / bırakır (tür, süre) / temizler (tür); yalnız değişen gönderilir', () => {
  assert.deepEqual(gift.markOf({ role: 'none', kind: '', hours: '' }), { mark: null });
  assert.deepEqual(gift.markOf({ role: 'leave', kind: ' Kaka ', hours: '' }), { mark: { role: 'leave', kind: 'kaka' } });
  assert.deepEqual(gift.markOf({ role: 'leave', kind: 'camur', hours: '12' }), { mark: { role: 'leave', kind: 'camur', hours: 12 } });
  assert.deepEqual(gift.markOf({ role: 'clean', kind: 'kaka', hours: '5' }), { mark: { role: 'clean', kind: 'kaka' } });
  for (const hours of ['0', '169', '1.5']) assert.match(gift.markOf({ role: 'leave', kind: 'kaka', hours }).error, /1–168 saat/, hours);
  for (const kind of ['', 'çamur', '1kaka', 'kaka kaka', 'x'.repeat(25)]) assert.match(gift.markOf({ role: 'clean', kind, hours: '' }).error, /İz türü/, kind);
  assert.deepEqual(gift.markForm({ role: 'leave', kind: 'kaka', hours: null }), { role: 'leave', kind: 'kaka', hours: '' });
  assert.deepEqual(gift.markForm({ role: 'clean', kind: 'kaka', hours: null }), { role: 'clean', kind: 'kaka', hours: '' });
  assert.deepEqual(gift.markForm(null), { role: 'none', kind: '', hours: '' });
  assert.equal(gift.markText({ role: 'leave', kind: 'kaka', hours: 24 }), 'İz bırakır (kaka, 24 saat)');
  assert.equal(gift.markText({ role: 'clean', kind: 'kaka', hours: null }), 'İz temizler (kaka)');
  assert.equal(gift.markText(null), null);
  // A new gift sends both; one that exists only what changed (Kaka's rule as in the app: nothing).
  assert.deepEqual(gift.extraFields(undefined, { global: true, mark: null }), { global: true, mark: null });
  const kaka = { id: 'k1', global: false, mark: { role: 'leave', kind: 'kaka', hours: null } };
  assert.deepEqual(gift.extraFields(kaka, { global: false, mark: { role: 'leave', kind: 'kaka' } }), {});
  assert.deepEqual(gift.extraFields(kaka, { global: false, mark: { role: 'leave', kind: 'kaka', hours: 6 } }), { mark: { role: 'leave', kind: 'kaka', hours: 6 } });
  assert.deepEqual(gift.extraFields(kaka, { global: false, mark: null }), { mark: null });
  assert.deepEqual(gift.extraFields({ id: 'a1', global: true, mark: null }, { global: false, mark: null }), { global: false });
  assert.deepEqual(gift.extraFields({ id: 'a1', global: false, mark: null }, { global: true, mark: null }), { global: true });
  assert.equal(gift.plainOnly('bag-cift'), true);
  assert.equal(gift.plainOnly('koruma'), true);
  assert.equal(gift.plainOnly('k1'), false);
});
