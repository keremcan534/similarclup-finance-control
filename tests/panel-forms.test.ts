// The Uygulama pages' form rules, apart from the pages (no browser): Şanslı hediye ayarı's odds editor and new package
// (web/lucky-odds.js), Hediyeler's Global hediye box and Profil izi fields (web/gift-fields.js) and its İz türleri
// (web/mark-kinds.js: a kind's form, its overlay checked in the browser, the list's warnings). What they check is what
// the app's server checks (its lucky-rules.mjs, global-gifts.mjs, profile-mark-rules.mjs, mark-kinds.mjs), so a save
// the page lets through isn't refused there for a reason the page could have said, and the body sent is what the app
// reads.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const odds: any = await import(new URL('../web/lucky-odds.js', import.meta.url).href);
const gift: any = await import(new URL('../web/gift-fields.js', import.meta.url).href);
const kinds: any = await import(new URL('../web/mark-kinds.js', import.meta.url).href);

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

test('Profil izi alanları: yok / bırakır (tür, süre dakika ya da saat) / temizler (tür); yalnız değişen gönderilir', () => {
  assert.deepEqual(gift.markOf({ role: 'none', kind: '', amount: '', unit: 'hours' }), { mark: null });
  assert.deepEqual(gift.markOf({ role: 'leave', kind: ' Kaka ', amount: '', unit: 'hours' }), { mark: { role: 'leave', kind: 'kaka' } });
  // The time goes to the app's server in minutes (5–10.080), typed in hours (1–168) or minutes.
  assert.deepEqual(gift.markOf({ role: 'leave', kind: 'kirik-cam', amount: '24', unit: 'hours' }), { mark: { role: 'leave', kind: 'kirik-cam', minutes: 1440 } });
  assert.deepEqual(gift.markOf({ role: 'leave', kind: 'kartopu', amount: '90', unit: 'minutes' }), { mark: { role: 'leave', kind: 'kartopu', minutes: 90 } });
  assert.deepEqual(gift.markOf({ role: 'leave', kind: 'kaka', amount: '10080', unit: 'minutes' }).mark.minutes, 10_080);
  assert.deepEqual(gift.markOf({ role: 'leave', kind: 'kaka', amount: '5', unit: 'minutes' }).mark.minutes, 5);
  assert.deepEqual(gift.markOf({ role: 'clean', kind: 'kaka', amount: '5', unit: 'hours' }), { mark: { role: 'clean', kind: 'kaka' } });
  for (const amount of ['4', '10081', '1.5', '-5', '9x']) assert.match(gift.markOf({ role: 'leave', kind: 'kaka', amount, unit: 'minutes' }).error, /İzin süresi 5–10\.080 dakika arasında bir tam sayı olmalı \(boş: türün ya da Canlı ayarlardaki süre\)/, amount);
  for (const amount of ['0', '169', '1,5']) assert.match(gift.markOf({ role: 'leave', kind: 'kaka', amount, unit: 'hours' }).error, /İzin süresi 1–168 saat/, amount);
  for (const kind of ['', 'çamur', '1kaka', 'kaka kaka', 'kirik_cam', 'x'.repeat(25)]) assert.match(gift.markOf({ role: 'clean', kind, amount: '' }).error, /İz türü/, kind);
  assert.match(gift.markOf({ role: 'evet', kind: 'kaka' }).error, /geçersiz/);
  // An app server before kinds: hours as it took them (a time in minutes only came from a server that has them).
  assert.deepEqual(gift.markOf({ role: 'leave', kind: 'camur', amount: '12', unit: 'hours' }, { legacy: true }), { mark: { role: 'leave', kind: 'camur', hours: 12 } });
  assert.deepEqual(gift.markOf({ role: 'leave', kind: 'camur', amount: '90', unit: 'minutes' }, { legacy: true }), { mark: { role: 'leave', kind: 'camur', minutes: 90 } });
  assert.match(gift.markOf({ role: 'leave', kind: 'camur', amount: '169', unit: 'hours' }, { legacy: true }).error, /1–168 saat arasında bir tam sayı olmalı \(boş: Canlı ayarlardaki süre\)/);
  // The form from a rule: whole hours in hours, anything else in minutes; an older server's hours too.
  assert.deepEqual(gift.markForm({ role: 'leave', kind: 'kaka', hours: null, minutes: null }), { role: 'leave', kind: 'kaka', amount: '', unit: 'hours' });
  assert.deepEqual(gift.markForm({ role: 'leave', kind: 'kirik-cam', hours: 24, minutes: 1440 }), { role: 'leave', kind: 'kirik-cam', amount: '24', unit: 'hours' });
  assert.deepEqual(gift.markForm({ role: 'leave', kind: 'kartopu', hours: 2, minutes: 90 }), { role: 'leave', kind: 'kartopu', amount: '90', unit: 'minutes' });
  assert.deepEqual(gift.markForm({ role: 'leave', kind: 'kaka', hours: 12 }), { role: 'leave', kind: 'kaka', amount: '12', unit: 'hours' });
  assert.deepEqual(gift.markForm({ role: 'clean', kind: 'kaka', hours: null, minutes: null }), { role: 'clean', kind: 'kaka', amount: '', unit: 'hours' });
  assert.deepEqual(gift.markForm(null), { role: 'none', kind: '', amount: '', unit: 'hours' });
  // Back and forth: what the form shows is what it sends.
  for (const m of [{ role: 'leave', kind: 'a', hours: 2, minutes: 90 }, { role: 'leave', kind: 'a', hours: 168, minutes: 10_080 }, { role: 'leave', kind: 'a', hours: 1, minutes: 5 }]) {
    assert.equal(gift.sameMark(gift.markOf(gift.markForm(m)).mark, m), true, JSON.stringify(m));
  }
  // Rules compared in minutes: 90 and 120 minutes are both "2 hours" rounded up, and not the same.
  assert.equal(gift.sameMark({ role: 'leave', kind: 'kaka', hours: 2, minutes: 90 }, { role: 'leave', kind: 'kaka', hours: 2, minutes: 120 }), false);
  assert.equal(gift.sameMark({ role: 'leave', kind: 'kaka', hours: 24 }, { role: 'leave', kind: 'kaka', minutes: 1440 }), true);
  assert.equal(gift.sameMark({ role: 'leave', kind: 'kaka', hours: null, minutes: null }, { role: 'leave', kind: 'kaka' }), true);
  assert.equal(gift.sameMark({ role: 'clean', kind: 'kaka', hours: null, minutes: null }, { role: 'clean', kind: 'kaka' }), true);
  assert.equal(gift.sameMark(null, undefined), true);
  assert.equal(gift.sameMark({ role: 'leave', kind: 'kaka' }, { role: 'clean', kind: 'kaka' }), false);
  // In words, the kind by its name when İz türleri is read.
  const kinds = [
    { kind: 'kaka', name: 'Kaka İzi', minutes: null, enabled: true },
    { kind: 'kirik-cam', name: 'Kırık Cam', minutes: 60, enabled: true },
  ];
  assert.equal(gift.markText({ role: 'leave', kind: 'kaka', hours: 24 }), 'İz bırakır (kaka, 24 saat)');
  assert.equal(gift.markText({ role: 'leave', kind: 'kirik-cam', hours: 24, minutes: 1440 }, kinds), 'İz bırakır (Kırık Cam, 24 saat)');
  assert.equal(gift.markText({ role: 'leave', kind: 'kartopu', hours: 2, minutes: 90 }, kinds), 'İz bırakır (kartopu, 1 saat 30 dakika)');
  assert.equal(gift.markText({ role: 'leave', kind: 'kirik-cam', hours: null, minutes: null }, kinds), 'İz bırakır (Kırık Cam, türün süresi: 1 saat)');
  assert.equal(gift.markText({ role: 'leave', kind: 'kaka', hours: null, minutes: null }, kinds), 'İz bırakır (Kaka İzi, Canlı ayardaki süre)');
  assert.equal(gift.markText({ role: 'clean', kind: 'kirik-cam', hours: null }, kinds), 'İz temizler (Kırık Cam)');
  assert.equal(gift.markText(null), null);
  assert.deepEqual([45, 60, 90, 1440, 2880, 10_080].map(gift.durationText), ['45 dakika', '1 saat', '1 saat 30 dakika', '24 saat', '2 gün', '7 gün']);
  // A new gift sends both; one that exists only what changed (Kaka's rule as in the app, Terlik Geldi!'s 24 hours: nothing).
  assert.deepEqual(gift.extraFields(undefined, { global: true, mark: null }), { global: true, mark: null });
  const kaka = { id: 'k1', global: false, mark: { role: 'leave', kind: 'kaka', hours: null, minutes: null } };
  assert.deepEqual(gift.extraFields(kaka, { global: false, mark: { role: 'leave', kind: 'kaka' } }), {});
  assert.deepEqual(gift.extraFields(kaka, { global: false, mark: { role: 'leave', kind: 'kaka', minutes: 360 } }), { mark: { role: 'leave', kind: 'kaka', minutes: 360 } });
  assert.deepEqual(gift.extraFields(kaka, { global: false, mark: null }), { mark: null });
  const terlik = { id: 'p8', global: false, mark: { role: 'leave', kind: 'kirik-cam', hours: 24, minutes: 1440 } };
  assert.deepEqual(gift.extraFields(terlik, { global: false, mark: gift.markOf({ role: 'leave', kind: 'kirik-cam', amount: '24', unit: 'hours' }).mark }), {});
  assert.deepEqual(gift.extraFields(terlik, { global: false, mark: gift.markOf({ role: 'leave', kind: 'kirik-cam', amount: '1450', unit: 'minutes' }).mark }), { mark: { role: 'leave', kind: 'kirik-cam', minutes: 1450 } });
  assert.deepEqual(gift.extraFields({ id: 'a1', global: true, mark: null }, { global: false, mark: null }), { global: false });
  assert.deepEqual(gift.extraFields({ id: 'a1', global: false, mark: null }, { global: true, mark: null }), { global: true });
  assert.equal(gift.plainOnly('bag-cift'), true);
  assert.equal(gift.plainOnly('koruma'), true);
  assert.equal(gift.plainOnly('k1'), false);
});

