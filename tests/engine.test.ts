import assert from 'node:assert/strict';
import { test } from 'node:test';

import { audit } from '../server/context.ts';
import { previewRule, validateRuleConfig, findConflicts, retryIssues } from '../server/domain/commission.ts';
import { decide, requestRuleActivation } from '../server/domain/governance.ts';
import { ingestEvent, reverseTransaction } from '../server/domain/ledger.ts';
import { summary } from '../server/domain/reports.ts';
import { fixture, giftRule, rule, setup } from './helpers.ts';

const purchase = (key: string, amount = '120.00', extra = {}) => ({ type: 'purchase', idempotency_key: key, occurred_at: '2026-10-15T10:00:00Z', user_ref: 'buyer1', channel: 'google', amount, currency: 'TRY', coins: 1000, ...extra });
const gift = (key: string, coins = 1000, at = '2026-10-15T10:00:00Z', publisher = 'u100') => ({ type: 'gift', idempotency_key: key, occurred_at: at, sender_ref: 'buyer1', publisher_ref: publisher, gift_ref: 'ROSE', coins });

function allocs(db: any, txKey: string) {
  return db.all(
    `SELECT r.code, a.direction, a.amount_minor, a.base_minor, a.beneficiary_type, a.beneficiary_id, v.version FROM commission_allocations a
       JOIN commission_rule_versions v ON v.id = a.rule_version_id JOIN commission_rules r ON r.id = v.rule_id
       JOIN wallet_transactions w ON a.tx_kind = 'wallet' AND w.id = a.tx_id WHERE w.idempotency_key = ? ORDER BY a.stage, r.code`,
    txKey,
  );
}

test('purchase: tax, channel fee and net are frozen on the row; idempotent', () => {
  const { db, ctx } = setup();
  fixture(db);
  const r = ingestEvent(ctx, purchase('p1'), 'api');
  assert.equal(r.status, 'created');
  const t = db.get("SELECT * FROM financial_transactions WHERE idempotency_key = 'p1'")!;
  assert.equal(t.amount_minor, 12000);
  assert.equal(t.tax_minor, 2000); // 120 × 20/120
  assert.equal(t.fee_minor, 1800); // 15% of gross
  assert.equal(t.net_minor, 8200);
  assert.equal(db.value("SELECT units FROM wallet_transactions WHERE idempotency_key = 'p1:coins'"), 1000);
  assert.equal(ingestEvent(ctx, purchase('p1'), 'api').status, 'duplicate');
  const changed = ingestEvent(ctx, purchase('p1', '99.00'), 'api');
  assert.equal(changed.status, 'error');
  assert.match(changed.error!, /farklı içerikle/);
  assert.equal(db.value('SELECT COUNT(*) FROM financial_transactions'), 1);
});

test('gift: parallel stage, sequential stage on remaining, beneficiaries resolved', () => {
  const { db, ctx } = setup();
  const f = fixture(db);
  rule(ctx, 'PUB', giftRule({ type: 'publisher', from: 'tx_publisher' }, { type: 'percent', percent: '40' }), 'publisher');
  rule(ctx, 'AG', giftRule({ type: 'agency', from: 'tx_agency' }, { type: 'percent', percent: '10' }));
  rule(ctx, 'BD', giftRule({ type: 'bd', from: 'agency_bd' }, { type: 'percent', percent: '20' }, { base: 'remaining', stage: 2 }), 'bd');
  assert.equal(ingestEvent(ctx, gift('g1'), 'api').status, 'created');
  const a = allocs(db, 'g1:recv');
  assert.deepEqual(
    a.map((x: any) => [x.code, x.amount_minor, x.beneficiary_type, x.beneficiary_id]),
    [
      ['AG', 1000, 'agency', f.agency],
      ['PUB', 4000, 'publisher', f.pub],
      ['BD', 1000, 'bd', f.bd], // 20% of (100 − 50)
    ],
  );
  // Second publisher's agency has no BD → BD rule skipped, not failed.
  ingestEvent(ctx, gift('g2', 500, '2026-10-15T10:00:00Z', 'u200'), 'api');
  assert.deepEqual(allocs(db, 'g2:recv').map((x: any) => x.code), ['AG', 'PUB']);
  // Duplicate gift creates nothing new.
  assert.equal(ingestEvent(ctx, gift('g1'), 'api').status, 'duplicate');
  assert.equal(allocs(db, 'g1:recv').length, 3);
});

