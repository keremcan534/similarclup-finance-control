// Demo data — clearly marked (settings.demo_data = 1, banner in the UI). Every rate and amount here is
// an EXAMPLE, not a real store fee, tax ruling or contract. Run only on an empty database:
//   npm run seed            (uses FC_DB_FILE / data/finance.db)

import { bootstrap, randomEmail, randomPassword, saveCredentials } from './bootstrap.ts';
import { loadUser, hashPassword } from './auth.ts';
import { config } from './config.ts';
import type { Ctx } from './context.ts';
import { openDb } from './db.ts';
import { ingestEvent } from './domain/ledger.ts';
import { createLuckyVersion, activateLuckyVersion, drawLucky } from './domain/lucky.ts';
import { approveStatement, calculateAll, recordPayout } from './domain/statements.ts';
import { generateRecurring, payExpense, reconcileInvoice } from './domain/costs.ts';
import { evaluateAlerts } from './domain/alerts.ts';

const cfg = config();
const db = openDb(cfg.dbPath);
if ((db.value<number>('SELECT COUNT(*) FROM financial_transactions') ?? 0) > 0 && !process.argv.includes('--force')) {
  console.error('Veritabanında zaten işlem var; demo verisi yalnız boş veritabanına yüklenir. (--force ile zorlanabilir)');
  process.exit(1);
}
// Every demo login gets a random email and password; they are written to data/giris-bilgileri.txt.
const creds: { role: string; email: string; password: string }[] = [];
const adminCred = { email: randomEmail('yonetici'), password: randomPassword() };
const created = bootstrap(db, adminCred);
if (created) creds.push({ role: 'Süper yönetici', ...created });
const now = new Date();
const day = (offset: number, hour = 12) => {
  const d = new Date(now.getTime() - offset * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.getTime() > now.getTime() ? new Date(now.getTime() - 60_000).toISOString() : d.toISOString();
};
const iso = (offset: number) => day(offset).slice(0, 10);
const thisMonth = now.toISOString().slice(0, 7);
const prevMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).toISOString().slice(0, 10);
const prevMonthStart = prevMonthEnd.slice(0, 7) + '-01';
const prevMonth = prevMonthEnd.slice(0, 7);
const twoMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1)).toISOString().slice(0, 10);

// Deterministic PRNG so the demo looks the same each time.
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];

const adminId = db.value<number>("SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.key = 'super_admin' ORDER BY u.id LIMIT 1")!;
const ctx: Ctx = { db, user: loadUser(db, adminId), integration: null, now: () => now };
const role = (k: string) => db.value<number>('SELECT id FROM roles WHERE key = ?', k)!;
const addUser = (prefix: string, name: string, roleKey: string, roleLabel: string, agency: number | null = null) => {
  const email = randomEmail(prefix);
  const password = randomPassword();
  creds.push({ role: roleLabel, email, password });
  return db.run('INSERT INTO users (email, name, password_hash, role_id, agency_id) VALUES (?,?,?,?,?)', email, name, hashPassword(password), role(roleKey), agency).id;
};
let fmId = 0;