test('raflar: Kutlama artık Muzip, İkili artık Çift; kimlikler aynı', () => {
  assert.deepEqual(gift.SHELVES.map(([id]: [string, string]) => id), ['hot', 'couple', 'family', 'gameplay', 'privilege']);
  const name = Object.fromEntries(gift.SHELVES);
  assert.equal(name.gameplay, 'Muzip');
  assert.equal(name.couple, 'Çift');
  assert.ok(!gift.SHELVES.some(([, n]: [string, string]) => n === 'Kutlama' || n === 'İkili'));
});

test('İz türü seçimi: listeden, kapalı tür uyarıyla; olmayan tür uygulamanın cümlesiyle; temizleyeni olmayan iz uyarılır', () => {
  const kinds = [
    { kind: 'kaka', name: 'Kaka İzi', minutes: null, enabled: true },
    { kind: 'kirik-cam', name: 'Kırık Cam', minutes: 1440, enabled: true },
    { kind: 'camur', name: 'Çamur', minutes: 60, enabled: false },
  ];
  assert.deepEqual(gift.kindOptions(kinds, 'kaka'), [
    { value: 'kaka', label: 'Kaka İzi (kaka)' },
    { value: 'kirik-cam', label: 'Kırık Cam (kirik-cam)' },
    { value: 'camur', label: 'Çamur (camur) · kapalı' },
  ]);
  // A rule naming a word the list lacks (a database edit): kept on top, said so; nothing else hidden.
  assert.deepEqual(gift.kindOptions(kinds, 'domates')[0], { value: 'domates', label: 'domates (İz türlerinde yok)' });
  assert.equal(gift.kindOptions(null, '').length, 0);
  // A changed rule must name a kind there is (the app refuses otherwise, in these words); none for "no rule" or no list.
  assert.equal(gift.unknownKind({ role: 'leave', kind: 'domates' }, kinds), `"domates" diye bir iz türü yok: önce Hediyeler › İz türleri'nden bu türü ekleyin`);
  assert.equal(gift.unknownKind({ role: 'clean', kind: 'camur' }, kinds), null);
  assert.equal(gift.unknownKind(null, kinds), null);
  assert.equal(gift.unknownKind({ role: 'leave', kind: 'domates' }, null), null);
  const gifts = [
    { id: 'k1', name: 'Kaka Şakası', enabled: true, mark: { role: 'leave', kind: 'kaka' } },
    { id: 'k2', name: 'Temizlik Suyu', enabled: true, mark: { role: 'clean', kind: 'kaka' } },
    { id: 'p8', name: 'Terlik Geldi!', enabled: true, mark: { role: 'leave', kind: 'kirik-cam', minutes: 1440 } },
    { id: 'a7', name: 'Cam Tamiri', enabled: false, mark: { role: 'clean', kind: 'kirik-cam' } },
  ];
  assert.deepEqual(gift.markWarnings({ role: 'leave', kind: 'kaka' }, { kinds, gifts, self: 'k1' }), []);
  // The cleaner is off the shelves: nobody can send it.
  assert.deepEqual(gift.markWarnings({ role: 'leave', kind: 'kirik-cam' }, { kinds, gifts, self: 'p8' }), ['Bu türü temizleyen hediye rafta değil (Cam Tamiri): kimse gönderemez.']);
  // Temizlik Suyu made to leave Kaka İzi: its own cleaning rule now doesn't count.
  assert.match(gift.markWarnings({ role: 'leave', kind: 'kaka' }, { kinds, gifts, self: 'k2' })[0], /^Bu türü temizleyen hediye yok: iz yalnız süresi bitince/);
  assert.match(gift.markWarnings({ role: 'leave', kind: 'kaka' }, { kinds, gifts: [], self: undefined })[0], /temizleyen hediye yok/);
  // A turned-off kind: the gift goes as a plain one.
  assert.match(gift.markWarnings({ role: 'clean', kind: 'camur' }, { kinds, gifts })[0], /^Bu tür kapalı: hediye düz hediye gibi gider/);
  assert.deepEqual(gift.markWarnings(null, { kinds, gifts }), []);
});

