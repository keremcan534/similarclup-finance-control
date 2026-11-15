// Uygulama pages (server/app-admin.ts) against a stand-in app API: the panel calls it with its key and names the
// signed-in user, only for users whose role has the page's permission; the app's file addresses come back as this
// server's; an upload streams through to the storage address the app gives; the app's own refusals come back as
// they are; without a link the pages say so. Existing roles get the new permission once (002_app_permissions.sql).
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import type { AddressInfo } from 'node:net';

import { appLink, localFiles } from '../server/app-admin.ts';
import { createApp } from '../server/app.ts';
import { PASSWORD, setup } from './helpers.ts';

const KEY = 'k'.repeat(64);
type Seen = { method: string; path: string; key: string | undefined; user: any; body: string; headers: IncomingMessage['headers'] };
const seen: Seen[] = [];
const stored = new Map<string, { body: Buffer; type: string; length: string | undefined; chunked: boolean }>();
const ICON = Buffer.from(Array.from({ length: 3000 }, (_, i) => i % 251));
let appBase = '';
let refuse: { status: number; error: string } | null = null;

// The stand-in app: its admin API (key checked), the storage's signed PUT, and its public files.
const fakeApp = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = Buffer.concat(chunks);
  const url = new URL(req.url ?? '/', 'http://x');
  const json = (status: number, data: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(data));
  if (req.method === 'PUT' && url.pathname.startsWith('/bucket/')) {
    stored.set(url.pathname.slice(8), { body, type: String(req.headers['content-type']), length: req.headers['content-length'], chunked: req.headers['transfer-encoding'] === 'chunked' });
    return res.writeHead(200).end();
  }
  if (url.pathname.startsWith('/api/media/f/') || url.pathname.startsWith('/api/fx/')) {
    const m = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (m) {
      const from = Number(m[1]);
      const to = m[2] ? Number(m[2]) : ICON.length - 1;
      return res.writeHead(206, { 'content-type': 'image/png', 'content-length': String(to - from + 1), 'content-range': `bytes ${from}-${to}/${ICON.length}`, 'accept-ranges': 'bytes' }).end(ICON.subarray(from, to + 1));
    }
    return res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(ICON.length) }).end(ICON);
  }
  let user = null;
  try {
    user = JSON.parse(Buffer.from(String(req.headers['x-panel-user']), 'base64url').toString('utf8'));
  } catch {}
  seen.push({ method: req.method ?? '', path: url.pathname + url.search, key: req.headers['x-panel-key'] as string | undefined, user, body: body.toString('utf8'), headers: req.headers });
  if (req.headers['x-panel-key'] !== KEY) return json(401, { error: 'Panel anahtarı geçersiz' });
  if (refuse) return json(refuse.status, { error: refuse.error });
  if (req.method === 'GET' && url.pathname === '/api/admin/gifts') {
    return json(200, {
      gifts: [{ id: 'a1', name: 'Yüzük', price: 4999, cat: 'hot', icon: `${appBase}/api/media/f/gifticon/u1/x.png`, video: { url: '/api/fx/g/a1.mp4?v=abcdef012345', bytes: 10, ms: 5000 }, job: null }],
      limits: { priceMax: 1_000_000 },
      convert: true,
      svga: true,
      storage: true,
    });
  }
  if (req.method === 'POST' && url.pathname === '/api/media/upload-url') {
    const b = JSON.parse(body.toString('utf8'));
    return json(200, { uploadUrl: `${appBase}/bucket/${b.kind}-1?X-Amz-Signature=x`, headers: { 'content-type': b.contentType }, publicUrl: `${appBase}/api/media/f/${b.kind}/u1/new`, expiresIn: 600 });
  }
  if (req.method === 'POST' && url.pathname.startsWith('/api/admin/gifts')) return json(200, { gift: { id: 'a2', ...JSON.parse(body.toString('utf8') || '{}') } });
  json(404, { error: 'Bulunamadı' });
});

const env = setup();
const dataDir = mkdtempSync(join(tmpdir(), 'fc-app-'));
let panel: ReturnType<typeof createApp>;
let unlinked: ReturnType<typeof createApp>;
let base = '';
let baseOff = '';

