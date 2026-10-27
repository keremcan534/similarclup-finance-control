import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addAdjustment, approveStatement, calculateStatement, recordPayout } from '../server/domain/statements.ts';
import { ingestEvent } from '../server/domain/ledger.ts';
import { fixture, giftRule, rule, setup } from './helpers.ts';

function prepare() {
  const env = setup('2026-11-02T09:00:00.000Z');
  const f = fixture(env.db);
  rule(env.ctx, 'PUB', giftRule({ type: 'publisher', from: 'tx_publisher' }, { type: 'percent', percent: '40' }), 'publisher');
  rule(
    env.ctx,
    'PUB_BONUS',
    { scope: 'period', party_type: 'publisher', measure: 'gift_coins', condition: 'gift_coins >= 1000', method: { type: 'fixed', amount: '100' }, currency: 'TRY', rounding: 'half_even', line_kind: 'bonus' },
    'publisher',
  );
  env.db.run(
    "INSERT INTO contracts (party_type, party_id, kind, currency, fixed_salary_minor, min_guarantee_minor, starts_on) VALUES ('publisher', ?, 'garanti', 'TRY', 100000, 150000, '2026-01-01')",
    f.pub,
  );
  ingestEvent(env.ctx, { type: 'gift', idempotency_key: 'g1', occurred_at: '2026-10-10T10:00:00Z', sender_ref: 'x', publisher_ref: 'u100', gift_ref: 'ROSE', coins: 1000 }, 'api');
  return { ...env, f };
}

test('statement: commission + period bonus + salary + minimum guarantee top-up', () => {
  const { ctx, f } = prepare();
  const s = calculateStatement(ctx, 'publisher', f.pub, '2026-10-01', '2026-10-31');
  assert.deepEqual(
    s.lines.map((l) => [l.kind, l.amount_minor]),
    [
      ['commission', 4000n],
      ['bonus', 10000n],
      ['salary', 100000n],
      ['min_guarantee_topup', 136000n], // 1500 − (40 + 100)
    ],
  );
  assert.equal(s.total_minor, 250000n);
});

test('salary is pro-rated when the contract starts mid-period', () => {
  const { ctx, db, f } = prepare();
  db.run("INSERT INTO contracts (party_type, party_id, kind, currency, fixed_salary_minor, starts_on) VALUES ('agency', ?, 'maaşlı', 'TRY', 310000, '2026-10-17')", f.agency);
  const s = calculateStatement(ctx, 'agency', f.agency, '2026-10-01', '2026-10-31');
  assert.equal(s.lines.find((l) => l.kind === 'salary')!.amount_minor, 150000n); // 15/31 days
});

test('approval needs a second person; payments are capped, idempotent, and freeze the statement', () => {
  const { ctx, db, as, f } = prepare();
  const s = calculateStatement(ctx, 'publisher', f.pub, '2026-10-01', '2026-10-31');
  assert.throws(() => approveStatement(ctx, s.id), /Görevler ayrılığı/);
  const fm = as('finance_manager', 'fm@test.local');
  approveStatement(fm, s.id, 'kontrol edildi');
  assert.throws(() => calculateStatement(ctx, 'publisher', f.pub, '2026-10-01', '2026-10-31'), /onaylanmış/);
  assert.throws(() => db.run('DELETE FROM statement_lines WHERE statement_id = ?', s.id), /silinemez/);
  assert.throws(() => recordPayout(fm, s.id, { amount_minor: 300000n, paid_on: '2026-11-02', method: 'havale', reference: null, idempotency_key: 'k0' }), /açık tutarı aşıyor/);
  const p1 = recordPayout(fm, s.id, { amount_minor: 100000n, paid_on: '2026-11-02', method: 'havale', reference: 'TR1', idempotency_key: 'k1' });
  assert.equal(p1.duplicate, false);
  assert.equal(recordPayout(fm, s.id, { amount_minor: 100000n, paid_on: '2026-11-02', method: 'havale', reference: 'TR1', idempotency_key: 'k1' }).duplicate, true);
  recordPayout(fm, s.id, { amount_minor: 150000n, paid_on: '2026-11-02', method: 'havale', reference: 'TR2', idempotency_key: 'k2' });
  const after = db.get('SELECT status, paid_minor FROM payout_statements WHERE id = ?', s.id)!;
  assert.deepEqual([after.status, after.paid_minor], ['paid', 250000]);
  assert.equal(db.value("SELECT SUM(amount_minor) FROM financial_transactions WHERE type = 'payout'"), -250000);
});

test('corrections after approval go to the next period as adjustments; negative balance carries over', () => {
  const { ctx, db, as, f } = prepare();
  db.run("UPDATE contracts SET status = 'cancelled'");
  const fm = as('finance_manager', 'fm@test.local');
  addAdjustment(ctx, { party_type: 'publisher', party_id: f.pub, amount_minor: -20000n, currency: 'TRY', kind: 'deduction', reason: 'İade sonrası düzeltme', booked_on: '2026-10-20' });
  const oct = calculateStatement(ctx, 'publisher', f.pub, '2026-10-01', '2026-10-31');
  assert.equal(oct.total_minor, 4000n + 10000n - 20000n);
  approveStatement(fm, oct.id);
  const nov = calculateStatement(ctx, 'publisher', f.pub, '2026-11-01', '2026-11-30');
  assert.deepEqual(nov.lines.map((l) => [l.kind, l.amount_minor]), [['carryover', -6000n]]);
});