test('iz fiyat kuralı: temizleyen, bırakandan pahalı; uygulamanın cümlesi aynen', () => {
  const gifts = [
    { id: 'p8', name: 'Terlik Geldi!', price: 1299, mark: { role: 'leave', kind: 'kirik-cam' } },
    { id: 'a7', name: 'Cam Tamiri', price: 1299, mark: { role: 'clean', kind: 'kirik-cam' } },
    { id: 'k1', name: 'Kaka Şakası', price: 999, mark: { role: 'leave', kind: 'kaka' } },
    { id: 'k2', name: 'Temizlik Suyu', price: 1999, mark: { role: 'clean', kind: 'kaka' } },
    { id: 'g1', name: 'Gül', price: 10, mark: null },
  ];
  assert.equal(gift.markPriceProblem(gifts, 'a7'), 'Cam Tamiri izi temizlediği için onu bırakan hediyelerden pahalı olmalı: Terlik Geldi! 1.299 jeton, bu 1.299 jeton.');
  assert.equal(gift.markPriceProblem(gifts, 'p8'), 'Terlik Geldi! iz bıraktığı için onu temizleyen hediyelerden ucuz olmalı: Cam Tamiri 1.299 jeton, bu 1.299 jeton.');
  assert.equal(gift.markPriceProblem(gifts, 'k1'), null);
  assert.equal(gift.markPriceProblem(gifts, 'g1'), null);
  assert.equal(gift.markPriceProblem(gifts.map((g) => (g.id === 'a7' ? { ...g, price: 1300 } : g)), 'a7'), null);
  // A kind with only a leaving gift (Kar Topu): nothing to compare.
  assert.equal(gift.markPriceProblem([{ id: 'a3', name: 'Kar Topu', price: 299, mark: { role: 'leave', kind: 'kartopu' } }], 'a3'), null);
});

