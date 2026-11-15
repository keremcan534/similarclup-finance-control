// Uygulama: this panel acting on the Similar Club app's own admin API (cix server/api/panel.mjs), so the team runs
// the app from here (Hediyeler, …) with this panel's users and roles. The browser only ever talks to this server:
// it calls the app's API on the same machine with FC_APP_API_KEY, which never leaves the server, and names the
// panel user in X-Panel-User, so the app records who did it. Each page's routes are in APP_ROUTES with the
// permission they need here; the app keeps its own list of what the panel may call, so both must allow a route.
// Files (a gift's icon, video, SVGA) are streamed from the browser through here to the app's storage; stored files
// are read back through here too (the page's CSP allows only this origin).
//
//   FC_APP_API_URL   the app's API on this machine (http://127.0.0.1:7890); empty: the Uygulama pages are off
//   FC_APP_API_KEY   the app's PANEL_API_KEY
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { audit, can, need, type Ctx, type Permission } from './context.ts';
import { HttpError, bad, type Router } from './lib/http.ts';

export type AppLink = { url: string; key: string } | null;

/** The link from the environment; null (pages off) unless both are set. */
export function appLink(env: NodeJS.ProcessEnv = process.env): AppLink {
  const url = String(env.FC_APP_API_URL ?? '').trim().replace(/\/+$/, '');
  const key = String(env.FC_APP_API_KEY ?? '').trim();
  return /^https?:\/\/[^\s/]+$/.test(url) && key.length >= 32 ? { url, key } : null;
}

/**
 * [method, the app's path, the permission it needs here (or a list: any one of them)]. Served here at
 * /api/app/<the rest after /api/admin/>.
 */
