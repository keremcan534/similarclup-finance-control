// Uygulama pages (server/app-admin.ts) against a stand-in app API: the panel calls it with its key and names the
// signed-in user, only for users whose role has the page's permission; the app's file addresses come back as this
// server's; an upload streams through to the storage address the app gives; the app's own refusals come back as
// they are; without a link the pages say so. Existing roles get the new permission once (002_app_permissions.sql).
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import type { AddressInfo } from 'node:net';

import { APP_ROUTES, appLink, localFiles } from '../server/app-admin.ts';
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
  // A file from a link: the app answers the stored address at its own name (files out), as the real one does.
  if (req.method === 'POST' && url.pathname === '/api/admin/gifts/fetch') {
    const b = JSON.parse(body.toString('utf8'));
    return json(200, { url: `${appBase}/api/media/f/gifticon/u1/linked.png`, link: b.url, kind: 'gifticon', type: 'image/png', bytes: 3000, video: null, svga: false });
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/emoji/fetch') {
    const b = JSON.parse(body.toString('utf8'));
    return json(200, { url: `${appBase}/api/media/f/stickerart/u1/linked.png`, link: b.url, kind: 'image', type: 'image/png', bytes: 2000 });
  }
  if (req.method === 'POST' && url.pathname.startsWith('/api/admin/gifts')) return json(200, { gift: { id: 'a2', ...JSON.parse(body.toString('utf8') || '{}') } });
  // Şanslı hediye ayarı: the packages and each one's icon and video (the app's lucky-art.mjs), and a file from a link.
  if (req.method === 'GET' && url.pathname === '/api/admin/lucky') {
    return json(200, {
      config: { gifts: [{ id: 'lk1', name: 'Şans Yoncası', emoji: '🍀', price: 20, enabled: true, tiers: [{ mult: 0, weight: 100_000 }], since: 1 }], dailyPayoutLimit: 20_000_000, announceFrom: 50 },
      version: 3,
      art: [{ id: 'lk1', icon: `${appBase}/api/media/f/gifticon/u1/yonca.png`, iconLink: null, video: { url: '/api/fx/l/lk1.mp4?v=0123456789ab', bytes: 10, ms: 4000 }, videoLink: null, job: { status: 'failed', error: 'Saydam değil', preview: `${appBase}/api/media/f/giftsource/u1/onizleme.mp4` }, original: { icon: '/api/fx/art/gifts/lk1.webp' }, updatedAt: null }],
      artLimits: { iconBytes: 2_000_000, iconMinPx: 128, iconMaxPx: 4096, videoBytes: 10_000_000, sourceBytes: 500_000_000, svgaBytes: 100_000_000, videoMinMs: 1000, videoMaxMs: 15000, fills: [0.45, 0.6, 0.8, 1] },
      convert: true,
      svga: true,
      storage: true,
      // As the other reads' echo (para sayfaları checks where each went).
      path: url.pathname + url.search,
    });
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/lucky/fetch') {
    const b = JSON.parse(body.toString('utf8'));
    return json(200, { url: `${appBase}/api/media/f/giftsource/u1/linked.svga`, link: b.url, kind: 'giftsource', type: 'application/x-svga', bytes: 4000, video: 'source', svga: true });
  }
  // İz türleri (the app's mark-kinds.mjs): a kind with its overlay at the app's storage address.
  if (req.method === 'GET' && url.pathname === '/api/admin/mark-kinds') {
    return json(200, {
      kinds: [{ kind: 'kirik-cam', name: 'Kırık Cam', art: { url: `${appBase}/api/media/f/markart/u1/cam.png`, v: '0123456789ab', px: 512, bytes: 69_156, checked: true, stats: { clear: 0.78, face: 0 } }, minutes: 1440, stack: 'refresh', enabled: true, gifts: [{ id: 'p8', name: 'Terlik Geldi!', role: 'leave', minutes: 1440, enabled: true }], showing: 3, updatedAt: null }],
      limits: { nameMax: 24, minutes: { min: 5, max: 10_080 }, bytes: 2_097_152, types: ['image/png', 'image/webp'], minPx: 256, maxPx: 2048, servePx: 512, serveBytes: 307_200, clearMin: 0.3, faceMax: 0.2, faceRadius: 0.3, stacks: ['refresh', 'replace'] },
      on: true,
      hours: 24,
    });
  }
  // The other admin routes (Para çekme, Ajans ödemeleri, İadeler, Şanslı, Canlı ayarlar, raporlar): an echo.
  if (url.pathname.startsWith('/api/admin/')) return json(200, { ok: true, path: url.pathname + url.search });
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

test('para sayfaları: her biri kendi yetkisiyle; operasyon yöneticisi yalnız raporları okur; önizleme kayda geçmez', async () => {
  env.as('finance_manager', 'fin@test.local');
  env.as('operations_manager', 'ops@test.local');
  env.as('read_only', 'ro@test.local');
  const fin = await loginAs('fin@test.local');
  const ops = await loginAs('ops@test.local');
  const ro = await loginAs('ro@test.local');
  const reads = ['/api/app/withdrawals?status=all', '/api/app/agency/payouts?status=ready', '/api/app/agency/settings', '/api/app/purchases?q=ab', '/api/app/wallet/audit?user=u1', '/api/app/lucky', '/api/app/live-settings', '/api/app/live-settings/history?limit=30'];
  const reports = ['/api/app/casino/report', '/api/app/alerts', '/api/app/finance-sync'];
  for (const p of [...reads, ...reports]) {
    const r = await call('GET', p, undefined, fin);
    assert.equal(r.status, 200, `${p}: ${JSON.stringify(r.json)}`);
    // The query goes on as it came: the app reads its own filters.
    assert.equal(r.json.path, `/api/admin${p.slice('/api/app'.length)}`);
    assert.equal(seen.at(-1)!.user.email, 'fin@test.local');
  }
  for (const p of reads) assert.equal((await call('GET', p, undefined, ops)).status, 403, `ops ${p}`);
  for (const p of reports) {
    assert.equal((await call('GET', p, undefined, ops)).status, 200, `ops ${p}`);
    assert.equal((await call('GET', p, undefined, ro)).status, 403, `ro ${p}`);
  }
  for (const [p, body] of [
    ['/api/app/withdrawals/decide', { id: 3, approve: false, note: 'IBAN sahibinin adı tutmuyor' }],
    ['/api/app/agency/payouts/decide', { payoutId: 4, action: 'pay', paymentRef: 'DEKONT-1' }],
    ['/api/app/purchases/refund', { purchase: 5 }],
    ['/api/app/purchases/voided-sync', {}],
    ['/api/app/lucky/config', { config: { gifts: [] }, version: 2 }],
    ['/api/app/live-settings/rollback', { batch: 'b1', reason: 'Yanlış kur', baseV: 9 }],
  ] as const) {
    assert.equal((await call('POST', p, body, ops)).status, 403, `ops ${p}`);
    const r = await call('POST', p, body, fin);
    assert.equal(r.status, 200, `${p}: ${JSON.stringify(r.json)}`);
    assert.deepEqual(JSON.parse(seen.at(-1)!.body), body);
    const action = `app${p.slice('/api/app'.length).replace(/\//g, '.')}`;
    const log = env.db.get('SELECT actor, after FROM audit_logs WHERE action = ? ORDER BY id DESC LIMIT 1', action);
    assert.ok(log, action);
    assert.match(log.actor, /fin@test\.local/);
    assert.deepEqual(JSON.parse(log.after).body, body);
  }
  // Canlı ayarlar: the preview goes to the app (it answers what would change) but is no change here.
  const rows = () => env.db.value<number>("SELECT count(*) FROM audit_logs WHERE action = 'app.live-settings'") ?? 0;
  const had = rows();
  const preview = { changes: { exchange_usd_try: 42.5 }, reason: 'Kur güncellemesi', baseV: 9, dryRun: true };
  assert.equal((await call('POST', '/api/app/live-settings', preview, fin)).status, 200);
  assert.deepEqual(JSON.parse(seen.at(-1)!.body), preview);
  assert.equal(rows(), had);
  assert.equal((await call('POST', '/api/app/live-settings', { ...preview, dryRun: false, confirm: true }, fin)).status, 200);
  assert.equal(rows(), had + 1);
  // Only the listed routes: anything else of the app's is not reachable from here; a listed one needs its permission.
  assert.equal((await call('GET', '/api/app/ledger', undefined, fin)).status, 404);
  assert.equal((await call('GET', '/api/app/sanctions/pending', undefined, fin)).status, 403);
  assert.equal((await call('POST', '/api/app/withdrawals/decide', { id: 3, approve: true }, ro)).status, 403);
});