test('İz türleri: anahtar addan, form, kaydedilecek gövde (yalnız değişen), uygulamanın ret cümleleri', () => {
  assert.equal(kinds.kindsMissing({ status: 403 }), true);
  assert.equal(kinds.kindsMissing({ status: 404 }), true);
  assert.equal(kinds.kindsMissing({ status: 502 }), false);
  assert.equal(kinds.kindsMissing(null), false);
  assert.equal(kinds.keyFromName('Kırık Cam'), 'kirik-cam');
  assert.equal(kinds.keyFromName('Çamur Bombası'), 'camur-bombasi');
  assert.equal(kinds.keyFromName('Köpük Banyosu!'), 'kopuk-banyosu');
  assert.equal(kinds.keyFromName('  12 İz  '), 'iz');
  assert.equal(kinds.keyFromName('ŞIĞ ÜÖ'), 'sig-uo');
  for (const name of ['Çok Uzun Bir İz Türünün Adı Burada', 'a_b c', 'Kaka İzi', '!!!', '']) {
    const key = kinds.keyFromName(name);
    assert.ok(key === '' || gift.KIND.test(key), `${name} → ${key}`);
  }
  assert.deepEqual(kinds.kindForm(undefined), { kind: '', name: '', amount: '', unit: 'hours', stack: 'refresh', enabled: true });
  const camur = { kind: 'camur', name: 'Çamur', minutes: 90, stack: 'replace', enabled: false, art: null, gifts: [] };
  assert.deepEqual(kinds.kindForm(camur), { kind: 'camur', name: 'Çamur', amount: '90', unit: 'minutes', stack: 'replace', enabled: false });
  assert.deepEqual(kinds.kindForm({ ...camur, minutes: 1440, stack: 'x' }), { kind: 'camur', name: 'Çamur', amount: '24', unit: 'hours', stack: 'refresh', enabled: false });
  // A new kind: the whole body; time and the rest as the app takes them.
  const taken = [camur, { kind: 'kaka', name: 'Kaka İzi' }];
  assert.deepEqual(kinds.kindBody({ kind: 'kopuk', name: '  Köpük   Banyosu ', amount: '', unit: 'hours', stack: 'refresh', enabled: true }, undefined, { taken }), {
    body: { kind: 'kopuk', name: 'Köpük Banyosu', stack: 'refresh', enabled: true },
    changed: true,
  });
  assert.deepEqual(kinds.kindBody({ kind: 'kopuk', name: 'Köpük', amount: '2', unit: 'hours', stack: 'replace', enabled: false }, undefined, { taken }).body, { kind: 'kopuk', name: 'Köpük', minutes: 120, stack: 'replace', enabled: false });
  const no = (f: object, k?: object) => kinds.kindBody({ kind: 'kopuk', name: 'Köpük', amount: '', unit: 'hours', stack: 'refresh', enabled: true, ...f }, k, { taken }).error;
  // Capitals are made small, as the app does.
  assert.equal(kinds.kindBody({ kind: ' Kopuk ', name: 'Köpük', amount: '', unit: 'hours' }, undefined, { taken }).body.kind, 'kopuk');
  for (const kind of ['köpük', 'kopuk_banyo', '1kopuk', 'kopuk banyo', '']) assert.equal(no({ kind }), 'Tür anahtarı küçük harf, rakam ve tireyle kısa bir kelime olmalı (ör. kirik-cam, camur); boşluk ve alt çizgi olmaz', kind);
  for (const name of ['', '   ', 'x'.repeat(25), '<b>Köpük</b>']) assert.equal(no({ name }), 'İzin adı 1–24 harf olmalı (ör. Kırık Cam)', name);
  assert.equal(no({ kind: 'camur' }), '"camur" türü zaten var (Çamur); onu düzenleyin');
  assert.equal(no({ amount: '4', unit: 'minutes' }), 'Süre 5–10.080 dakika arasında bir tam sayı olmalı (boş: Canlı ayarlardaki süre)');
  assert.equal(no({ amount: '169', unit: 'hours' }), 'Süre 1–168 saat arasında bir tam sayı olmalı (boş: Canlı ayarlardaki süre)');
  // A change: its key and only what changed (a time taken off is null: the Canlı ayar's again); nothing changed: nothing to send.
  const same = kinds.kindBody(kinds.kindForm(camur), camur);
  assert.deepEqual(same, { body: { kind: 'camur' }, changed: false });
  assert.deepEqual(kinds.kindBody({ ...kinds.kindForm(camur), name: 'Çamur Topu', amount: '' }, camur), { body: { kind: 'camur', name: 'Çamur Topu', minutes: null }, changed: true });
  assert.deepEqual(kinds.kindBody({ ...kinds.kindForm(camur), stack: 'refresh', enabled: true }, camur).body, { kind: 'camur', stack: 'refresh', enabled: true });
  // The key of a kind being changed is never sent changed, nor checked as taken.
  assert.deepEqual(kinds.kindBody({ ...kinds.kindForm(camur), kind: 'baska' }, camur, { taken }), { body: { kind: 'camur' }, changed: false });
});