db.tx(() => {
  db.run("INSERT INTO settings (key, value) VALUES ('demo_data', '1') ON CONFLICT(key) DO UPDATE SET value = '1'");
  // Reference data (examples).
  db.run("INSERT INTO exchange_rates (base, quote, rate, valid_from, source) VALUES ('USD', 'TRY', '41.20', ?, 'örnek'), ('EUR', 'TRY', '47.90', ?, 'örnek')", twoMonthsAgo, twoMonthsAgo);
  db.run("INSERT INTO unit_valuations (unit, currency, value_per_unit, purpose, valid_from, note) VALUES ('COIN', 'TRY', '0.10', 'revenue', ?, 'Örnek: 1.000 jeton paketi 100 TL')", twoMonthsAgo);
  db.run("INSERT INTO unit_valuations (unit, currency, value_per_unit, purpose, valid_from, note) VALUES ('COIN', 'TRY', '0.045', 'payout', ?, 'Örnek: jetonun ortalama yayıncı maliyeti')", twoMonthsAgo);
  db.run("INSERT INTO tax_configurations (name, applies_to, percent, inclusive, valid_from) VALUES ('KDV (örnek)', 'purchase', '20', 1, ?)", twoMonthsAgo);
  const ch = (code: string, name: string, kind: string, delay: number, pct: string, fixed: number, refund: number, cb: number) => {
    const id = db.run('INSERT INTO payment_channels (code, name, kind, settlement_delay_days) VALUES (?,?,?,?)', code, name, kind, delay).id;
    db.run("INSERT INTO channel_fee_versions (channel_id, percent, fixed_fee_minor, refund_fee_minor, chargeback_fee_minor, currency, condition_note, valid_from) VALUES (?,?,?,?,?, 'TRY', 'ÖRNEK oran — gerçek sözleşmeden girin', ?)", id, pct, fixed, refund, cb, twoMonthsAgo);
  };
  ch('google', 'Google Play', 'store', 30, '15', 0, 0, 0);
  ch('apple', 'Apple App Store', 'store', 45, '15', 0, 0, 0);
  ch('web', 'Web ödeme (kart)', 'card', 2, '2.49', 25, 500, 7500);

  // Parties.
  const bd1 = db.run("INSERT INTO business_developers (code, name, email) VALUES ('BD-AYSE', 'Ayşe Kaya', 'ayse@ornek.local')").id;
  const bd2 = db.run("INSERT INTO business_developers (code, name, email) VALUES ('BD-MERT', 'Mert Demir', 'mert@ornek.local')").id;
  const ag = [
    db.run("INSERT INTO agencies (code, name, contact_name, bd_id, created_at) VALUES ('STAR01', 'Yıldız Ajans', 'Selin Ak', ?, ?)", bd1, day(70)).id,
    db.run("INSERT INTO agencies (code, name, contact_name, bd_id, created_at) VALUES ('MOON22', 'Ay Işığı Medya', 'Can Er', ?, ?)", bd1, day(20)).id,
    db.run("INSERT INTO agencies (code, name, contact_name, bd_id, created_at) VALUES ('SIMI77', 'Simi Yayın', 'Deniz Su', ?, ?)", bd2, day(50)).id,
  ];
  const names = ['Deniz', 'Ece', 'Bora', 'Lale', 'Kerem', 'Nil', 'Arda', 'Mina', 'Efe', 'Zeynep', 'Umut', 'Ada'];
  names.forEach((n, i) => db.run('INSERT INTO publishers (external_id, name, agency_id) VALUES (?,?,?)', `u${100 + i}`, `${n} (demo)`, i < 10 ? ag[i % 3] : null));
  db.run("INSERT INTO contracts (party_type, party_id, kind, currency, fixed_salary_minor, min_guarantee_minor, starts_on, terms) VALUES ('bd', ?, 'maaş + komisyon', 'TRY', 3500000, 0, ?, '{\"not\":\"örnek\"}')", bd1, twoMonthsAgo);
  db.run("INSERT INTO contracts (party_type, party_id, kind, currency, fixed_salary_minor, min_guarantee_minor, starts_on) VALUES ('bd', ?, 'komisyon', 'TRY', 0, 0, ?)", bd2, twoMonthsAgo);
  db.run("INSERT INTO contracts (party_type, party_id, kind, currency, fixed_salary_minor, min_guarantee_minor, starts_on) VALUES ('publisher', 1, 'garanti', 'TRY', 0, 1500000, ?)", twoMonthsAgo);
  db.run("INSERT INTO contracts (party_type, party_id, kind, currency, fixed_salary_minor, min_guarantee_minor, starts_on) VALUES ('publisher', 2, 'maaşlı', 'TRY', 2000000, 0, ?)", twoMonthsAgo);
  for (const a of ag) db.run("INSERT INTO contracts (party_type, party_id, kind, currency, starts_on) VALUES ('agency', ?, 'standart', 'TRY', ?)", a, twoMonthsAgo);

  // Commission rules (examples). Stage 1 parallel on gift value; BD in stage 2 on what remains.
  const rule = (code: string, name: string, cat: string, c: object) => {
    const id = db.run('INSERT INTO commission_rules (code, name, category, description) VALUES (?,?,?,?)', code, name, cat, 'Demo kuralı — örnek oran').id;
    db.run("INSERT INTO commission_rule_versions (rule_id, version, config, valid_from, status, activated_by, activated_at) VALUES (?, 1, ?, ?, 'active', ?, ?)", id, JSON.stringify(c), twoMonthsAgo + 'T00:00:00.000Z', adminId, now.toISOString());
  };
  const base = { scope: 'transaction', tx_kind: 'wallet', currency: 'TRY', rounding: 'half_even', refund: 'reverse_proportional' };
  rule('PUB_GIFT', 'Yayıncı hediye payı', 'publisher', { ...base, tx_types: ['gift_receive', 'lucky_spend'], beneficiary: { type: 'publisher', from: 'tx_publisher' }, base: 'coin_value', method: { type: 'percent', percent: '40' }, stage: 1 });
  rule('PUB_CALL', 'Yayıncı arama payı', 'publisher', { ...base, tx_types: ['call_earning'], beneficiary: { type: 'publisher', from: 'tx_publisher' }, base: 'coin_value', method: { type: 'percent', percent: '50' }, stage: 1 });
  rule('AGENCY_STD', 'Ajans komisyonu', 'agency', { ...base, tx_types: ['gift_receive', 'call_earning', 'lucky_spend'], beneficiary: { type: 'agency', from: 'tx_agency' }, base: 'coin_value', method: { type: 'percent', percent: '10' }, stage: 1 });
  rule('BD_STD', 'BD komisyonu (kalan üzerinden)', 'bd', { ...base, tx_types: ['gift_receive', 'call_earning'], beneficiary: { type: 'bd', from: 'agency_bd' }, base: 'remaining', method: { type: 'percent', percent: '4' }, stage: 2 });
  rule('AGENCY_TIER', 'Ajans hedef primi', 'agency', { scope: 'period', party_type: 'agency', measure: 'eligible_revenue', method: { type: 'tiered', mode: 'whole', tiers: [{ from: '0', percent: '0' }, { from: '5000', percent: '2' }, { from: '20000', percent: '3' }] }, currency: 'TRY', rounding: 'half_even', line_kind: 'bonus' });
  rule('BD_NEW_AGENCY', 'BD yeni ajans primi', 'bd', { scope: 'period', party_type: 'bd', measure: 'new_agencies', method: { type: 'formula', expr: 'base * 2500' }, currency: 'TRY', rounding: 'half_even', line_kind: 'bonus' });

  // Technical services (examples).
  const prov = (code: string, name: string, cat: string) => db.run('INSERT INTO service_providers (code, name, category) VALUES (?,?,?)', code, name, cat).id;
  const tariff = (pid: number, service: string, unit: string, cur: string, fixed: number, incl: string, price: string, terms = 15) =>
    db.run('INSERT INTO cost_tariffs (provider_id, service, unit, currency, fixed_monthly_minor, included_quantity, unit_price, valid_from, payment_terms_days) VALUES (?,?,?,?,?,?,?,?,?)', pid, service, unit, cur, fixed, incl, price, twoMonthsAgo, terms);
  const hz = prov('HETZNER', 'Uygulama sunucuları (örnek)', 'Uygulama sunucuları');
  const pg = prov('PGCLOUD', 'Yönetilen veritabanı (örnek)', 'Veritabanı');
  const ag1 = prov('AGORA', 'Ses/video altyapısı (örnek)', 'Sesli oda altyapısı');
  const vid = prov('VIDEOAPI', 'Görüntülü görüşme (örnek)', 'Görüntülü görüşme');
  const cdn = prov('CDN', 'CDN ve depolama (örnek)', 'CDN ve veri transferi');
  const sms = prov('SMSGW', 'SMS doğrulama (örnek)', 'SMS ve doğrulama');
  tariff(hz, 'servers', 'ay', 'EUR', 32000, '0', '0');
  tariff(pg, 'database', 'ay', 'USD', 9900, '0', '0');
  tariff(ag1, 'voice_minutes', 'dakika', 'USD', 0, '10000', '0.00099');
  tariff(vid, 'video_minutes', 'dakika', 'USD', 0, '0', '0.0039');
  tariff(cdn, 'transfer_gb', 'GB', 'USD', 500, '100', '0.02');
  tariff(sms, 'sms', 'adet', 'TRY', 0, '0', '0.45');
  for (const [p, svc, q1, q2] of [[ag1, 'voice_minutes', '820000', '410000'], [vid, 'video_minutes', '61000', '33000'], [cdn, 'transfer_gb', '2400', '1150'], [sms, 'sms', '5200', '2300']] as [number, string, string, string][]) {
    db.run("INSERT INTO service_usage_records (idempotency_key, provider_id, service, period, quantity, source, note) VALUES (?,?,?,?,?, 'manual', 'demo')", `seed-${svc}-${prevMonth}`, p, svc, prevMonth, q1);
    db.run("INSERT INTO service_usage_records (idempotency_key, provider_id, service, period, quantity, source, note) VALUES (?,?,?,?,?, 'manual', 'demo — ay içi')", `seed-${svc}-${thisMonth}`, p, svc, thisMonth, q2);
  }
  db.run("INSERT INTO service_invoices (provider_id, period, invoice_no, currency, amount_minor, tax_minor, due_on) VALUES (?, ?, 'AG-1001', 'USD', 81300, 0, ?)", ag1, prevMonth, iso(-10));
  db.run("INSERT INTO service_invoices (provider_id, period, invoice_no, currency, amount_minor, tax_minor, due_on, paid_on) VALUES (?, ?, 'HZ-77', 'EUR', 32000, 0, ?, ?)", hz, prevMonth, iso(5), iso(6));

  // Catalog & PK.
  const item = (kind: string, code: string, name: string, price: number, license: number, prod: number, monthly: number, perUse: string, acquired?: string) =>
    db.run('INSERT INTO catalog_items (kind, code, name, provider, coin_price, currency, license_cost_minor, production_cost_minor, monthly_fee_minor, per_use_cost, acquired_on) VALUES (?,?,?,?,?,?,?,?,?,?,?)', kind, code, name, 'demo', price, 'TRY', license, prod, monthly, perUse, acquired ?? null);
  item('gift', 'ROSE', 'Gül', 10, 0, 0, 0, '0.001');
  item('gift', 'CAR', 'Spor araba (animasyon)', 2000, 0, 1500000, 0, '0.02', iso(25));
  item('gift', 'CROWN', 'Taç', 500, 250000, 0, 0, '0.005');
  item('game', 'LUDO', 'Ludo', 0, 0, 0, 450000, '0.01');
  item('game', 'SLOT', 'Casino slot (VIP2)', 0, 0, 0, 900000, '0.02');
  item('emoji', 'EMOJI_PACK1', 'Hareketli emoji paketi', 0, 120000, 0, 0, '0');
  db.run("INSERT INTO pk_events (code, name, kind, starts_at, ends_at, reward_type, reward_cost_minor, currency) VALUES ('PK-HAFTA', 'Haftalık takım PK', 'cross_room', ?, ?, 'Çerçeve + jeton', 350000, 'TRY')", day(9), day(8));

  // Expenses (examples), some recurring.
  const cat = (n: string) => db.value<number>('SELECT id FROM expense_categories WHERE name = ?', n)!;
  const exp = (c: string, desc: string, amt: number, tax: number, d: string, due: string | null, rec = 'none', status = 'unpaid', paid: string | null = null) =>
    db.run("INSERT INTO expense_records (category_id, description, nature, currency, amount_minor, tax_minor, tx_date, accrual_date, due_date, status, paid_on, recurrence, vendor) VALUES (?,?,?, 'TRY', ?,?,?,?,?,?,?,?, 'demo')", cat(c), desc, ['Reklam', 'Kullanıcı kazanımı', 'Moderasyon'].includes(c) ? 'variable' : 'fixed', amt, tax, d, d, due, status, paid, rec);
  exp('Yönetici maaşları', 'Yönetim ekibi maaşları', 18000000, 0, twoMonthsAgo, null, 'monthly');
  exp('Yazılım ve bakım', 'Yazılım geliştirme hizmeti', 9500000, 1900000, twoMonthsAgo, null, 'monthly');
  exp('Müşteri desteği', 'Destek ekibi', 4200000, 0, twoMonthsAgo, null, 'monthly');
  exp('Reklam', 'Sosyal medya kampanyası', 7500000, 1500000, iso(35), iso(25), 'none', 'paid', iso(26));
  exp('Kullanıcı kazanımı', 'Yükleme kampanyası', 5400000, 1080000, iso(12), iso(2));
  exp('Muhasebe ve hukuk', 'Mali müşavir', 1500000, 300000, iso(15), iso(-5));

  db.run("INSERT INTO cash_accounts (name, currency) VALUES ('Ana banka hesabı (demo)', 'TRY'), ('USD hesabı (demo)', 'USD')");
  db.run("INSERT INTO cash_snapshots (account_id, as_of, balance_minor) VALUES (1, ?, 185000000), (2, ?, 2500000)", iso(1), iso(1));
  db.run("INSERT INTO budgets (name, scope_type, period, currency, limit_minor) VALUES ('Aylık toplam gider bütçesi', 'total', ?, 'TRY', 60000000)", thisMonth);
  db.run("INSERT INTO alert_rules (kind, name, params, severity) VALUES ('min_cash', 'Minimum nakit 500.000 TL', '{\"limit\":\"500000\"}', 'critical'), ('budget_overrun', 'Bütçe aşımı', '{}', 'warning'), ('unusual_coin_movement', '250.000 jeton üzeri tek hareket', '{\"units\":\"250000\"}', 'warning'), ('max_pending_payouts', 'Bekleyen hakediş 750.000 TL üzeri', '{\"limit\":\"750000\"}', 'warning')");

  fmId = addUser('finans', 'Finans Yöneticisi (demo)', 'finance_manager', 'Finans yöneticisi');
  addUser('operasyon', 'Operasyon (demo)', 'operations_manager', 'Operasyon yöneticisi');
  addUser('ajans', 'Yıldız Ajans yöneticisi (demo)', 'agency_manager', 'Ajans yöneticisi', ag[0]);
  addUser('izleyici', 'Salt okunur (demo)', 'read_only', 'Salt okunur');
});

