import assert from 'node:assert/strict';
import { test } from 'node:test';

import { allocate, dec, divRound, fmt, minorToString, parseMinor, pctOf, toMinor } from '../server/lib/money.ts';
import { evaluate, validateFormula } from '../server/lib/formula.ts';

test('divRound applies every rounding mode', () => {
  assert.equal(divRound(5n, 2n, 'half_even'), 2n);
  assert.equal(divRound(7n, 2n, 'half_even'), 4n);
  assert.equal(divRound(5n, 2n, 'half_up'), 3n);
  assert.equal(divRound(5n, 2n, 'half_down'), 2n);
  assert.equal(divRound(-5n, 2n, 'half_up'), -3n);
  assert.equal(divRound(-5n, 2n, 'floor'), -3n);
  assert.equal(divRound(-5n, 2n, 'ceil'), -2n);
  assert.equal(divRound(1n, 3n, 'up'), 1n);
  assert.equal(divRound(2n, 3n, 'down'), 0n);
  assert.throws(() => divRound(1n, 0n));
});

test('decimal parsing is exact and strict', () => {
  assert.equal(fmt(dec('0.1') + dec('0.2')), '0.3');
  assert.equal(fmt(dec('-12.50')), '-12.5');
  assert.throws(() => dec('1e5'));
  assert.throws(() => dec('abc'));
  assert.throws(() => dec('0.1234567890123'));
  assert.equal(parseMinor('19.99', 2), 1999n);
  assert.throws(() => parseMinor('19.999', 2));
  assert.equal(minorToString(-1999n, 2), '-19.99');
  assert.equal(fmt(dec('2.345'), 2, 'half_even'), '2.34');
  assert.equal(fmt(dec('2.345'), 2, 'half_up'), '2.35');
});

test('percent and minor conversion', () => {
  assert.equal(toMinor(pctOf(dec('99.99'), dec('15')), 2), 1500n); // 14.9985 → 15.00
  assert.equal(toMinor(pctOf(dec('10.05'), dec('50')), 2, 'half_even'), 502n); // 5.025 → 5.02
  assert.equal(toMinor(pctOf(dec('10.05'), dec('50')), 2, 'half_up'), 503n);
});

test('allocate splits exactly', () => {
  const parts = allocate(1000n, [1n, 1n, 1n]);
  assert.deepEqual(parts, [334n, 333n, 333n]);
  assert.equal(allocate(-1001n, [2n, 1n]).reduce((s, x) => s + x, 0n), -1001n);
});

test('formula language: precedence, functions, safety', () => {
  const v = { a: dec('100'), b: dec('3') };
  assert.equal(fmt(evaluate('a + b * 2', v)), '106');
  assert.equal(fmt(evaluate('(a + b) * 2', v)), '206');
  assert.equal(fmt(evaluate('a / b', v), 4), '33.3333');
  assert.equal(fmt(evaluate('a * pct(15)', v)), '15');
  assert.equal(fmt(evaluate('if(a > 50, 1, 0)', v)), '1');
  assert.equal(fmt(evaluate('a > 50 ? min(a, 70) : 0', v)), '70');
  assert.equal(fmt(evaluate('if(b == 0, 0, a / 0)', { ...v, b: 0n })), '0'); // lazy if
  assert.equal(fmt(evaluate('tier(a, 0, 10, 50, 12, 200, 15)', v)), '12');
  assert.equal(fmt(evaluate('marginal(150, 0, 10, 100, 20)', v)), '20'); // 100×10% + 50×20%
  assert.equal(fmt(evaluate('round(10 / 3, 2)', v)), '3.33');
  assert.equal(fmt(evaluate('clamp(a, 0, 40)', v)), '40');
  assert.throws(() => evaluate('a / 0', v), /Sıfıra bölme/);
  assert.throws(() => evaluate('process.exit(1)', v));
  assert.throws(() => evaluate('constructor', v), /Tanımsız değişken/);
  const bad = validateFormula('a + unknown_var * foo(1)', ['a']);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.message.includes('foo')));
  assert.ok(bad.errors.some((e) => e.message.includes('unknown_var')));
  assert.equal(validateFormula('min(1)', []).ok, true);
  assert.equal(validateFormula('if(1, 2)', []).ok, false);
  assert.equal(validateFormula('1 +', []).ok, false);
});