before(async () => {
  await new Promise<void>((r) => fakeApp.listen(0, '127.0.0.1', r));
  appBase = `http://127.0.0.1:${(fakeApp.address() as AddressInfo).port}`;
  panel = createApp(env.db, { dataDir, dbPath: ':memory:', cookieSecure: false, appLink: { url: appBase, key: KEY } });
  unlinked = createApp(env.db, { dataDir, dbPath: ':memory:', cookieSecure: false, appLink: null });
  await new Promise<void>((r) => panel.listen(0, '127.0.0.1', r));
  await new Promise<void>((r) => unlinked.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(panel.address() as AddressInfo).port}`;
  baseOff = `http://127.0.0.1:${(unlinked.address() as AddressInfo).port}`;
});
after(() => {
  panel.close();
  unlinked.close();
  fakeApp.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}, at = base) {
  const res = await fetch(at + path, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = text;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json };
}
async function loginAs(email: string) {
  const r = await call('POST', '/api/auth/login', { email, password: PASSWORD });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return { authorization: `Bearer ${r.json.token}` };
}

test('bağlantı ortamdan: adres ve en az 32 karakterlik anahtar', () => {
  assert.deepEqual(appLink({ FC_APP_API_URL: 'http://127.0.0.1:7890/', FC_APP_API_KEY: KEY }), { url: 'http://127.0.0.1:7890', key: KEY });
  assert.equal(appLink({ FC_APP_API_URL: 'http://127.0.0.1:7890', FC_APP_API_KEY: 'kısa' }), null);
  assert.equal(appLink({ FC_APP_API_KEY: KEY }), null);
  assert.deepEqual(localFiles({ a: 'https://x.test/api/media/f/gifticon/u/a.png', b: ['/api/fx/g/a1.mp4?v=1'], c: 'https://r2.test/media/k?sig' }), {
    a: '/api/app/media/f/gifticon/u/a.png',
    b: ['/api/app/fx/g/a1.mp4?v=1'],
    c: 'https://r2.test/media/k?sig',
  });
});

test('hediye listesi: anahtar ve oturumdaki kişi uygulamaya gider; dosya adresleri bu sunucunun', async () => {
  const h = await loginAs('admin@test.local');
  const r = await call('GET', '/api/app/gifts', undefined, h);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.gifts[0].icon, '/api/app/media/f/gifticon/u1/x.png');
  assert.equal(r.json.gifts[0].video.url, '/api/app/fx/g/a1.mp4?v=abcdef012345');
  const last = seen.at(-1)!;
  assert.equal(last.key, KEY);
  assert.equal(last.user.email, 'admin@test.local');
  assert.equal(last.user.role, 'super_admin');
  assert.ok(Number.isSafeInteger(last.user.id));
  assert.equal((await call('GET', '/api/meta', undefined, h)).json.app_link, true);
});

test('yetki: finans ve operasyon yöneticisi evet, salt okunur hayır; oturumsuz hiç', async () => {
  assert.equal((await call('GET', '/api/app/gifts')).status, 401);
  for (const [role, email, status] of [
    ['operations_manager', 'ops@test.local', 200],
    ['finance_manager', 'fin@test.local', 200],
    ['read_only', 'ro@test.local', 403],
  ] as const) {
    env.as(role, email);
    assert.equal((await call('GET', '/api/app/gifts', undefined, await loginAs(email))).status, status, role);
  }
  const ro = await loginAs('ro@test.local');
  assert.equal((await call('POST', '/api/app/gifts/delete', { id: 'a1' }, ro)).status, 403);
  assert.equal((await call('GET', '/api/app/media/f/gifticon/u1/x.png', undefined, ro)).status, 403);
});

test('değişiklik uygulamaya aynen gider ve paneldeki denetim kaydına da yazılır; uygulamanın reddi aynen döner', async () => {
  const h = await loginAs('ops@test.local');
  const r = await call('POST', '/api/app/gifts/update', { id: 'a1', price: 5999 }, h);
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(seen.at(-1)!.body), { id: 'a1', price: 5999 });
  assert.equal(seen.at(-1)!.user.email, 'ops@test.local');
  const log = env.db.get("SELECT actor, after FROM audit_logs WHERE action = 'app.gifts.update' ORDER BY id DESC LIMIT 1")!;
  assert.match(log.actor, /ops@test\.local/);
  assert.deepEqual(JSON.parse(log.after).body, { id: 'a1', price: 5999 });
  refuse = { status: 400, error: 'Fiyat 1–1.000.000 jeton arasında bir tam sayı olmalı' };
  const no = await call('POST', '/api/app/gifts/update', { id: 'a1', price: 0 }, h);
  refuse = null;
  assert.equal(no.status, 400);
  assert.equal(no.json.error, 'Fiyat 1–1.000.000 jeton arasında bir tam sayı olmalı');
});