// Lucky Gift config (example odds; theoretical return 0.93).
const lv = createLuckyVersion(ctx, 'CLOVER', {
  name: 'Şans Yoncası (demo)',
  gift_cost_coins: 100,
  odds: [
    { multiplier: '0', probability: '0.62' },
    { multiplier: '1', probability: '0.25' },
    { multiplier: '2', probability: '0.08' },
    { multiplier: '5', probability: '0.04' },
    { multiplier: '10', probability: '0.0085' },
    { multiplier: '100', probability: '0.0015' },
  ],
  max_reward_coins: 10000,
  daily_reward_limit_coins: 300000,
  per_user_daily_limit_coins: 20000,
  total_budget_coins: 2000000,
  reserve_coins: 500000,
});
db.run("UPDATE lucky_gift_config_versions SET valid_from = ? WHERE id = ?", twoMonthsAgo + 'T00:00:00.000Z', lv.id);
activateLuckyVersion({ ...ctx, now: () => new Date(twoMonthsAgo + 'T00:00:00.000Z') }, lv.id);

// Events across the last ~55 days.
const users = Array.from({ length: 140 }, (_, i) => `user${1000 + i}`);
const publishers = Array.from({ length: 12 }, (_, i) => `u${100 + i}`);
const gifts: [string, number][] = [['ROSE', 10], ['ROSE', 10], ['CROWN', 500], ['CAR', 2000]];
const packs: [string, number, string][] = [['pack_100', 100, '10.00'], ['pack_1000', 1000, '99.99'], ['pack_5000', 5000, '449.99'], ['pack_20000', 20000, '1699.99']];
let n = 0;
const errors: string[] = [];
const ev = (e: any) => {
  const r = ingestEvent(ctx, e, 'csv');
  if (r.status === 'error') errors.push(`${e.idempotency_key}: ${r.error}`);
  return r;
};
for (let d = 55; d >= 0; d--) {
  const buyers = 4 + Math.floor(rnd() * 9) + Math.floor((55 - d) / 8);
  for (let b = 0; b < buyers; b++) {
    const [ref, coins, amount] = pick(packs.slice(0, rnd() < 0.08 ? 4 : 3));
    const ch = rnd() < 0.55 ? 'google' : rnd() < 0.7 ? 'apple' : 'web';
    const key = `ord-${++n}`;
    const user = pick(users);
    ev({ type: 'purchase', idempotency_key: key, occurred_at: day(d, 8 + (b % 12)), user_ref: user, channel: ch, amount, currency: 'TRY', coins, product_ref: ref });
    if (rnd() < 0.03) ev({ type: 'refund', idempotency_key: `ref-${n}`, original_key: key, occurred_at: day(Math.max(d - 1, 0), 22), reason: 'Kullanıcı talebi (demo)' });
    // Spend most of the coins as gifts, some on calls, games and Lucky.
    let left = coins;
    let g = 0;
    while (left >= 10 && g < 6) {
      const [gift, price] = pick(gifts.filter(([, p]) => p <= left));
      ev({ type: 'gift', idempotency_key: `gift-${n}-${g}`, occurred_at: day(d, 9 + (b % 12)), sender_ref: user, publisher_ref: pick(publishers), gift_ref: gift, coins: price, room_ref: `room${1 + (g % 5)}`, event_ref: d === 9 || d === 8 ? 'PK-HAFTA' : undefined });
      left -= price;
      g++;
    }
    if (rnd() < 0.25) ev({ type: 'call', idempotency_key: `call-${n}`, occurred_at: day(d, 20), user_ref: user, publisher_ref: pick(publishers.slice(0, 6)), kind: rnd() < 0.4 ? 'video' : 'voice', minutes: String(3 + Math.floor(rnd() * 25)), coins: 150 });
    if (rnd() < 0.2) ev({ type: 'game', idempotency_key: `game-${n}`, occurred_at: day(d, 21), user_ref: user, game_ref: pick(['LUDO', 'SLOT']), entry_coins: 50, payout_coins: rnd() < 0.4 ? 90 : 0 });
  }
  for (let l = 0; l < 6; l++) {
    // Draw with the platform's own engine, then record — the same path an integration uses.
    const at = day(d, 10 + l);
    const lctx = { ...ctx, now: () => new Date(at) };
    const player = pick(users);
    ev({ type: 'purchase', idempotency_key: `ord-lucky-${d}-${l}`, occurred_at: at, user_ref: player, channel: 'google', amount: '10.00', currency: 'TRY', coins: 100, product_ref: 'pack_100' });
    const r = drawLucky(lctx, 'CLOVER', player);
    ev({ type: 'lucky', idempotency_key: `lucky-${d}-${l}`, occurred_at: at, config_code: 'CLOVER', user_ref: player, publisher_ref: pick(publishers), spent_coins: 100, random_value: r.random_value, multiplier: r.multiplier, reward_coins: r.reward_coins, capped_by: r.capped_by });
  }
  if (d % 7 === 0) ev({ type: 'bonus_grant', idempotency_key: `bonus-${d}`, occurred_at: day(d, 7), user_ref: pick(users), coins: 200, campaign_ref: 'giris-odulu' });
}
// A gift to an unknown Similar Club id, to show the "unmapped publisher" handling.
ev({ type: 'gift', idempotency_key: 'gift-unmapped-1', occurred_at: day(2), sender_ref: 'user1001', publisher_ref: 'u999', gift_ref: 'ROSE', coins: 10 });