test('operasyon sayfaları: operasyon yöneticisi evet, finans yöneticisi ve salt okunur hayır; duyuru görseli yüklenir', async () => {
  env.as('finance_manager', 'fin@test.local');
  env.as('operations_manager', 'ops@test.local');
  env.as('read_only', 'ro@test.local');
  const fin = await loginAs('fin@test.local');
  const ops = await loginAs('ops@test.local');
  const ro = await loginAs('ro@test.local');
  const reads = [
    '/api/app/users?q=Ay%C5%9Fe&offset=50',
    '/api/app/reports?status=open',
    '/api/app/rooms/background?room=r1',
    '/api/app/support?status=waiting',
    '/api/app/support/ticket?id=12',
    '/api/app/team',
    '/api/app/events?status=review&q=gala',
    '/api/app/events/categories',
    '/api/app/events/report?days=30',
  ];
  for (const p of reads) {
    const r = await call('GET', p, undefined, ops);
    assert.equal(r.status, 200, `${p}: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.path, `/api/admin${p.slice('/api/app'.length)}`);
    assert.equal((await call('GET', p, undefined, fin)).status, 403, `fin ${p}`);
    assert.equal((await call('GET', p, undefined, ro)).status, 403, `ro ${p}`);
  }
  for (const [p, body] of [
    ['/api/app/ban', { user: 'u1', days: 7, reason: 'spam' }],
    ['/api/app/users/room-level', { id: 'u1', level: 15 }],
    ['/api/app/users/delete', { id: 'u1' }],
    ['/api/app/referrals/revoke', { invitee: 'u1', reason: 'Sahte hesap' }],
    ['/api/app/reports/handle', { id: 4, status: 'actioned', banDays: 3 }],
    ['/api/app/rooms/cover/remove', { room: 'r1', reason: 'Kural ihlali' }],
    ['/api/app/support/reply', { id: '12', text: 'Merhaba, inceledik.', close: true }],
    ['/api/app/support/status', { id: '12', status: 'open' }],
    ['/api/app/team', { kind: 'update', title: 'Bakım', body: 'Gece 03.00' }],
    ['/api/app/team/remove', { id: '9' }],
    ['/api/app/events/review', { id: 5, approve: false, reason: 'Saat uygun değil' }],
    ['/api/app/events/remove', { id: 5, reason: 'Kural ihlali' }],
    ['/api/app/events/reward', { id: 5, sku: 'fr-neon', days: 7 }],
    ['/api/app/events/categories', { name: 'Gala', icon: 'sparkles', theme: 'sade', sort: 0, active: true }],
    ['/api/app/events/categories/remove', { id: 'gala' }],
  ] as const) {
    assert.equal((await call('POST', p, body, fin)).status, 403, `fin ${p}`);
    const r = await call('POST', p, body, ops);
    assert.equal(r.status, 200, `${p}: ${JSON.stringify(r.json)}`);
    assert.deepEqual(JSON.parse(seen.at(-1)!.body), body);
    assert.equal(seen.at(-1)!.user.email, 'ops@test.local');
    const action = `app${p.slice('/api/app'.length).replace(/\//g, '.')}`;
    assert.ok(env.db.get('SELECT 1 FROM audit_logs WHERE action = ? ORDER BY id DESC LIMIT 1', action), action);
  }
  // A notice's picture: the operations manager uploads it; the finance manager may not.
  const up = (h: Record<string, string>) => fetch(`${base}/api/app/upload?kind=notice`, { method: 'POST', headers: { ...h, 'content-type': 'image/png' }, body: ICON });
  const u = await up(ops);
  assert.equal(u.status, 200);
  assert.equal(((await u.json()) as any).url, `${appBase}/api/media/f/notice/u1/new`);
  assert.deepEqual(stored.get('notice-1')?.body, ICON);
  assert.equal((await up(fin)).status, 403);
  // The app's pictures (a ticket's photo, a reported room's) open for the operations manager too.
  assert.equal((await fetch(`${base}/api/app/media/f/ticket/u1/x.png`, { headers: ops })).status, 200);
});

test('Ajans merkezi: finans yöneticisi evet, operasyon yöneticisi ve salt okunur hayır; komisyon defteri ayrı yetki', async () => {
  env.as('finance_manager', 'fin@test.local');
  env.as('operations_manager', 'ops@test.local');
  env.as('read_only', 'ro@test.local');
  // A role made in this panel with the agency pages but not the ledger.
  env.db.run("INSERT INTO roles (key, name, scope, permissions) VALUES ('ajans_ekibi', 'Ajans ekibi', 'platform', '[\"app.agencies\"]') ON CONFLICT (key) DO NOTHING");
  env.as('ajans_ekibi', 'ajans@test.local');
  const fin = await loginAs('fin@test.local');
  const ops = await loginAs('ops@test.local');
  const ro = await loginAs('ro@test.local');
  const team = await loginAs('ajans@test.local');
  const reads = [
    '/api/app/agency/tree',
    '/api/app/agency/overview',
    '/api/app/agency/list?status=pending',
    '/api/app/agency/performance?runId=3',
    '/api/app/agency/transfers?status=pending',
    '/api/app/agency/audit?type=agency&result=ok',
    '/api/app/agency/report?from=2026-10-01T00%3A00%3A00%2B03%3A00&to=2026-11-01T00%3A00%3A00%2B03%3A00',
    '/api/app/agency/bd-report?bd=b1',
  ];
  for (const p of reads) {
    const r = await call('GET', p, undefined, fin);
    assert.equal(r.status, 200, `${p}: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.path, `/api/admin${p.slice('/api/app'.length)}`);
    assert.equal((await call('GET', p, undefined, team)).status, 200, `team ${p}`);
    // The list also serves Ajans personeli's agency search, the operations manager's page; the rest is the centre's.
    assert.equal((await call('GET', p, undefined, ops)).status, p.startsWith('/api/app/agency/list') ? 200 : 403, `ops ${p}`);
    assert.equal((await call('GET', p, undefined, ro)).status, 403, `ro ${p}`);
  }
  // The network's rules serve Ajans ödemeleri and Ajans merkezi: either permission opens them.
  assert.equal((await call('GET', '/api/app/agency/settings', undefined, team)).status, 200);
  assert.equal((await call('GET', '/api/app/agency/settings', undefined, fin)).status, 200);
  assert.equal((await call('GET', '/api/app/agency/settings', undefined, ops)).status, 403);
  const logged = (p: string) => env.db.value<number>('SELECT count(*) FROM audit_logs WHERE action = ?', `app${p.slice('/api/app'.length).replace(/\//g, '.')}`) ?? 0;
  for (const [p, body] of [
    ['/api/app/agency/create', { name: 'Yıldız Ajans', country: 'Türkiye' }],
    ['/api/app/agency/decide', { id: 'a1', approve: false, note: 'Eksik bilgi' }],
    ['/api/app/agency/status', { id: 'a1', status: 'suspended', reason: 'İnceleme' }],
    ['/api/app/agency/rate', { id: 'a1', rate: 0.255, reason: 'Düzeltme', effectiveFrom: '2026-12-01T00:00:00+03:00' }],
    ['/api/app/agency/tier', { id: 'a2', tier: 'growing', reason: 'Performans' }],
    ['/api/app/agency/parent', { id: 'a2', parentId: null, reason: 'Bağımsız' }],
    ['/api/app/agency/assign', { streamer: 'u1', agencyId: 'a1', reason: 'Merkez kararı' }],
    ['/api/app/agency/transfers/decide', { transferId: 7, approve: true, note: '', mode: 'free' }],
    ['/api/app/agency/transition', { agencyId: 'a1', oldParentId: 'a3', rate: 0.05, endsAt: '2027-03-01T00:00:00+03:00', scope: 'existing', reason: 'Geçiş' }],
    ['/api/app/agency/performance/run', { dryRun: false, note: 'Elle' }],
  ] as const) {
    assert.equal((await call('POST', p, body, ops)).status, 403, `ops ${p}`);
    const before = logged(p);
    const r = await call('POST', p, body, team);
    assert.equal(r.status, 200, `${p}: ${JSON.stringify(r.json)}`);
    assert.deepEqual(JSON.parse(seen.at(-1)!.body), body);
    assert.equal(seen.at(-1)!.user.email, 'ajans@test.local');
    assert.equal(logged(p), before + 1, `${p} is in this panel's audit log`);
  }
  // Computing only: the simulator and a performance dry run go to the app but are no change here.
  for (const [p, body] of [
    ['/api/app/agency/simulate', { base: 100000, agencyId: 'a1' }],
    ['/api/app/agency/performance/run', { dryRun: true }],
  ] as const) {
    const before = logged(p);
    assert.equal((await call('POST', p, body, fin)).status, 200, p);
    assert.deepEqual(JSON.parse(seen.at(-1)!.body), body);
    assert.equal(logged(p), before, `${p} is not logged`);
  }
  // The ledger and the rules: the finance manager, not the agency team.
  for (const [p, body] of [
    ['/api/app/agency/commissions/run', {}],
    ['/api/app/agency/income', { streamer: 'u1', type: 'bonus', diamonds: 5000, ref: 'fc-test-income-1' }],
    ['/api/app/agency/commissions/reverse', { commissionId: 12, reason: 'Hatalı gelir' }],
    ['/api/app/agency/adjust', { agencyId: 'a1', amount: -250.5, reason: 'Fazla ödeme', ref: 'fc-test-adjust-1' }],
    ['/api/app/agency/periods/close', { period: '2026-10' }],
    ['/api/app/agency/settings', { key: 'pool_cap', value: 0.4, reason: 'Aynı kalsın' }],
  ] as const) {
    assert.equal((await call('POST', p, body, team)).status, 403, `team ${p}`);
    assert.equal((await call('POST', p, body, ops)).status, 403, `ops ${p}`);
    const before = logged(p);
    const r = await call('POST', p, body, fin);
    assert.equal(r.status, 200, `${p}: ${JSON.stringify(r.json)}`);
    assert.deepEqual(JSON.parse(seen.at(-1)!.body), body);
    assert.equal(logged(p), before + 1, `${p} is in this panel's audit log`);
  }
  // The centre's staff roles and background jobs: their own permission (the operations manager's), not finance's.
  assert.equal((await call('GET', '/api/app/agency/roles', undefined, fin)).status, 403);
  assert.equal((await call('POST', '/api/app/agency/jobs/run', {}, fin)).status, 403);
});

test('Yönetim\'in kalanı: yaptırımlar, ajans personeli, mağaza eşyaları, Jeton Noktası; her biri kendi yetkisiyle', async () => {
  env.as('finance_manager', 'fin@test.local');
  env.as('operations_manager', 'ops@test.local');
  env.as('moderator', 'mod@test.local');
  env.as('read_only', 'ro@test.local');
  const [fin, ops, mod, ro] = await Promise.all(['fin@test.local', 'ops@test.local', 'mod@test.local', 'ro@test.local'].map(loginAs));
  const get = async (p: string, who: Record<string, string>) => (await call('GET', p, undefined, who)).status;
  const post = async (p: string, body: unknown, who: Record<string, string>) => (await call('POST', p, body, who)).status;
  // A moderator: the sanctions with a moderator's permissions and support, nothing else.
  for (const p of ['/api/app/sanctions/meta', '/api/app/sanctions/search?q=Ayşe', '/api/app/sanctions/pending', '/api/app/appeals?status=open', '/api/app/support']) assert.equal(await get(p, mod), 200, `mod ${p}`);
  assert.equal(await post('/api/app/sanctions', { user: 'u', type: 'mute_global_text', minutes: 60, reason: 'spam', description: 'Spam' }, mod), 200);
  assert.deepEqual(seen.at(-1)!.user.perms, ['app.sanctions', 'app.support'], 'uygulama yaptırım yetkisini buradan çıkarır');
  for (const [p, b] of [['/api/app/sanctions/approve', { id: 1, approve: true, note: 'Onay' }], ['/api/app/sanction-policies', { reason: 'spam', steps: [] }], ['/api/app/devices/risk', { device: 1, status: 'normal' }], ['/api/app/sanction-permissions', { user: 'u', permission: 'sanction.ban', grant: true }]] as const)
    assert.equal(await post(p, b, mod), 403, `mod ${p}`);
  for (const p of ['/api/app/users', '/api/app/withdrawals', '/api/app/agency/staff', '/api/app/economy/reviews']) assert.equal(await get(p, mod), 403, `mod ${p}`);
  // The operations manager: every sanction, the agency centre's staff, a person's shop items; not Jeton Noktası.
  for (const p of ['/api/app/sanction-permissions?user=u', '/api/app/agency/roles', '/api/app/agency/staff', '/api/app/agency/appeals?status=open', '/api/app/economy/user?id=u', '/api/app/economy/reviews'])
    assert.equal(await get(p, ops), 200, `ops ${p}`);
  for (const [p, b] of [
    ['/api/app/sanctions/approve', { id: 1, approve: true, note: 'Kanıt yeterli' }],
    ['/api/app/agency/staff/set', { user: 'u', roleId: 2 }],
    ['/api/app/agency/ops-score', { agencyId: 'a', score: 80, reason: 'Aylık değerlendirme' }],
    ['/api/app/economy/grant', { userId: 'u', sku: 'fr-neon', days: 7, reason: 'Telafi', ref: 'r1234567' }],
  ] as const) {
    assert.equal(await post(p, b, ops), 200, `ops ${p}`);
    assert.deepEqual(JSON.parse(seen.at(-1)!.body), b);
  }
  assert.ok(seen.at(-1)!.user.perms.includes('app.sanctions_full'));
  assert.equal(await post('/api/app/jeton/wholesale', { bank: 'b', coins: 1000, paymentRef: 'DEKONT-1', ref: 'r7654321' }, ops), 403);
  // The finance manager: Jeton Noktası; no sanctions, no staff.
  assert.equal(await post('/api/app/jeton/bank', { user: 'b', enabled: true }, fin), 200);
  assert.equal(await post('/api/app/jeton/wholesale', { bank: 'b', coins: 1000, paymentRef: 'DEKONT-1', ref: 'r7654321' }, fin), 200);
  for (const p of ['/api/app/sanctions/meta', '/api/app/agency/staff']) assert.equal(await get(p, fin), 403, `fin ${p}`);
  // Read only: none of it.
  for (const p of ['/api/app/sanctions/meta', '/api/app/agency/roles', '/api/app/economy/reviews']) assert.equal(await get(p, ro), 403, `ro ${p}`);
});

test('kişinin ID’si: hesap alanı olan her sayfanın yetkisiyle uygulamada aranır (moderatör de); salt okunur hayır', async () => {
  env.as('finance_manager', 'fin@test.local');
  env.as('operations_manager', 'ops@test.local');
  env.as('moderator', 'mod@test.local');
  env.as('read_only', 'ro@test.local');
  const [fin, ops, mod, ro] = await Promise.all(['fin@test.local', 'ops@test.local', 'mod@test.local', 'ro@test.local'].map(loginAs));
  for (const who of [fin, ops, mod]) {
    const r = await call('GET', '/api/app/lookup?no=104829301457', undefined, who);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(seen.at(-1)!.path, '/api/admin/lookup?no=104829301457', 'uygulamanın yolu, numara olduğu gibi');
  }
  assert.equal((await call('GET', '/api/app/lookup?no=104829301457', undefined, ro)).status, 403);
});

test('bağlantıdan dosya: uygulama indirir; kaydedilecek adres olduğu gibi, önizlemesi bu sunucudan; yetki, denetim, ret', async () => {
  env.as('operations_manager', 'ops@test.local');
  env.as('read_only', 'ro@test.local');
  const ops = await loginAs('ops@test.local');
  const body = { slot: 'icon', url: 'https://alanadi.com/hediyeler/yuzuk.png' };
  const r = await call('POST', '/api/app/gifts/fetch', body, ops);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  // Saved as the app gave it (it reads its own address back); shown through this server.
  assert.equal(r.json.url, `${appBase}/api/media/f/gifticon/u1/linked.png`);
  assert.equal(r.json.preview, '/api/app/media/f/gifticon/u1/linked.png');
  assert.equal(r.json.link, body.url);
  assert.equal(seen.at(-1)!.path, '/api/admin/gifts/fetch');
  assert.deepEqual(JSON.parse(seen.at(-1)!.body), body);
  assert.equal(seen.at(-1)!.user.email, 'ops@test.local');
  const log = env.db.get("SELECT actor, after FROM audit_logs WHERE action = 'app.gifts.fetch' ORDER BY id DESC LIMIT 1")!;
  assert.match(log.actor, /ops@test\.local/);
  assert.deepEqual(JSON.parse(log.after).body, body);
  assert.equal((await call('POST', '/api/app/gifts/fetch', body, await loginAs('ro@test.local'))).status, 403);
  assert.equal((await call('POST', '/api/app/gifts/fetch', body)).status, 401);
  // The app's refusal (a share page instead of the file) comes back in its words.
  refuse = { status: 400, error: 'Bu bağlantı dosyanın kendisini değil bir web sayfasını açıyor' };
  const no = await call('POST', '/api/app/gifts/fetch', { slot: 'video', url: 'https://drive.google.com/file/d/1/view' }, ops);
  refuse = null;
  assert.equal(no.status, 400);
  assert.match(no.json.error, /web sayfasını/);
});

test('Hediyeler: uygulamanın kendi hediyeleri listede istenir, orijinale dönme uygulamaya aynen gider', async () => {
  env.as('operations_manager', 'ops@test.local');
  const ops = await loginAs('ops@test.local');
  assert.equal((await call('GET', '/api/app/gifts?builtin=1', undefined, ops)).status, 200);
  assert.equal(seen.at(-1)!.path, '/api/admin/gifts?builtin=1');
  const r = await call('POST', '/api/app/gifts/reset', { id: 'g6', fields: ['price'] }, ops);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(seen.at(-1)!.path, '/api/admin/gifts/reset');
  assert.deepEqual(JSON.parse(seen.at(-1)!.body), { id: 'g6', fields: ['price'] });
  assert.ok(env.db.get("SELECT 1 FROM audit_logs WHERE action = 'app.gifts.reset'"));
  env.as('read_only', 'ro@test.local');
  assert.equal((await call('POST', '/api/app/gifts/reset', { id: 'g6' }, await loginAs('ro@test.local'))).status, 403);
});

test('Hediyeler: Global hediye ve Profil izi uygulamaya aynen gider, en düşük fiyat listede gelir; reddi uygulamanın cümlesiyle', async () => {
  env.as('operations_manager', 'ops@test.local');
  const ops = await loginAs('ops@test.local');
  // The box and the mark round-trip: the page sends them as the app takes them; the app's answer comes back as it is.
  const tick = { id: 'a1', global: true, mark: null };
  const r = await call('POST', '/api/app/gifts/update', tick, ops);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(seen.at(-1)!.path, '/api/admin/gifts/update');
  assert.deepEqual(JSON.parse(seen.at(-1)!.body), tick);
  assert.equal(r.json.gift.global, true);
  const mark = { id: 'k1', mark: { role: 'leave', kind: 'kaka', hours: 12 } };
  assert.equal((await call('POST', '/api/app/gifts/update', mark, ops)).status, 200);
  assert.deepEqual(JSON.parse(seen.at(-1)!.body), mark);
  const create = { name: 'Uzay Gemisi', price: 300_000, cat: 'hot', icon: 'x', global: true, mark: null };
  assert.equal((await call('POST', '/api/app/gifts', create, ops)).status, 200);
  assert.deepEqual(JSON.parse(seen.at(-1)!.body), create);
  assert.equal((await call('POST', '/api/app/gifts/reset', { id: 'g6', fields: ['global', 'mark'] }, ops)).status, 200);
  assert.deepEqual(JSON.parse(seen.at(-1)!.body), { id: 'g6', fields: ['global', 'mark'] });
  const log = env.db.get("SELECT after FROM audit_logs WHERE action = 'app.gifts.update' ORDER BY id DESC LIMIT 1")!;
  assert.deepEqual(JSON.parse(log.after).body, mark);
  // Below the minimum: the app refuses in its words, shown as they are.
  refuse = { status: 400, error: 'Global hediye en az 300.000 jeton olmalı (bu 100.000 jeton)' };
  const low = await call('POST', '/api/app/gifts/update', { id: 'a1', global: true }, ops);
  refuse = { status: 400, error: 'Su izi temizlediği için onu bırakan hediyelerden pahalı olmalı: Kaka 99 jeton, bu 50 jeton.' };
  const cheap = await call('POST', '/api/app/gifts/update', { id: 'k2', price: 50 }, ops);
  refuse = null;
  assert.equal(low.status, 400);
  assert.equal(low.json.error, 'Global hediye en az 300.000 jeton olmalı (bu 100.000 jeton)');
  assert.equal(cheap.status, 400);
  assert.match(cheap.json.error, /pahalı olmalı/);
});

test('Şanslı hediye ayarı: paketler, ikon ve video, bağlantıdan dosya kendi yetkisiyle; dosyaları bu sunucudan; uygulamanın reddi aynen', async () => {
  env.as('finance_manager', 'fin@test.local');
  env.as('operations_manager', 'ops@test.local');
  // A role made in this panel with Şanslı hediye ayarı alone: its uploads and its packages' files open with it.
  env.db.run("INSERT INTO roles (key, name, scope, permissions) VALUES ('sansli', 'Şanslı ekibi', 'platform', '[\"app.lucky\"]') ON CONFLICT (key) DO NOTHING");
  env.as('sansli', 'sansli@test.local');
  const fin = await loginAs('fin@test.local');
  const ops = await loginAs('ops@test.local');
  const team = await loginAs('sansli@test.local');
  // The packages with each one's art: the app's file addresses as this server's (icon, video, a refused one's preview,
  // the app's own picture).
  const r = await call('GET', '/api/app/lucky', undefined, team);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.art[0].icon, '/api/app/media/f/gifticon/u1/yonca.png');
  assert.equal(r.json.art[0].video.url, '/api/app/fx/l/lk1.mp4?v=0123456789ab');
  assert.equal(r.json.art[0].job.preview, '/api/app/media/f/giftsource/u1/onizleme.mp4');
  assert.equal(r.json.art[0].original.icon, '/api/app/fx/art/gifts/lk1.webp');
  assert.equal(r.json.artLimits.iconMinPx, 128);
  assert.equal((await call('GET', '/api/app/lucky', undefined, ops)).status, 403);
  // A new package (the whole settings with it), its icon and video, taking them off: each as sent, each in the log.
  const tiers = [{ mult: 0, weight: 84_500 }, { mult: 2, weight: 15_000 }, { mult: 1000, weight: 500 }];
  for (const [path, body] of [
    ['/api/app/lucky/config', { config: { gifts: [{ id: 'lk5', name: 'Altın Yonca', emoji: '☘️', price: 250, enabled: false, tiers }], dailyPayoutLimit: 20_000_000, announceFrom: 50 }, version: 3 }],
    ['/api/app/lucky/art', { id: 'lk5', icon: `${appBase}/api/media/f/gifticon/u1/new`, iconLink: null, video: { url: `${appBase}/api/media/f/giftsource/u1/new`, kind: 'source', fill: 0.6 }, videoLink: null }],
    ['/api/app/lucky/art', { id: 'lk5', video: null }],
    ['/api/app/lucky/art/remove', { id: 'lk5' }],
  ] as const) {
    for (const h of [team, fin]) {
      const out = await call('POST', path, body, h);
      assert.equal(out.status, 200, `${path}: ${JSON.stringify(out.json)}`);
      assert.equal(seen.at(-1)!.path, path.replace('/api/app/', '/api/admin/'));
      assert.deepEqual(JSON.parse(seen.at(-1)!.body), body);
    }
    assert.equal((await call('POST', path, body, ops)).status, 403, `ops ${path}`);
    const log = env.db.get('SELECT actor, after FROM audit_logs WHERE action = ? ORDER BY id DESC LIMIT 1', `app${path.slice('/api/app'.length).replace(/\//g, '.')}`);
    assert.ok(log, path);
    assert.match(log.actor, /fin@test\.local/);
    assert.deepEqual(JSON.parse(log.after).body, body);
  }
  // A file from a link: the app downloads it as a gift's; the address to save as it gave it, its preview through here.
  const link = { slot: 'video', url: 'https://alanadi.com/sansli/yonca.svga' };
  const got = await call('POST', '/api/app/lucky/fetch', link, team);
  assert.equal(got.status, 200, JSON.stringify(got.json));
  assert.equal(got.json.url, `${appBase}/api/media/f/giftsource/u1/linked.svga`);
  assert.equal(got.json.preview, '/api/app/media/f/giftsource/u1/linked.svga');
  assert.equal(got.json.svga, true);
  assert.equal(seen.at(-1)!.path, '/api/admin/lucky/fetch');
  assert.deepEqual(JSON.parse(seen.at(-1)!.body), link);
  assert.ok(env.db.get("SELECT 1 FROM audit_logs WHERE action = 'app.lucky.fetch'"));
  assert.equal((await call('POST', '/api/app/lucky/fetch', link, ops)).status, 403);
  // Uploads as a gift's: the icon, a ready video and a source; the files open for the page (the package's video too).
  for (const [kind, type] of [['gifticon', 'image/png'], ['giftvideo', 'video/mp4'], ['giftsource', 'application/x-svga']]) {
    const up = await fetch(`${base}/api/app/upload?kind=${kind}`, { method: 'POST', headers: { ...team, 'content-type': type }, body: ICON });
    assert.equal(up.status, 200, kind);
    assert.deepEqual(JSON.parse(seen.at(-1)!.body), { kind, contentType: type, size: ICON.length });
  }
  assert.equal((await fetch(`${base}/api/app/upload?kind=shopframe`, { method: 'POST', headers: { ...team, 'content-type': 'image/png' }, body: ICON })).status, 403);
  assert.equal((await fetch(`${base}/api/app/fx/l/lk1.mp4?v=0123456789ab`, { headers: { ...team, range: 'bytes=0-9' } })).status, 206);
  assert.equal((await fetch(`${base}/api/app/media/f/gifticon/u1/yonca.png`, { headers: team })).status, 200);
  // The app's refusals in its words: odds that don't add up, two packages with one name, an unsaved package's art.
  for (const [path, body, error] of [
    ['/api/app/lucky/config', { config: { gifts: [] }, version: 3 }, 'Altın Yonca: olasılıkların toplamı %99,5; %100 olmalı'],
    ['/api/app/lucky/config', { config: { gifts: [] }, version: 3 }, '“Altın Yonca” adında iki paket var; her paketin adı ayrı olmalı'],
    ['/api/app/lucky/art', { id: 'lk9', icon: 'x' }, 'Şanslı paket bulunamadı: önce paketi Şanslı hediye ayarında kaydet'],
  ] as const) {
    refuse = { status: error.includes('bulunamadı') ? 404 : 400, error };
    const no = await call('POST', path, body, team);
    refuse = null;
    assert.equal(no.status, error.includes('bulunamadı') ? 404 : 400);
    assert.equal(no.json.error, error);
  }
  refuse = { status: 409, error: 'Ayarlar bu arada değişti; yenileyip tekrar dene' };
  const stale = await call('POST', '/api/app/lucky/config', { config: { gifts: [] }, version: 1 }, team);
  refuse = null;
  assert.equal(stale.status, 409);
});

test('Profil izleri: Kullanıcılar yetkisiyle görülür ve kaldırılır; kaldırma denetim kaydına yazılır', async () => {
  env.as('operations_manager', 'ops@test.local');
  env.as('finance_manager', 'fin@test.local');
  env.as('read_only', 'ro@test.local');
  const ops = await loginAs('ops@test.local');
  const fin = await loginAs('fin@test.local');
  const ro = await loginAs('ro@test.local');
  const user = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
  const r = await call('GET', `/api/app/marks?user=${user}`, undefined, ops);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.path, `/api/admin/marks?user=${user}`);
  for (const body of [{ user, reason: 'Şikâyet: hakaret' }, { user, kind: 'kaka' }]) {
    const out = await call('POST', '/api/app/marks/clear', body, ops);
    assert.equal(out.status, 200, JSON.stringify(out.json));
    assert.equal(seen.at(-1)!.path, '/api/admin/marks/clear');
    assert.deepEqual(JSON.parse(seen.at(-1)!.body), body);
    assert.equal(seen.at(-1)!.user.email, 'ops@test.local');
    const log = env.db.get("SELECT actor, after FROM audit_logs WHERE action = 'app.marks.clear' ORDER BY id DESC LIMIT 1")!;
    assert.match(log.actor, /ops@test\.local/);
    assert.deepEqual(JSON.parse(log.after).body, body);
  }
  for (const h of [fin, ro]) {
    assert.equal((await call('GET', `/api/app/marks?user=${user}`, undefined, h)).status, 403);
    assert.equal((await call('POST', '/api/app/marks/clear', { user }, h)).status, 403);
  }
  refuse = { status: 400, error: 'Geçersiz iz türü' };
  const no = await call('POST', '/api/app/marks/clear', { user, kind: 'KAKA!' }, ops);
  refuse = null;
  assert.equal(no.status, 400);
  assert.equal(no.json.error, 'Geçersiz iz türü');
});

test('İz türleri: Hediyeler yetkisiyle; dört uç uygulamaya aynen gider ve denetim kaydına yazılır; iz resmi (markart) aynı yetkiyle yüklenir; ret cümlesi aynen', async () => {
  for (const [method, path] of [['GET', '/api/admin/mark-kinds'], ['POST', '/api/admin/mark-kinds'], ['POST', '/api/admin/mark-kinds/update'], ['POST', '/api/admin/mark-kinds/delete']]) {
    assert.deepEqual(APP_ROUTES.find(([m, p]) => m === method && p === path)?.[2], 'app.gifts', `${method} ${path}`);
  }
  env.as('operations_manager', 'ops@test.local');
  env.as('finance_manager', 'fin@test.local');
  env.as('read_only', 'ro@test.local');
  // A role with Şanslı hediye ayarı alone: no İz türleri, no overlay upload.
  env.db.run("INSERT INTO roles (key, name, scope, permissions) VALUES ('sansli', 'Şanslı ekibi', 'platform', '[\"app.lucky\"]') ON CONFLICT (key) DO NOTHING");
  env.as('sansli', 'sansli@test.local');
  const ops = await loginAs('ops@test.local');
  const fin = await loginAs('fin@test.local');
  const ro = await loginAs('ro@test.local');
  const lucky = await loginAs('sansli@test.local');
  // The list: the overlay's address as this server's.
  const r = await call('GET', '/api/app/mark-kinds', undefined, ops);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(seen.at(-1)!.path, '/api/admin/mark-kinds');
  assert.equal(r.json.kinds[0].art.url, '/api/app/media/f/markart/u1/cam.png');
  assert.equal(r.json.limits.faceMax, 0.2);
  for (const h of [ro, lucky]) assert.equal((await call('GET', '/api/app/mark-kinds', undefined, h)).status, 403);
  // A new kind, a change (its picture taken off, its time back to the Canlı ayar's), turning it off, deleting it.
  for (const [path, body] of [
    ['/api/app/mark-kinds', { kind: 'camur', name: 'Çamur', art: `${appBase}/api/media/f/markart/u1/new`, minutes: 60, stack: 'refresh', enabled: true }],
    ['/api/app/mark-kinds/update', { kind: 'camur', name: 'Çamur Topu', art: null, minutes: null }],
    ['/api/app/mark-kinds/update', { kind: 'camur', enabled: false }],
    ['/api/app/mark-kinds/delete', { kind: 'camur' }],
  ] as const) {
    for (const h of [ops, fin]) {
      const out = await call('POST', path, body, h);
      assert.equal(out.status, 200, `${path}: ${JSON.stringify(out.json)}`);
      assert.equal(seen.at(-1)!.path, path.replace('/api/app/', '/api/admin/'));
      assert.deepEqual(JSON.parse(seen.at(-1)!.body), body);
    }
    assert.match(seen.at(-1)!.user.email, /fin@test\.local/);
    const log = env.db.get('SELECT actor, after FROM audit_logs WHERE action = ? ORDER BY id DESC LIMIT 1', `app${path.slice('/api/app'.length).replace(/\//g, '.')}`);
    assert.ok(log, path);
    assert.match(log.actor, /fin@test\.local/);
    assert.deepEqual(JSON.parse(log.after).body, body);
    for (const h of [ro, lucky]) assert.equal((await call('POST', path, body, h)).status, 403, `${path}`);
  }
  // The overlay streams to the app's storage as kind markart; only with Hediyeler.
  const up = await fetch(`${base}/api/app/upload?kind=markart`, { method: 'POST', headers: { ...ops, 'content-type': 'image/png' }, body: ICON });
  assert.equal(up.status, 200);
  assert.equal(((await up.json()) as { url: string }).url, `${appBase}/api/media/f/markart/u1/new`);
  assert.deepEqual(JSON.parse(seen.at(-1)!.body), { kind: 'markart', contentType: 'image/png', size: ICON.length });
  assert.deepEqual(stored.get('markart-1')!.body, ICON);
  for (const h of [lucky, ro]) assert.equal((await fetch(`${base}/api/app/upload?kind=markart`, { method: 'POST', headers: { ...h, 'content-type': 'image/png' }, body: ICON })).status, 403);
  // Its stored file opens for the page.
  assert.equal((await fetch(`${base}/api/app/media/f/markart/u1/cam.png`, { headers: ops })).status, 200);
  // The app's refusals in its words: the pixel check, a kind in use, one that isn't there, the checker down.
  for (const [status, path, body, error] of [
    [400, '/api/app/mark-kinds', { kind: 'camur', name: 'Çamur', art: 'x' }, "İz resmi yüzü kapatıyor: ortadaki dairenin en çok %20'si dolu olabilir, bunda %64. Çizimi kenarlara alın, ortayı boş bırakın"],
    [409, '/api/app/mark-kinds', { kind: 'kaka', name: 'Kaka' }, '"kaka" türü zaten var (Kaka İzi); onu düzenleyin'],
    [409, '/api/app/mark-kinds/delete', { kind: 'kirik-cam' }, 'Bu türü kullanan hediyeler var: Terlik Geldi!, Cam Tamiri. Önce onların profil izi kuralını değiştirin ya da kaldırın.'],
    [404, '/api/app/mark-kinds/update', { kind: 'yok', name: 'Yok' }, 'İz türü bulunamadı'],
    [503, '/api/app/mark-kinds/update', { kind: 'camur', art: 'x' }, 'Sunucu iz resmini şu an denetleyemiyor; biraz sonra yeniden deneyin'],
  ] as const) {
    refuse = { status, error };
    const no = await call('POST', path, body, ops);
    refuse = null;
    assert.equal(no.status, status, error);
    assert.equal(no.json.error, error);
  }
  // A gift's rule names a kind and its time in minutes: as sent.
  const rule = { id: 'p8', enabled: true, mark: { role: 'leave', kind: 'kirik-cam', minutes: 1440 } };
  assert.equal((await call('POST', '/api/app/gifts/update', rule, ops)).status, 200);
  assert.deepEqual(JSON.parse(seen.at(-1)!.body), rule);
  refuse = { status: 400, error: `"camur" diye bir iz türü yok: önce Hediyeler › İz türleri'nden bu türü ekleyin` };
  const unknown = await call('POST', '/api/app/gifts', { name: 'Çamur Bombası', price: 500, cat: 'gameplay', icon: 'x', mark: { role: 'leave', kind: 'camur' } }, ops);
  refuse = null;
  assert.equal(unknown.status, 400);
  assert.match(unknown.json.error, /diye bir iz türü yok/);
});

test("uygulamanın PANEL_ROUTES'u: panelin çağırdığı her uç orada (uygulamanın deposu yanındaysa)", (t) => {
  // The app answers 403 to a route missing from its list, whatever this panel allows: both lists must have it. The
  // app's repo next to this one (cix), or FC_APP_REPO; elsewhere (CI of this repo alone) there is nothing to compare.
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const repo = process.env.FC_APP_REPO ?? resolve(root, '..', 'cix');
  const file = join(repo, 'server', 'api', 'panel.mjs');
  if (!existsSync(file)) return t.skip(`uygulamanın deposu yok: ${file}`);
  const src = readFileSync(file, 'utf8');
  const from = src.indexOf('export const PANEL_ROUTES');
  assert.ok(from >= 0, 'PANEL_ROUTES bulunamadı');
  const list = new Set([...src.slice(from, src.indexOf(']);', from)).matchAll(/'((?:GET|POST) \/api\/[^']+)'/g)].map((m) => m[1]));
  // APP_ROUTES and the calls made outside it (a file from a link, a frame's SVGA, the upload's address).
  const own = readFileSync(join(root, 'server', 'app-admin.ts'), 'utf8');
  const extra = [...own.matchAll(/appCall\(ctx, link, '(GET|POST)', '(\/api\/[^']+)'/g)].map((m) => `${m[1]} ${m[2]}`);
  assert.ok(extra.includes('POST /api/media/upload-url'));
  const missing = [...APP_ROUTES.map(([m, p]) => `${m} ${p}`), ...extra].filter((r) => !list.has(r));
  assert.deepEqual(missing, [], "uygulamanın PANEL_ROUTES'unda olmayan uçlar");
});

test('Emojiler: kendi yetkisiyle; paketler, çıkartmalar, sıra, orijinale dönme, resim yükleme ve bağlantıdan resim', async () => {
  env.as('operations_manager', 'ops@test.local');
  env.as('finance_manager', 'fin@test.local');
  env.as('read_only', 'ro@test.local');
  const ops = await loginAs('ops@test.local');
  const fin = await loginAs('fin@test.local');
  const ro = await loginAs('ro@test.local');
  for (const [method, path, body] of [
    ['GET', '/api/app/emoji', undefined],
    ['POST', '/api/app/emoji/packs', { name: 'Kedi Sarayı', price: 120 }],
    ['POST', '/api/app/emoji/packs/update', { id: 'fun', price: 70 }],
    ['POST', '/api/app/emoji/packs/reset', { id: 'fun' }],
    ['POST', '/api/app/emoji/packs/order', { ids: ['penguen', 'vip'] }],
    ['POST', '/api/app/emoji/packs/delete', { id: 'ep1' }],
    ['POST', '/api/app/emoji/stickers', { pack: 'ep1', name: 'Mırnav', art: 'x' }],
    ['POST', '/api/app/emoji/stickers/update', { id: 'vip-tac', name: 'Altın Taç' }],
    ['POST', '/api/app/emoji/stickers/reset', { id: 'vip-tac' }],
    ['POST', '/api/app/emoji/stickers/order', { pack: 'vip', ids: ['vip-elmas', 'vip-tac'] }],
    ['POST', '/api/app/emoji/stickers/delete', { id: 'es2' }],
  ] as const) {
    for (const h of [ops, fin]) assert.equal((await call(method, path, body, h)).status, 200, `${path}`);
    assert.equal(seen.at(-1)!.path, path.replace('/api/app/', '/api/admin/'));
    if (body) assert.deepEqual(JSON.parse(seen.at(-1)!.body), body);
    assert.equal((await call(method, path, body, ro)).status, 403, `salt okunur: ${path}`);
  }
  assert.ok(env.db.get("SELECT 1 FROM audit_logs WHERE action = 'app.emoji.packs.update'"));
  // A sticker's picture streams to the storage like a gift's icon; a Lottie (JSON) too.
  const res = await fetch(`${base}/api/app/upload?kind=stickerart`, { method: 'POST', headers: { ...ops, 'content-type': 'application/json' }, body: '{"v":"5.7.4"}' });
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(seen.at(-1)!.body), { kind: 'stickerart', contentType: 'application/json', size: 13 });
  assert.equal((await fetch(`${base}/api/app/upload?kind=stickerart`, { method: 'POST', headers: { ...ro, 'content-type': 'image/png' }, body: ICON })).status, 403);
  // From a link: the app downloads it; the address to save as it gave it, the preview through here.
  const got = await call('POST', '/api/app/emoji/fetch', { url: 'https://alanadi.com/emoji/kedi.png' }, ops);
  assert.equal(got.status, 200, JSON.stringify(got.json));
  assert.equal(got.json.preview, '/api/app/media/f/stickerart/u1/linked.png');
  assert.equal(seen.at(-1)!.path, '/api/admin/emoji/fetch');
  assert.ok(env.db.get("SELECT 1 FROM audit_logs WHERE action = 'app.emoji.fetch'"));
  assert.equal((await call('POST', '/api/app/emoji/fetch', { url: 'https://alanadi.com/x.png' }, ro)).status, 403);
  // The stored pictures open for whoever manages the emojis.
  assert.equal((await fetch(`${base}/api/app/media/f/stickerart/u1/x.png`, { headers: ops })).status, 200);
});

test('Mağaza: kendi yetkisiyle; eşyalar, sıra, orijinale dönme, çerçeve, balon, dalga ve koltuk rengi, resim ve giriş efekti videosu yükleme', async () => {
  env.as('operations_manager', 'ops@test.local');
  env.as('finance_manager', 'fin@test.local');
  env.as('read_only', 'ro@test.local');
  const ops = await loginAs('ops@test.local');
  const fin = await loginAs('fin@test.local');
  const ro = await loginAs('ro@test.local');
  for (const [method, path, body] of [
    ['GET', '/api/app/shop', undefined],
    ['POST', '/api/app/shop', { kind: 'frame', name: 'Gül Bahçesi', price: 500, days: 30, art: 'x' }],
    ['POST', '/api/app/shop/update', { id: 'fr-neon', price: 200, days: 14 }],
    ['POST', '/api/app/shop/reset', { id: 'fr-neon' }],
    ['POST', '/api/app/shop/order', { kind: 'frame', ids: ['sf1', 'fr-neon'] }],
    ['POST', '/api/app/shop/delete', { id: 'sf1' }],
    // A chat bubble with its picture's corners, and a voice wave: their look goes to the app as it is.
    ['POST', '/api/app/shop', { kind: 'bubble', name: 'Taçlı', price: 900, days: 30, art: 'x', look: { colors: ['#B45309', '#F59E0B'], text: '#1F1300', slice: { t: 40, r: 60, b: 40, l: 60 } } }],
    ['POST', '/api/app/shop/update', { id: 'sw2', art: null, look: { style: 'spin', colors: ['#00C2FF', '#0047FF', '#00FFB2'] } }],
    // A room's seat color: its color, price and days; the app's own colors change their color too.
    ['POST', '/api/app/shop', { kind: 'seat', name: 'Lacivert', price: 2500, days: 30, enabled: true, look: { color: '#1F2A5A' } }],
    ['POST', '/api/app/shop/update', { id: 'pembe', name: 'Açık Pembe', price: 2000, days: 0, enabled: true, look: { color: '#F4B6C8' } }],
  ] as const) {
    for (const h of [ops, fin]) assert.equal((await call(method, path, body, h)).status, 200, `${path}`);
    assert.equal(seen.at(-1)!.path, path.replace('/api/app/', '/api/admin/'));
    if (body) assert.deepEqual(JSON.parse(seen.at(-1)!.body), body);
    assert.equal((await call(method, path, body, ro)).status, 403, `salt okunur: ${path}`);
  }
  assert.ok(env.db.get("SELECT 1 FROM audit_logs WHERE action = 'app.shop.update'"));
  // A frame's picture, and an entry effect's video (the gift video kinds, open to whoever manages the shop too).
  for (const [kind, type] of [['shopframe', 'image/png'], ['giftsource', 'video/webm']] as const) {
    const res = await fetch(`${base}/api/app/upload?kind=${kind}`, { method: 'POST', headers: { ...ops, 'content-type': type }, body: ICON });
    assert.equal(res.status, 200, kind);
    assert.equal((await fetch(`${base}/api/app/upload?kind=${kind}`, { method: 'POST', headers: { ...ro, 'content-type': type }, body: ICON })).status, 403, `salt okunur ${kind}`);
  }
});

test('Seviyeler ve VIP: finans yöneticisinin yetkisiyle; kayıt ve sıfırlama denetim kaydına yazılır, önizleme yazılmaz', async () => {
  env.as('finance_manager', 'fin@test.local');
  env.as('operations_manager', 'ops@test.local');
  env.as('read_only', 'ro@test.local');
  const fin = await loginAs('fin@test.local');
  const ops = await loginAs('ops@test.local');
  const ro = await loginAs('ro@test.local');
  for (const [method, path, body] of [
    ['GET', '/api/app/levels', undefined],
    ['POST', '/api/app/levels/preview', { system: 'vip', doc: { levels: [{ level: 1, points: 600000, name: 'Bronz' }] } }],
    ['POST', '/api/app/levels/save', { system: 'noble', doc: { levels: [] }, rev: 3, confirm: true }],
    ['POST', '/api/app/levels/reset', { system: 'wealth', rev: 4, confirm: true }],
    ['GET', '/api/app/levels/drops?system=vip&limit=50', undefined],
  ] as const) {
    assert.equal((await call(method, path, body, fin)).status, 200, path);
    assert.equal(seen.at(-1)!.path, path.replace('/api/app/', '/api/admin/'));
    if (body) assert.deepEqual(JSON.parse(seen.at(-1)!.body), body);
    for (const h of [ops, ro]) assert.equal((await call(method, path, body, h)).status, 403, `yetkisiz: ${path}`);
  }
  assert.ok(env.db.get("SELECT 1 FROM audit_logs WHERE action = 'app.levels.save'"));
  assert.ok(env.db.get("SELECT 1 FROM audit_logs WHERE action = 'app.levels.reset'"));
  assert.ok(!env.db.get("SELECT 1 FROM audit_logs WHERE action = 'app.levels.preview'"), 'önizleme bir şey değiştirmez');
  // The app's refusal (a stale page, a confirm it asks for) comes back with its own sentence.
  refuse = { status: 409, error: 'Bu ayarı az önce başkası değiştirdi; sayfayı yenileyip tekrar dene' };
  try {
    const r = await call('POST', '/api/app/levels/save', { system: 'vip', doc: {}, rev: 1 }, fin);
    assert.deepEqual([r.status, r.json.error], [409, refuse.error]);
  } finally {
    refuse = null;
  }
});

test('Seviye ve görev ödülleri: Seviyeler ve VIP yetkisiyle; ekleme ve kaldırma denetim kaydına yazılır', async () => {
  env.as('finance_manager', 'fin@test.local');
  env.as('operations_manager', 'ops@test.local');
  env.as('read_only', 'ro@test.local');
  const fin = await loginAs('fin@test.local');
  const ops = await loginAs('ops@test.local');
  const ro = await loginAs('ro@test.local');
  for (const [method, path, body] of [
    ['GET', '/api/app/level-rewards', undefined],
    ['POST', '/api/app/level-rewards', { system: 'vip', level: 5, sku: 'fr-neon', days: 30 }],
    ['POST', '/api/app/level-rewards/delete', { id: 7 }],
    ['GET', '/api/app/task-rewards', undefined],
    ['POST', '/api/app/task-rewards', { task: 'call', sku: 'bb-candy', days: 1 }],
    ['POST', '/api/app/task-rewards/delete', { id: 3 }],
  ] as const) {
    assert.equal((await call(method, path, body, fin)).status, 200, path);
    assert.equal(seen.at(-1)!.path, path.replace('/api/app/', '/api/admin/'));
    if (body) assert.deepEqual(JSON.parse(seen.at(-1)!.body), body);
    for (const h of [ops, ro]) assert.equal((await call(method, path, body, h)).status, 403, `yetkisiz: ${path}`);
  }
  assert.ok(env.db.get("SELECT 1 FROM audit_logs WHERE action = 'app.level-rewards'"));
  assert.ok(env.db.get("SELECT 1 FROM audit_logs WHERE action = 'app.level-rewards.delete'"));
  assert.ok(env.db.get("SELECT 1 FROM audit_logs WHERE action = 'app.task-rewards'"));
});

test('daha önce kurulmuş rollere yeni yetki bir kez eklenir', () => {
  const { db } = setup();
  const ADDED: Record<string, string[]> = {
    finance_manager: ['app.gifts', 'app.emojis', 'app.shop', 'app.levels', 'app.withdrawals', 'app.payouts', 'app.refunds', 'app.lucky', 'app.rocket', 'app.settings', 'app.reports', 'app.agencies', 'app.agency_ledger'],
    operations_manager: ['app.gifts', 'app.emojis', 'app.shop', 'app.reports', 'app.users', 'app.complaints', 'app.support', 'app.notices', 'app.events'],
  };
  // A database made before 002–006, 008, 009 and 010: the roles without the app permissions.
  for (const [key, list] of Object.entries(ADDED)) {
    const perms: string[] = JSON.parse(db.value<string>('SELECT permissions FROM roles WHERE key = ?', key)!);
    db.run('UPDATE roles SET permissions = ? WHERE key = ?', JSON.stringify(perms.filter((p) => !list.includes(p))), key);
  }
  db.run(
    "DELETE FROM schema_migrations WHERE name IN ('002_app_permissions.sql', '003_app_finance_permissions.sql', '004_app_operations_permissions.sql', '005_app_agency_permissions.sql', '006_app_emoji_permissions.sql', '008_app_levels_permissions.sql', '009_app_shop_permissions.sql', '010_app_rocket_permissions.sql')",
  );
  db.migrate();
  db.migrate();
  for (const [key, list] of Object.entries(ADDED)) {
    const perms: string[] = JSON.parse(db.value<string>('SELECT permissions FROM roles WHERE key = ?', key)!);
    for (const p of list) assert.equal(perms.filter((x) => x === p).length, 1, `${key} ${p}`);
    // What the role had stays.
    assert.ok(perms.includes('dashboard.view'), key);
  }
  const ro: string[] = JSON.parse(db.value<string>("SELECT permissions FROM roles WHERE key = 'read_only'")!);
  assert.ok(!ro.some((p) => p.startsWith('app.')));
  const ops: string[] = JSON.parse(db.value<string>("SELECT permissions FROM roles WHERE key = 'operations_manager'")!);
  assert.ok(!ops.includes('app.withdrawals') && !ops.includes('app.settings') && !ops.includes('app.agencies') && !ops.includes('app.agency_ledger'));
  const fin: string[] = JSON.parse(db.value<string>("SELECT permissions FROM roles WHERE key = 'finance_manager'")!);
  assert.ok(!fin.includes('app.users') && !fin.includes('app.support'));
});