test('İz türleri listesi: süre, hediyeleri, uyarılar, silinebilirlik; telefonların çizdiği resim', () => {
  assert.equal(kinds.kindTime({ minutes: 1440 }, 24), '24 saat');
  assert.equal(kinds.kindTime({ minutes: null }, 24), 'Canlı ayar: 24 saat');
  assert.equal(kinds.kindTime({ minutes: null }, 0), 'Canlı ayar: kapalı');
  const cam = {
    kind: 'kirik-cam',
    name: 'Kırık Cam',
    enabled: true,
    art: { url: '/api/app/media/f/markart/u/x.png', checked: true },
    gifts: [
      { id: 'p8', name: 'Terlik Geldi!', role: 'leave', minutes: 1440, enabled: true },
      { id: 'a7', name: 'Cam Tamiri', role: 'clean', enabled: true },
    ],
  };
  const s = kinds.kindSummary(cam);
  assert.deepEqual([s.leave.map((g: { id: string }) => g.id), s.clean.map((g: { id: string }) => g.id), s.warn, s.deletable], [['p8'], ['a7'], [], false]);
  assert.deepEqual(kinds.kindSummary({ ...cam, gifts: [cam.gifts[0]] }).warn, ['Temizleyen hediye yok: iz yalnız süresi bitince ya da yönetim kaldırınca kalkar']);
  assert.deepEqual(kinds.kindSummary({ ...cam, gifts: [cam.gifts[0], { ...cam.gifts[1], enabled: false }] }).warn, ['Temizleyen hediye rafta değil: kimse temizleyemez']);
  assert.deepEqual(kinds.kindSummary({ ...cam, enabled: false }).warn, ['Kapalı: hediyeleri düz hediye gibi gider']);
  assert.deepEqual(kinds.kindSummary({ ...cam, gifts: [], art: { url: 'x', checked: false } }), { leave: [], clean: [], warn: ['Resim denetlenmedi: telefonlara gitmez'], deletable: true });
  // What phones draw: a checked overlay alone; else the app's own (Kaka İzi with its badge); else the badge.
  assert.deepEqual(kinds.layerOf(cam), { art: '/api/app/media/f/markart/u/x.png', compiled: null, badge: false, text: 'Yüklenen resim' });
  assert.deepEqual(kinds.layerOf({ kind: 'kaka', art: { url: 'x', checked: false } }), { art: null, compiled: 'kaka', badge: true, text: 'Uygulamanın kendi resmi' });
  assert.deepEqual(kinds.layerOf({ kind: 'kirik-cam', art: null }), { art: null, compiled: 'kirik-cam', badge: false, text: 'Uygulamanın kendi resmi' });
  assert.deepEqual(kinds.layerOf({ kind: 'kartopu', art: null }), { art: null, compiled: null, badge: true, text: 'Resim yok: hediyenin rozeti' });
  // The preview's faces are the app's (iz-onizleme.tsx: seats 30, 52, 96, 112; card 78; profile 96).
  assert.deepEqual(kinds.FACES.map((f: { size: number }) => f.size), [30, 52, 78, 96, 112]);
  assert.deepEqual(kinds.badgeBox(96), { size: 31, left: 60 - (31 / 96) * 50, top: 63 - (31 / 96) * 50 });
  assert.equal(kinds.badgeBox(30).size, 14);
  assert.equal(kinds.frameBox(96, 0.36), 133);
});