// Recurring expenses, invoice reconciliation, statements for the previous month.
generateRecurring(ctx, now.toISOString().slice(0, 10));
// Past months' recurring costs were paid on time in the demo story.
for (const e of db.all("SELECT id, accrual_date FROM expense_records WHERE status = 'unpaid' AND accrual_date < ?", thisMonth + '-01')) payExpense(ctx, e.id, e.accrual_date);
for (const inv of db.all('SELECT id FROM service_invoices')) reconcileInvoice(ctx, inv.id);
db.run("INSERT INTO periods (starts_on, ends_on) VALUES (?, ?)", prevMonthStart, prevMonthEnd);
const fmCtx: Ctx = { db, user: loadUser(db, fmId), integration: null, now: () => now };
for (const t of ['agency', 'bd', 'publisher'] as const) calculateAll(ctx, t, prevMonthStart, prevMonthEnd);
const stmts = db.all("SELECT id, total_minor FROM payout_statements WHERE status = 'calculated' ORDER BY id");
stmts.slice(0, Math.ceil(stmts.length * 0.7)).forEach((s) => s.total_minor >= 0 && approveStatement(fmCtx, s.id, 'Demo onayı'));
const approved = db.all("SELECT id, total_minor FROM payout_statements WHERE status = 'approved' AND total_minor > 0 ORDER BY id LIMIT 5");
for (const s of approved) recordPayout(ctx, s.id, { amount_minor: BigInt(s.total_minor), paid_on: now.toISOString().slice(0, 10), method: 'Banka havalesi', reference: `DEMO-${s.id}`, idempotency_key: `seed-pay-${s.id}` });
const alerts = evaluateAlerts(ctx);

console.log(`Demo verisi yüklendi: ${db.value('SELECT COUNT(*) FROM financial_transactions')} para, ${db.value('SELECT COUNT(*) FROM wallet_transactions')} jeton hareketi, ${db.value('SELECT COUNT(*) FROM commission_allocations')} komisyon kaydı, ${db.value('SELECT COUNT(*) FROM payout_statements')} hakediş, ${alerts.created} uyarı.`);
if (errors.length) console.log(`${errors.length} olay reddedildi (beklenen kontroller dahil):\n  ` + errors.slice(0, 10).join('\n  '));
console.log(`Rastgele giriş bilgileri: ${saveCredentials(cfg.dataDir, creds)}${created ? '' : ' (mevcut yönetici değişmedi)'}`);
db.close();