test('yükleme: dosya bu sunucudan depoya akar, boyutu ve türüyle; adresi kaydetmek için döner', async () => {
  const h = await loginAs('admin@test.local');
  const res = await fetch(`${base}/api/app/upload?kind=gifticon`, { method: 'POST', headers: { ...h, 'content-type': 'image/png' }, body: ICON });
  const j: any = await res.json();
  assert.equal(res.status, 200, JSON.stringify(j));
  assert.equal(j.url, `${appBase}/api/media/f/gifticon/u1/new`);
  const put = stored.get('gifticon-1')!;
  assert.deepEqual(put.body, ICON);
  assert.equal(put.type, 'image/png');
  assert.equal(put.length, String(ICON.length));
  assert.equal(put.chunked, false);
  assert.deepEqual(JSON.parse(seen.at(-1)!.body), { kind: 'gifticon', contentType: 'image/png', size: ICON.length });
  assert.equal((await fetch(`${base}/api/app/upload?kind=avatar`, { method: 'POST', headers: { ...h, 'content-type': 'image/png' }, body: ICON })).status, 400);
  assert.equal((await fetch(`${base}/api/app/upload?kind=gifticon`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: ICON })).status, 401);
});

test('uygulamanın dosyaları bu sunucudan: tamamı ya da bir parçası', async () => {
  const h = await loginAs('admin@test.local');
  const whole = await fetch(`${base}/api/app/media/f/gifticon/u1/x.png`, { headers: h });
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await whole.arrayBuffer()), ICON);
  const part = await fetch(`${base}/api/app/fx/g/a1.mp4?v=abcdef012345`, { headers: { ...h, range: 'bytes=0-99' } });
  assert.equal(part.status, 206);
  assert.equal((await part.arrayBuffer()).byteLength, 100);
});

test('anahtar kabul edilmezse ya da bağlantı yoksa sayfa nedenini söyler', async () => {
  const h = await loginAs('admin@test.local');
  const wrong = createApp(env.db, { dataDir, dbPath: ':memory:', cookieSecure: false, appLink: { url: appBase, key: 'x'.repeat(64) } });
  await new Promise<void>((r) => wrong.listen(0, '127.0.0.1', r));
  const r = await call('GET', '/api/app/gifts', undefined, h, `http://127.0.0.1:${(wrong.address() as AddressInfo).port}`);
  wrong.close();
  assert.equal(r.status, 502);
  assert.match(r.json.error, /anahtarını kabul etmedi/);
  const off = await call('GET', '/api/app/gifts', undefined, h, baseOff);
  assert.equal(off.status, 503);
  assert.match(off.json.error, /FC_APP_API_URL/);
  assert.equal((await call('GET', '/api/meta', undefined, h, baseOff)).json.app_link, false);
});

test('daha önce kurulmuş rollere yeni yetki bir kez eklenir', () => {
  const { db } = setup();
  db.run("UPDATE roles SET permissions = json_remove(permissions, (SELECT '$[' || key || ']' FROM json_each(roles.permissions) WHERE value = 'app.gifts')) WHERE key IN ('finance_manager', 'operations_manager')");
  db.run("DELETE FROM schema_migrations WHERE name = '002_app_permissions.sql'");
  db.migrate();
  db.migrate();
  for (const key of ['finance_manager', 'operations_manager']) {
    const perms: string[] = JSON.parse(db.value<string>('SELECT permissions FROM roles WHERE key = ?', key)!);
    assert.equal(perms.filter((p) => p === 'app.gifts').length, 1, key);
  }
  assert.ok(!JSON.parse(db.value<string>("SELECT permissions FROM roles WHERE key = 'read_only'")!).includes('app.gifts'));
});