test('over-distribution blocks the whole chain and raises an issue', () => {
  const { db, ctx } = setup();
  fixture(db);
  rule(ctx, 'PUB', giftRule({ type: 'publisher', from: 'tx_publisher' }, { type: 'percent', percent: '60' }));
  rule(ctx, 'AG', giftRule({ type: 'agency', from: 'tx_agency' }, { type: 'percent', percent: '50' }));
  ingestEvent(ctx, gift('g1'), 'api');
  assert.equal(allocs(db, 'g1:recv').length, 0);
  const issue = db.get("SELECT * FROM calculation_issues WHERE status = 'open'")!;
  assert.equal(issue.kind, 'over_distribution');
  // Fix the rule (retire AG) then retry → allocations appear, issue resolved.
  db.run("UPDATE commission_rule_versions SET status = 'retired', valid_to = '2026-01-02T00:00:00.000Z' WHERE rule_id = (SELECT id FROM commission_rules WHERE code = 'AG')");
  assert.deepEqual(retryIssues(ctx), { retried: 1, resolved: 1 });
  assert.equal(allocs(db, 'g1:recv').length, 1);
});

test('new rule version applies forward only; history keeps the old version', () => {
  const { db, ctx, as, setNow } = setup('2026-10-15T11:00:00.000Z');
  fixture(db);
  const ag = rule(ctx, 'AG', giftRule({ type: 'agency', from: 'tx_agency' }, { type: 'percent', percent: '10' }));
  ingestEvent(ctx, gift('before'), 'api');
  const v2 = db.run("INSERT INTO commission_rule_versions (rule_id, version, config, valid_from, status) VALUES (?, 2, ?, '2026-10-15T00:00:00.000Z', 'draft')", ag.id, JSON.stringify(giftRule({ type: 'agency', from: 'tx_agency' }, { type: 'percent', percent: '15' }))).id;
  setNow('2026-10-15T12:00:00.000Z');
  const req = requestRuleActivation(ctx, v2, null);
  assert.equal(req.status, 'pending'); // dual control on by default
  assert.throws(() => decide(ctx, req.approval_id!, true, null), /kendi talebinizi/);
  decide(as('finance_manager', 'fm@test.local'), req.approval_id!, true, 'ok');
  setNow('2026-10-15T13:00:00.000Z');
  ingestEvent(ctx, gift('after', 1000, '2026-10-15T12:30:00Z'), 'api');
  assert.deepEqual(allocs(db, 'before:recv').map((x: any) => [x.version, x.amount_minor]), [[1, 1000]]);
  assert.deepEqual(allocs(db, 'after:recv').map((x: any) => [x.version, x.amount_minor]), [[2, 1500]]);
  assert.throws(() => db.run("UPDATE commission_rule_versions SET config = '{}' WHERE id = ?", v2), /değiştirilemez/);
  assert.throws(() => requestRuleActivation(ctx, db.run("INSERT INTO commission_rule_versions (rule_id, version, config, valid_from, status) VALUES (?, 3, '{}', '2026-10-15', 'draft')", ag.id).id, '2026-10-01T00:00:00.000Z'), /geriye dönük/);
});

test('partial refund: proportional commission reversal, refund fee, coin reversal, cap', () => {
  const { db, ctx } = setup();
  fixture(db);
  rule(ctx, 'AFF', { scope: 'transaction', tx_kind: 'financial', tx_types: ['purchase'], beneficiary: { type: 'other', name: 'Ortaklık' }, base: 'net_collected', method: { type: 'percent', percent: '5' }, currency: 'TRY', rounding: 'half_even', stage: 1, refund: 'reverse_proportional' }, 'other');
  ingestEvent(ctx, purchase('p1'), 'api');
  const r = ingestEvent(ctx, { type: 'refund', idempotency_key: 'r1', original_key: 'p1', amount: '60.00', occurred_at: '2026-10-15T11:00:00Z' }, 'api');
  assert.equal(r.status, 'created', r.error);
  const ref = db.get("SELECT * FROM financial_transactions WHERE idempotency_key = 'r1'")!;
  assert.deepEqual([ref.amount_minor, ref.tax_minor, ref.fee_minor, ref.net_minor], [-6000, -1000, 500, -5500]);
  const al = db.all("SELECT direction, amount_minor FROM commission_allocations ORDER BY id");
  assert.deepEqual(al.map((x) => [x.direction, x.amount_minor]), [['original', 410], ['reversal', -205]]);
  assert.equal(db.value("SELECT units FROM wallet_transactions WHERE idempotency_key = 'r1:coins'"), -500);
  const tooMuch = ingestEvent(ctx, { type: 'refund', idempotency_key: 'r2', original_key: 'p1', amount: '70.00', occurred_at: '2026-10-15T11:00:00Z' }, 'api');
  assert.match(tooMuch.error!, /kalan tutarı aşıyor/);
  // Full manual reversal of the rest goes through refund logic and reverses only what is left.
  reverseTransaction(ctx, 'financial', db.value("SELECT id FROM financial_transactions WHERE idempotency_key = 'p1'")!, 'Müşteri talebi');
  assert.equal(db.value('SELECT SUM(amount_minor) FROM commission_allocations'), 0);
});