/** A PNG's first bytes: signature, IHDR (colour `type`), the chunks named, IDAT. */
function png(w: number, h: number, type: number, chunks: string[] = []) {
  const chunk = (name: string, data = Buffer.alloc(0)) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(name, 'latin1'), data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = type;
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), ...chunks.map((c) => chunk(c, Buffer.alloc(8))), chunk('IDAT', Buffer.alloc(10))]));
}
/** A WebP's first bytes: RIFF, WEBP, then a VP8X (flags), VP8L or VP8 header of w × h. */
function webp(kind: 'VP8X' | 'VP8L' | 'VP8 ', w: number, h: number, flags = 0) {
  const b = Buffer.alloc(40);
  b.write('RIFF', 0, 'latin1');
  b.write('WEBP', 8, 'latin1');
  b.write(kind, 12, 'latin1');
  if (kind === 'VP8X') {
    b[20] = flags;
    b.writeUIntLE(w - 1, 24, 3);
    b.writeUIntLE(h - 1, 27, 3);
  } else if (kind === 'VP8L') {
    b[20] = 0x2f;
    b.writeUInt32LE(((w - 1) | ((h - 1) << 14) | (flags << 28)) >>> 0, 21);
  } else {
    b.writeUIntBE(0x9d012a, 23, 3);
    b.writeUInt16LE(w, 26);
    b.writeUInt16LE(h, 28);
  }
  return new Uint8Array(b);
}

