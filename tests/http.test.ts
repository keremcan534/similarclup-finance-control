import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import type { AddressInfo } from 'node:net';

import { createApp } from '../server/app.ts';
import { verifyAuditChain } from '../server/context.ts';
import { openDb } from '../server/db.ts';
import { PASSWORD, fixture, setup } from './helpers.ts';

const env = setup();
const f = fixture(env.db);
const dataDir = mkdtempSync(join(tmpdir(), 'fc-test-'));
const server = createApp(env.db, { dataDir, dbPath: ':memory:', cookieSecure: false }, () => new Date('2026-10-15T12:00:00.000Z'));
let base = '';

before(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}
async function loginAs(email: string) {
  const r = await call('POST', '/api/auth/login', { email, password: PASSWORD });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return { authorization: `Bearer ${r.json.token}` };
}

test('authentication is required and wrong passwords are rejected', async () => {
  assert.equal((await call('GET', '/api/dashboard')).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { email: 'admin@test.local', password: 'nope-nope-nope' })).status, 401);
  const h = await loginAs('admin@test.local');
  const me = await call('GET', '/api/auth/me', undefined, h);
  assert.equal(me.json.user.role, 'super_admin');
  assert.equal((await call('POST', '/api/agencies', 'x' as any, { ...h })).status, 400);
});

test('agency managers only see their own agency', async () => {
  env.as('agency_manager', 'ajans@test.local', f.agency);
  const h = await loginAs('ajans@test.local');
  const list = await call('GET', '/api/agencies', undefined, h);
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.rows.map((r: any) => r.id), [f.agency]);
  assert.equal((await call('GET', `/api/parties/agency/${f.agency2}/finance`, undefined, h)).status, 403);
  assert.equal((await call('GET', `/api/parties/agency/${f.agency}/finance`, undefined, h)).status, 200);
  assert.equal((await call('GET', '/api/dashboard', undefined, h)).status, 403);
  assert.equal((await call('GET', '/api/bds', undefined, h)).status, 403);
  assert.equal((await call('POST', '/api/agencies', { code: 'X', name: 'X' }, h)).status, 403);
  const pubs = await call('GET', '/api/publishers', undefined, h);
  assert.ok(pubs.json.rows.every((p: any) => p.agency_id === f.agency));
});

test('read-only users cannot change anything', async () => {
  env.as('read_only', 'ro@test.local');
  const h = await loginAs('ro@test.local');
  assert.equal((await call('GET', '/api/dashboard', undefined, h)).status, 200);
  assert.equal((await call('POST', '/api/ledger/events', { type: 'purchase' }, h)).status, 403);
  assert.equal((await call('POST', '/api/rules', {}, h)).status, 403);
});

test('integration API key ingests events idempotently, also under concurrent retries', async () => {
  const h = await loginAs('admin@test.local');
  const key = await call('POST', '/api/integrations/1/key', {}, h);
  assert.match(key.json.key, /^fc_[0-9a-f]{8}_/);
  const event = { type: 'purchase', idempotency_key: 'api-1', occurred_at: '2026-10-15T10:00:00Z', user_ref: 'z', channel: 'google', amount: '50.00', currency: 'TRY', coins: 500 };
  assert.equal((await call('POST', '/api/ingest/events', { events: [event] })).status, 401);
  assert.equal((await call('POST', '/api/ingest/events', { events: [event] }, { 'x-api-key': 'fc_00000000_wrong' })).status, 401);
  const results = await Promise.all(Array.from({ length: 6 }, () => call('POST', '/api/ingest/events', { events: [event] }, { 'x-api-key': key.json.key })));
  const statuses = results.map((r) => r.json.results[0].status).sort();
  assert.deepEqual(statuses, ['created', 'duplicate', 'duplicate', 'duplicate', 'duplicate', 'duplicate']);
  assert.equal(env.db.value("SELECT COUNT(*) FROM financial_transactions WHERE idempotency_key = 'api-1'"), 1);
  const integ = await call('GET', '/api/integrations', undefined, h);
  assert.equal(integ.json.rows[0].status, 'connected');
  assert.ok(!JSON.stringify(integ.json).includes(key.json.key.slice(12)), 'API anahtarı açık metin dönmemeli');
});

test('dashboard drill-down, CSV export and audit chain', async () => {
  const h = await loginAs('admin@test.local');
  const d = await call('GET', '/api/dashboard?from=2026-10-01&to=2026-10-31', undefined, h);
  assert.equal(d.status, 200);
  assert.equal(d.json.totals.gross_sales, '5000');
  const rows = await call('GET', '/api/dashboard/drill?metric=gross_sales&from=2026-10-01&to=2026-10-31', undefined, h);
  assert.equal(rows.json.rows.length, 1);
  const csv = await call('GET', '/api/reports/pnl?from=2026-10-01&to=2026-10-31&format=csv', undefined, h);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type')!, /text\/csv/);
  assert.match(String(csv.json), /revenue.gross_sales/);
  assert.deepEqual((await call('GET', '/api/audit/verify', undefined, h)).json.ok, true);
});

test('no-login mode acts as super admin for the browser but not for API keys', async () => {
  const local = createApp(env.db, { dataDir, dbPath: ':memory:', cookieSecure: false, noLogin: true });
  await new Promise<void>((r) => local.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(local.address() as AddressInfo).port}`;
  try {
    const me = await (await fetch(`${url}/api/auth/me`)).json();
    assert.equal(me.user.role, 'super_admin');
    assert.equal((await (await fetch(`${url}/api/meta`)).json()).no_login, true);
    const ingest = await fetch(`${url}/api/ingest/events`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'fc_00000000_wrong' }, body: '{"events":[]}' });
    assert.equal(ingest.status, 401);
  } finally {
    local.close();
  }
});

test('backup produces a restorable database', async () => {
  const h = await loginAs('admin@test.local');
  const b = await call('POST', '/api/admin/backup', {}, h);
  assert.equal(b.status, 200, JSON.stringify(b.json));
  const copy = openDb(b.json.file);
  assert.equal(copy.value('SELECT COUNT(*) FROM financial_transactions'), env.db.value('SELECT COUNT(*) FROM financial_transactions'));
  assert.equal(verifyAuditChain(copy).ok, true);
  copy.close();
});
