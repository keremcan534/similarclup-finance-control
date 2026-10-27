import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decide, requestAction } from '../server/domain/governance.ts';
import { ingestEvent } from '../server/domain/ledger.ts';
import { createLuckyVersion, drawLucky, luckyAnalysis, validateOdds } from '../server/domain/lucky.ts';
import { fixture, setup } from './helpers.ts';

const ODDS = [
  { multiplier: '0', probability: '0.6' },
  { multiplier: '1', probability: '0.3' },
  { multiplier: '5', probability: '0.1' },
];

function prepare() {
  const env = setup();
  fixture(env.db);
  const v = createLuckyVersion(env.ctx, 'CLOVER', { name: 'Yonca', gift_cost_coins: 100, odds: ODDS, max_reward_coins: 400, total_budget_coins: 1000, reserve_coins: 800 });
  const req = requestAction(env.ctx, 'lucky.activate', 'lucky_gift_config_versions', v.id, { version_id: v.id }, 'test');
  decide(env.as('super_admin', 'admin2@test.local'), req.approval_id!, true, null);
  return env;
}

const ev = (key: string, random: string, mult: string, reward: number) => ({ type: 'lucky', idempotency_key: key, occurred_at: '2026-10-15T12:00:00Z', config_code: 'CLOVER', user_ref: 'u9', publisher_ref: 'u100', spent_coins: 100, random_value: random, multiplier: mult, reward_coins: reward });

test('odds must sum to exactly 1 and be valid', () => {
  assert.throws(() => validateOdds([{ multiplier: '1', probability: '0.5' }]), /geçersiz/);
  assert.throws(() => validateOdds([{ multiplier: '1', probability: '1.5' }]));
  assert.throws(() => validateOdds([...ODDS, { multiplier: '1', probability: '0' }]));
  assert.equal(validateOdds(ODDS).length, 3);
});

test('recorded results are checked against the table version; caps apply', () => {
  const { db, ctx } = prepare();
  assert.equal(ingestEvent(ctx, ev('l1', '0.65', '1', 100), 'api').status, 'created');
  assert.match(ingestEvent(ctx, ev('l2', '0.65', '5', 500), 'api').error!, /karşılık gelmiyor/);
  assert.match(ingestEvent(ctx, ev('l3', '0.95', '5', 500), 'api').error!, /beklenen 400/); // max reward cap
  assert.equal(ingestEvent(ctx, ev('l3b', '0.95', '5', 400), 'api').status, 'created');
  assert.equal(ingestEvent(ctx, ev('l1', '0.65', '1', 100), 'api').status, 'duplicate');
  assert.equal(db.value("SELECT SUM(units) FROM wallet_transactions WHERE type IN ('lucky_spend','lucky_reward')"), -200 + 500);
  const a = luckyAnalysis(db, '2026-10-01', '2026-10-31T23:59:59Z')[0];
  assert.equal(a.draws, 2);
  assert.equal(a.expected_multiplier, '0.800000');
  assert.equal(a.reward_coins, 500);
  assert.equal(a.reserve_left, 500);
  assert.equal(a.reserve_warning, true); // 500 left < 800 reserve
});

test('server-side draw never exceeds the remaining budget', () => {
  const { ctx } = prepare();
  for (let i = 0; i < 50; i++) {
    const d = drawLucky(ctx, 'CLOVER', 'u9');
    assert.ok(d.reward_coins <= 400);
    const r = ingestEvent(ctx, { ...ev(`d${i}`, d.random_value, d.multiplier, d.reward_coins), capped_by: d.capped_by }, 'api');
    assert.equal(r.status, 'created', r.error);
  }
  // A lower reward without a stated limit is rejected.
  assert.match(ingestEvent(ctx, ev('x', '0.65', '1', 50), 'api').error!, /beklenen 100/);
  const paid = ctx.db.value<number>('SELECT SUM(reward_coins) FROM lucky_gift_results')!;
  assert.ok(paid <= 1000, `paid ${paid}`);
});