export const APP_ROUTES: [string, string, Permission | Permission[]][] = [
  ['GET', '/api/admin/gifts', 'app.gifts'],
  ['POST', '/api/admin/gifts', 'app.gifts'],
  ['POST', '/api/admin/gifts/update', 'app.gifts'],
  ['POST', '/api/admin/gifts/delete', 'app.gifts'],
  ['POST', '/api/admin/gifts/order', 'app.gifts'],
  // Para çekme
  ['GET', '/api/admin/withdrawals', 'app.withdrawals'],
  ['POST', '/api/admin/withdrawals/decide', 'app.withdrawals'],
  // Ajans ödemeleri and the payout policy
  ['GET', '/api/admin/agency/payouts', 'app.payouts'],
  ['POST', '/api/admin/agency/payouts/decide', 'app.payouts'],
  // The agency network's rules: the payout policy for Ajans ödemeleri, the tiers and rates for Ajans merkezi.
  ['GET', '/api/admin/agency/settings', ['app.payouts', 'app.agencies', 'app.agency_ledger']],
  // İadeler and the wallet audit
  ['GET', '/api/admin/purchases', 'app.refunds'],
  ['POST', '/api/admin/purchases/refund', 'app.refunds'],
  ['POST', '/api/admin/purchases/voided-sync', 'app.refunds'],
  ['GET', '/api/admin/wallet/audit', 'app.refunds'],
  // Şanslı hediyeler
  ['GET', '/api/admin/lucky', 'app.lucky'],
  ['POST', '/api/admin/lucky/config', 'app.lucky'],
  // Canlı ayarlar
  ['GET', '/api/admin/live-settings', 'app.settings'],
  ['POST', '/api/admin/live-settings', 'app.settings'],
  ['GET', '/api/admin/live-settings/history', 'app.settings'],
  ['POST', '/api/admin/live-settings/rollback', 'app.settings'],
  // Reports and the app server's state
  ['GET', '/api/admin/casino/report', 'app.reports'],
  ['GET', '/api/admin/alerts', 'app.reports'],
  ['GET', '/api/admin/finance-sync', 'app.reports'],
  // Kullanıcılar: search, ban (and lifting it), room level, deleting, an invite's coins back
  ['GET', '/api/admin/users', 'app.users'],
  ['POST', '/api/admin/users/delete', 'app.users'],
  ['POST', '/api/admin/users/room-level', 'app.users'],
  ['POST', '/api/admin/ban', 'app.users'],
  ['POST', '/api/admin/referrals/revoke', 'app.users'],
  // Şikâyetler and a reported room's pictures
  ['GET', '/api/admin/reports', 'app.complaints'],
  ['POST', '/api/admin/reports/handle', 'app.complaints'],
  ['GET', '/api/admin/rooms/background', 'app.complaints'],
  ['POST', '/api/admin/rooms/background/remove', 'app.complaints'],
  ['POST', '/api/admin/rooms/cover/remove', 'app.complaints'],
  // Destek
  ['GET', '/api/admin/support', 'app.support'],
  ['GET', '/api/admin/support/ticket', 'app.support'],
  ['POST', '/api/admin/support/reply', 'app.support'],
  ['POST', '/api/admin/support/status', 'app.support'],
  // Duyurular
  ['GET', '/api/admin/team', 'app.notices'],
  ['POST', '/api/admin/team', 'app.notices'],
  ['POST', '/api/admin/team/remove', 'app.notices'],
  // Etkinlikler
  ['GET', '/api/admin/events', 'app.events'],
  ['POST', '/api/admin/events/review', 'app.events'],
  ['POST', '/api/admin/events/remove', 'app.events'],
  ['GET', '/api/admin/events/categories', 'app.events'],
  ['POST', '/api/admin/events/categories', 'app.events'],
  ['POST', '/api/admin/events/categories/remove', 'app.events'],
  ['GET', '/api/admin/events/report', 'app.events'],
  // Ajans merkezi: the tree and list, applications, status, rate, tier, parent, a streamer's agency, transfers and
  // transition commission, performance runs, reports, the simulator, the centre's audit log
  ['GET', '/api/admin/agency/tree', 'app.agencies'],
  ['GET', '/api/admin/agency/overview', 'app.agencies'],
  ['GET', '/api/admin/agency/list', 'app.agencies'],
  ['POST', '/api/admin/agency/create', 'app.agencies'],
  ['POST', '/api/admin/agency/decide', 'app.agencies'],
  ['POST', '/api/admin/agency/status', 'app.agencies'],
  ['POST', '/api/admin/agency/rate', 'app.agencies'],
  ['POST', '/api/admin/agency/tier', 'app.agencies'],
  ['POST', '/api/admin/agency/parent', 'app.agencies'],
  ['POST', '/api/admin/agency/assign', 'app.agencies'],
  ['GET', '/api/admin/agency/performance', 'app.agencies'],
  ['POST', '/api/admin/agency/performance/run', 'app.agencies'],
  ['GET', '/api/admin/agency/transfers', 'app.agencies'],
  ['POST', '/api/admin/agency/transfers/decide', 'app.agencies'],
  ['POST', '/api/admin/agency/transition', 'app.agencies'],
  ['GET', '/api/admin/agency/audit', 'app.agencies'],
  ['POST', '/api/admin/agency/simulate', 'app.agencies'],
  ['GET', '/api/admin/agency/report', 'app.agencies'],
  ['GET', '/api/admin/agency/bd-report', 'app.agencies'],
  // The agency commission ledger and the network's rules (critical): a recalculation, a manual income, a reversal,
  // an adjustment, closing a period, a setting
  ['POST', '/api/admin/agency/commissions/run', 'app.agency_ledger'],
  ['POST', '/api/admin/agency/income', 'app.agency_ledger'],
  ['POST', '/api/admin/agency/commissions/reverse', 'app.agency_ledger'],
  ['POST', '/api/admin/agency/adjust', 'app.agency_ledger'],
  ['POST', '/api/admin/agency/periods/close', 'app.agency_ledger'],
  ['POST', '/api/admin/agency/settings', 'app.agency_ledger'],
];
/** POSTs that only compute (nothing changes in the app): no row in this panel's audit log. */
const COMPUTE_ONLY = new Set(['/api/admin/agency/simulate']);
export const localPath = (appPath: string) => `/api/app${appPath.slice('/api/admin'.length)}`;
/** Upload kinds and the permission each needs (the app's media.mjs kinds). */
const UPLOADS: Record<string, Permission> = { gifticon: 'app.gifts', giftvideo: 'app.gifts', giftsource: 'app.gifts', notice: 'app.notices' };
/** The permissions that may open the app's stored files through here (every page that shows them). */
// The app serves these files to anyone with the address (media.mjs GET /api/media/f/…); the panel still asks for a
// page that shows them: gift art, a reported post's or room's picture, a ticket's photo, a notice's or event's picture.
const FILE_PERMS: Permission[] = ['app.gifts', 'app.complaints', 'app.support', 'app.notices', 'app.events'];