test('iz resmi tarayıcıda: başlık, saydamlık ve yüz payı uygulamanınki gibi ölçülür; ret cümleleri aynen', () => {
  assert.deepEqual(kinds.artInfo(png(512, 512, 6)), { type: 'png', width: 512, height: 512, alpha: true, animated: false });
  assert.deepEqual(kinds.artInfo(png(512, 512, 2)), { type: 'png', width: 512, height: 512, alpha: false, animated: false });
  assert.deepEqual(kinds.artInfo(png(300, 300, 3, ['tRNS'])), { type: 'png', width: 300, height: 300, alpha: true, animated: false });
  assert.deepEqual(kinds.artInfo(png(512, 512, 6, ['acTL'])).animated, true);
  assert.deepEqual(kinds.artInfo(webp('VP8X', 1024, 1024, 0x10)), { type: 'webp', width: 1024, height: 1024, alpha: true, animated: false });
  assert.deepEqual(kinds.artInfo(webp('VP8X', 512, 512, 0x12)), { type: 'webp', width: 512, height: 512, alpha: true, animated: true });
  assert.deepEqual(kinds.artInfo(webp('VP8L', 600, 600, 1)), { type: 'webp', width: 600, height: 600, alpha: true, animated: false });
  assert.deepEqual(kinds.artInfo(webp('VP8 ', 512, 512)), { type: 'webp', width: 512, height: 512, alpha: false, animated: false });
  assert.equal(kinds.artInfo(new Uint8Array(Buffer.from('GIF89a' + ' '.repeat(40)))), null);
  // The pixels: fully clear, a full disk over the face, a ring at the edges (Kırık Cam's cracks), as the checker counts them.
  const N = 100;
  const draw = (alphaAt: (x: number, y: number) => number) => {
    const px = new Uint8ClampedArray(N * N * 4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) px[(y * N + x) * 4 + 3] = alphaAt(x, y);
    return px;
  };
  const c = (N - 1) / 2;
  const r = (x: number, y: number) => Math.hypot(x - c, y - c);
  assert.deepEqual(kinds.artStats(draw(() => 0), N, N), { clear: 1, face: 0 });
  assert.deepEqual(kinds.artStats(draw(() => 255), N, N), { clear: 0, face: 1 });
  const disk = kinds.artStats(draw((x, y) => (r(x, y) <= 30 ? 255 : 0)), N, N);
  assert.equal(disk.face, 1);
  assert.ok(Math.abs(disk.clear - (1 - (Math.PI * 30 * 30) / (N * N))) < 0.01, String(disk.clear));
  const ring = kinds.artStats(draw((x, y) => (r(x, y) >= 40 ? 200 : 0)), N, N);
  assert.equal(ring.face, 0);
  // Half opaque or less doesn't cover the face (alpha 127), yet isn't clear either.
  assert.deepEqual(kinds.artStats(draw(() => 127), N, N), { clear: 0, face: 0 });
  // The app's sentences (profile-mark-rules.mjs markArtProblem), in its order.
  const ok = { type: 'png', width: 512, height: 512, alpha: true, animated: false };
  const problem = (x: object) => kinds.artProblem({ bytes: 1000, info: ok, stats: { clear: 0.5, face: 0.1 }, ...x });
  assert.equal(problem({}), null);
  assert.equal(problem({ stats: undefined }), null);
  assert.equal(problem({ bytes: 3 * 1024 * 1024 }), 'İz resmi en çok 2 MB olabilir (bu 3 MB)');
  assert.equal(problem({ info: null }), 'İz resmi PNG ya da WebP olmalı');
  assert.equal(problem({ info: { ...ok, animated: true } }), 'İz resmi hareketsiz olmalı: hareketli PNG ya da WebP değil, tek kare bir resim yükleyin');
  assert.equal(problem({ info: { ...ok, height: 400 } }), 'İz resmi kare olmalı (bu 512 × 400); 512 × 512 önerilir');
  assert.equal(problem({ info: { ...ok, width: 512, height: 515 } }), null);
  assert.equal(problem({ info: { ...ok, width: 200, height: 200 } }), 'İz resmi 256–2048 piksel olmalı (bu 200 × 200); 512 × 512 önerilir');
  assert.equal(problem({ info: { ...ok, alpha: false } }), 'İz resminde saydamlık yok: arka planı tam saydam (alfa 0) bir PNG ya da WebP yükleyin');
  assert.equal(problem({ stats: { clear: 0.2, face: 0 } }), "İz resminin en az %30'i tam saydam (alfa 0) olmalı, bunda %20: fotoğraf görünmez kalır. Arka planı silinmiş, kenarlarda çizim olan bir resim yükleyin");
  assert.equal(problem({ stats: { clear: 0.5, face: 0.64 } }), "İz resmi yüzü kapatıyor: ortadaki dairenin en çok %20'i dolu olabilir, bunda %64. Çizimi kenarlara alın, ortayı boş bırakın");
  // The app's limits, when it gives them, win over the page's own.
  assert.equal(kinds.artProblem({ bytes: 1000, info: ok, stats: { clear: 0.35, face: 0 } }, { ...kinds.LIMITS, clearMin: 0.4 }), "İz resminin en az %40'i tam saydam (alfa 0) olmalı, bunda %35: fotoğraf görünmez kalır. Arka planı silinmiş, kenarlarda çizim olan bir resim yükleyin");
  assert.equal(kinds.artLine({ px: 512, bytes: 69_156, stats: { clear: 0.78, face: 0 } }), '512 px · 68 KB · %78 saydam · yüz %0 dolu');
});