test('ledger, allocations and audit log are append-only at the database level', () => {
  const { db, ctx } = setup();
  fixture(db);
  ingestEvent(ctx, purchase('p1'), 'api');
  audit(ctx, 'test', 'x', 1, null, { a: 1 });
  assert.throws(() => db.run('UPDATE financial_transactions SET amount_minor = 1'), /değiştirilemez/);
  assert.throws(() => db.run("UPDATE audit_logs SET actor = 'x'"), /değiştirilemez/);
  assert.throws(() => db.run('DELETE FROM wallet_transactions'), /silinemez/);
  assert.throws(() => db.run('DELETE FROM audit_logs'), /silinemez/);
});

test('methods: tiered whole/marginal, caps, per-unit, formula, currency conversion', () => {
  const { db } = setup();
  fixture(db);
  const sample = { units: 1000, value_currency: 'TRY', value_minor: 100000n, quantity: '30', agency_id: 1, publisher_id: 1 }; // 1000.00 TRY
  const run = (method: object, extra: object = {}) => {
    const cfg = validateRuleConfig(db, giftRule({ type: 'agency', from: 'tx_agency' }, method, extra));
    const r = previewRule(db, cfg, { ...sample, type: 'gift_receive' });
    assert.deepEqual(r.issues, []);
    return r.allocations[0]?.amount_minor ?? 0n;
  };
  assert.equal(run({ type: 'tiered', mode: 'whole', tiers: [{ from: '0', percent: '5' }, { from: '500', percent: '8' }] }), 8000n);
  assert.equal(run({ type: 'tiered', mode: 'marginal', tiers: [{ from: '0', percent: '5' }, { from: '500', percent: '8' }] }), 6500n); // 25 + 40
  assert.equal(run({ type: 'percent', percent: '10' }, { max: '50' }), 5000n);
  assert.equal(run({ type: 'percent', percent: '0.01' }, { min: '2.5' }), 250n);
  assert.equal(run({ type: 'per_unit', measure: 'quantity', price: '0.75' }), 2250n);
  assert.equal(run({ type: 'formula', expr: 'if(units >= 1000, base * pct(12), base * pct(8))' }), 12000n);
  assert.equal(run({ type: 'fixed', amount: '1' }, { currency: 'USD' }), 4000n); // 1 USD × 40
  assert.throws(() => validateRuleConfig(db, giftRule({ type: 'agency', from: 'tx_agency' }, { type: 'percent', percent: 'x' })), /geçersiz/);
  assert.throws(() => validateRuleConfig(db, giftRule({ type: 'agency', from: 'tx_publisher' }, { type: 'formula', expr: 'gross_amount * 2' })));
});

test('conflict detection flags a second commission to the same beneficiary', () => {
  const { db, ctx } = setup();
  fixture(db);
  rule(ctx, 'AG', giftRule({ type: 'agency', from: 'tx_agency' }, { type: 'percent', percent: '10' }));
  const cfg = validateRuleConfig(db, giftRule({ type: 'agency', from: 'tx_agency' }, { type: 'percent', percent: '5' }));
  assert.equal(findConflicts(db, cfg, null).length, 1);
});

test('missing exchange rate is reported, not treated as zero', () => {
  const { db, ctx } = setup();
  fixture(db);
  db.run("INSERT INTO payment_channels (code, name, kind) VALUES ('web', 'Web', 'web')");
  ingestEvent(ctx, purchase('eur1', '10.00', { currency: 'EUR', channel: 'web' }), 'api');
  const s = summary(db, '2026-10-01', '2026-10-31', '2026-10-15');
  assert.ok(s.data_quality.fx_gaps.some((g) => g.currency === 'EUR'));
  assert.equal(s.revenue.gross_sales, 0n);
});

test('late events for a closed period are booked into the next open day', () => {
  const { db, ctx } = setup();
  fixture(db);
  db.run("INSERT INTO periods (starts_on, ends_on, status) VALUES ('2026-09-01', '2026-09-30', 'closed')");
  ingestEvent(ctx, purchase('late', '10.00', { occurred_at: '2026-09-20T10:00:00Z' }), 'api');
  const t = db.get("SELECT occurred_at, booked_on FROM financial_transactions WHERE idempotency_key = 'late'")!;
  assert.equal(t.occurred_at, '2026-09-20T10:00:00.000Z');
  assert.equal(t.booked_on, '2026-10-01');
});