const off = () => new HttpError(503, 'Uygulama bağlantısı ayarlı değil: sunucuda FC_APP_API_URL ve FC_APP_API_KEY gerekli', 'app_off');

function panelHeaders(ctx: Ctx, link: NonNullable<AppLink>) {
  const u = ctx.user!;
  const who = Buffer.from(JSON.stringify({ id: u.id, email: u.email, name: u.name, role: u.role_key }), 'utf8').toString('base64url');
  return { 'x-panel-key': link.key, 'x-panel-user': who };
}

/** The app's addresses for its stored files and videos, as this server serves them (/api/app/media/f/…, /api/app/fx/…). */
const MEDIA = /^https?:\/\/[^/\s]+\/api\/media\/f\/([^\s"]+)$/;
export function localFiles(v: unknown): unknown {
  if (typeof v === 'string') {
    const m = MEDIA.exec(v);
    if (m) return `/api/app/media/f/${m[1]}`;
    return v.startsWith('/api/fx/') ? `/api/app/fx/${v.slice('/api/fx/'.length)}` : v;
  }
  if (Array.isArray(v)) return v.map(localFiles);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, localFiles(x)]));
  return v;
}

/** One call to the app's API as the signed-in panel user; its refusals come back with the app's own sentence. */
export async function appCall(ctx: Ctx, link: AppLink, method: string, path: string, body?: unknown, { raw = false, timeoutMs = 30_000 } = {}): Promise<any> {
  if (!link) throw off();
  let res: Response;
  try {
    res = await fetch(link.url + path, {
      method,
      headers: { ...panelHeaders(ctx, link), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new HttpError(502, 'Uygulama sunucusuna ulaşılamıyor', 'app_unreachable');
  }
  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text.slice(0, 200) };
  }
  if (res.status === 401) throw new HttpError(502, 'Uygulama sunucusu panelin anahtarını kabul etmedi (PANEL_API_KEY ile FC_APP_API_KEY aynı olmalı)', 'app_key');
  if (!res.ok) throw new HttpError(res.status, typeof data?.error === 'string' ? data.error : `Uygulama hatası (${res.status})`, 'app_error');
  return raw ? data : localFiles(data);
}

/** The /api/app/… routes of APP_ROUTES; a change is also a row in this panel's own audit log. */
export function appRoutes(r: Router<Ctx>, link: AppLink) {
  // A gift's file from a link (Hediyeler, "ya da bağlantı yapıştır"): the app downloads it once (up to 5 minutes for
  // a big source) and stores it as if uploaded. Answers the address to save as the app gave it, and `preview`, the
  // same file through this server.
  r.add('POST', '/api/app/gifts/fetch', async (req, ctx) => {
    need(ctx, 'app.gifts');
    const out = await appCall(ctx, link, 'POST', '/api/admin/gifts/fetch', req.body, { raw: true, timeoutMs: 330_000 });
    audit(ctx, 'app.gifts.fetch', 'app', null, null, { method: 'POST', path: '/api/admin/gifts/fetch', body: req.body });
    return { ...out, preview: localFiles(out.url) };
  });
  r.get('/api/app/status', (_req, ctx) => {
    if (!ctx.user) throw new HttpError(401, 'Oturum açmanız gerekiyor', 'unauthenticated');
    return { connected: !!link };
  });
  for (const [method, path, perm] of APP_ROUTES) {
    const perms = Array.isArray(perm) ? perm : [perm];
    r.add(method, localPath(path), async (req, ctx) => {
      if (!perms.some((p) => can(ctx, p))) need(ctx, perms[0]);
      const query = method === 'GET' ? req.query.toString() : '';
      const out = await appCall(ctx, link, method, `${path}${query ? `?${query}` : ''}`, method === 'GET' ? undefined : req.body);
      // A preview (Canlı ayarlar, a performance dry run: dryRun) or a calculation changes nothing: no row for it.
      if (method !== 'GET' && !COMPUTE_ONLY.has(path) && (req.body as { dryRun?: unknown } | null)?.dryRun !== true) {
        audit(ctx, `app${path.slice('/api/admin'.length).replace(/\//g, '.')}`, 'app', null, null, { method, path, body: req.body });
      }
      return out;
    });
  }
}

/**
 * POST /api/app/upload?kind=gifticon|giftvideo|giftsource: the request's body is the file (its type in
 * Content-Type, its size in Content-Length), streamed on to the address the app's storage gives, never held whole
 * here. Answers { url }: the address to save (the app checks the file when it is saved).
 */
export async function appUpload(req: IncomingMessage, ctx: Ctx, link: AppLink, url: URL) {
  const kind = url.searchParams.get('kind') ?? '';
  const perm = Object.hasOwn(UPLOADS, kind) ? UPLOADS[kind] : null;
  if (!perm) throw bad('Geçersiz yükleme türü');
  need(ctx, perm);
  if (!link) throw off();
  const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  const size = Number(req.headers['content-length']);
  if (!type) throw bad('Dosya türü bilinmiyor');
  if (!Number.isSafeInteger(size) || size < 1) throw new HttpError(411, 'Dosyanın boyutu bilinmiyor', 'length_required');
  const target = await appCall(ctx, link, 'POST', '/api/media/upload-url', { kind, contentType: type, size }, { raw: true });
  let put: Response;
  try {
    put = await fetch(target.uploadUrl, {
      method: 'PUT',
      headers: { ...target.headers, 'content-length': String(size) },
      body: Readable.toWeb(req) as ReadableStream,
      duplex: 'half',
      signal: AbortSignal.timeout(10 * 60_000),
    } as RequestInit);
  } catch {
    throw new HttpError(502, 'Dosya depoya yüklenemedi, tekrar deneyin', 'storage');
  }
  await put.body?.cancel().catch(() => {});
  if (!put.ok) throw new HttpError(502, `Dosya depoya yüklenemedi (${put.status})`, 'storage');
  audit(ctx, 'app.upload', 'app', null, null, { kind, type, size });
  return { url: target.publicUrl as string };
}

/** GET /api/app/media/f/<key> and /api/app/fx/<name>: an app file as it is (a `Range` passed on), for the pages. */
export async function appFile(req: IncomingMessage, res: ServerResponse, ctx: Ctx, link: AppLink, path: string) {
  if (!ctx.user) throw new HttpError(401, 'Oturum açmanız gerekiyor', 'unauthenticated');
  if (!FILE_PERMS.some((p) => ctx.user!.permissions.has(p))) throw new HttpError(403, 'Bu işlem için yetkiniz yok', 'forbidden');
  if (!link) throw off();
  const rest = path.startsWith('/api/app/media/f/') ? `/api/media/f/${path.slice('/api/app/media/f/'.length)}` : `/api/fx/${path.slice('/api/app/fx/'.length)}`;
  if (rest.includes('..')) throw bad('Geçersiz dosya');
  const range: Record<string, string> = typeof req.headers.range === 'string' && /^bytes=\d*-\d*$/.test(req.headers.range) ? { range: req.headers.range } : {};
  const query = new URL(req.url ?? '/', 'http://x').search;
  const ctl = new AbortController();
  res.on('close', () => ctl.abort());
  let up: Response;
  try {
    up = await fetch(link.url + rest + query, { headers: range, signal: ctl.signal });
  } catch {
    throw new HttpError(502, 'Uygulama sunucusuna ulaşılamıyor', 'app_unreachable');
  }
  if (![200, 206].includes(up.status) || !up.body) {
    await up.body?.cancel().catch(() => {});
    throw new HttpError(up.status === 404 ? 404 : 502, up.status === 404 ? 'Dosya bulunamadı' : 'Dosya açılamadı', 'app_file');
  }
  const head: Record<string, string> = { 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' };
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag']) {
    const v = up.headers.get(h);
    if (v) head[h] = v;
  }
  res.writeHead(up.status, head);
  try {
    await pipeline(Readable.fromWeb(up.body as any), res);
  } catch {
    res.destroy();
  }
}
