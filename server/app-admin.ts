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
  // Hediyeler: the admins' own and the app's own (?builtin=1 lists them, reset takes one back to the app's values).
  ['GET', '/api/admin/gifts', 'app.gifts'],
  ['POST', '/api/admin/gifts', 'app.gifts'],
  ['POST', '/api/admin/gifts/update', 'app.gifts'],
  ['POST', '/api/admin/gifts/reset', 'app.gifts'],
  ['POST', '/api/admin/gifts/delete', 'app.gifts'],
  ['POST', '/api/admin/gifts/order', 'app.gifts'],
  // Emojiler: the emoji panel's packs and stickers, the app's and the admins' own
  ['GET', '/api/admin/emoji', 'app.emojis'],
  ['POST', '/api/admin/emoji/packs', 'app.emojis'],
  ['POST', '/api/admin/emoji/packs/update', 'app.emojis'],
  ['POST', '/api/admin/emoji/packs/reset', 'app.emojis'],
  ['POST', '/api/admin/emoji/packs/delete', 'app.emojis'],
  ['POST', '/api/admin/emoji/packs/order', 'app.emojis'],
  ['POST', '/api/admin/emoji/stickers', 'app.emojis'],
  ['POST', '/api/admin/emoji/stickers/update', 'app.emojis'],
  ['POST', '/api/admin/emoji/stickers/reset', 'app.emojis'],
  ['POST', '/api/admin/emoji/stickers/delete', 'app.emojis'],
  ['POST', '/api/admin/emoji/stickers/order', 'app.emojis'],
  // Mağaza (the app's shop-items.mjs): frames and entry effects, the app's own and the team's (uploads shopframe, and
  // giftvideo / giftsource for an entry effect's video, as a gift's).
  ['GET', '/api/admin/shop', 'app.shop'],
  ['POST', '/api/admin/shop', 'app.shop'],
  ['POST', '/api/admin/shop/update', 'app.shop'],
  ['POST', '/api/admin/shop/reset', 'app.shop'],
  ['POST', '/api/admin/shop/delete', 'app.shop'],
  ['POST', '/api/admin/shop/order', 'app.shop'],
  // Seviyeler ve VIP (the app's levels-admin.mjs): every system's settings, the change preview, saving (a drop asks
  // for a confirm first), back to today's values, the level drops.
  // Oda roketi (the app's room-rocket.mjs): on / off, the levels' goals and prizes, the last launches.
  ['GET', '/api/admin/rocket', 'app.rocket'],
  ['POST', '/api/admin/rocket/config', 'app.rocket'],
  ['POST', '/api/admin/rocket/video', 'app.rocket'],
  ['GET', '/api/admin/levels', 'app.levels'],
  ['POST', '/api/admin/levels/preview', 'app.levels'],
  ['POST', '/api/admin/levels/save', 'app.levels'],
  ['POST', '/api/admin/levels/reset', 'app.levels'],
  ['GET', '/api/admin/levels/drops', 'app.levels'],
  // Seviye ödülleri (the app's level-rewards.mjs): an item that goes into the bag of whoever reaches a VIP, Cömertlik
  // or Yankı level; adding one, taking one off (given items stay where they are).
  ['GET', '/api/admin/level-rewards', 'app.levels'],
  ['POST', '/api/admin/level-rewards', 'app.levels'],
  ['POST', '/api/admin/level-rewards/delete', 'app.levels'],
  // Görev ödülleri (the app's task-rewards.mjs): an item that goes into the bag of whoever takes a task's reward.
  ['GET', '/api/admin/task-rewards', 'app.levels'],
  ['POST', '/api/admin/task-rewards', 'app.levels'],
  ['POST', '/api/admin/task-rewards/delete', 'app.levels'],
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
  // Şanslı hediyeler: the packages (a new one too: up to 20, each with its odds), the daily limit, the announcement;
  // each package's own icon and video (the app's lucky-art.mjs; uploads and a link as a gift's: gifticon, giftvideo,
  // giftsource, POST /api/app/lucky/fetch below).
  ['GET', '/api/admin/lucky', 'app.lucky'],
  ['POST', '/api/admin/lucky/config', 'app.lucky'],
  ['POST', '/api/admin/lucky/art', 'app.lucky'],
  ['POST', '/api/admin/lucky/art/remove', 'app.lucky'],
  // Canlı ayarlar
  ['GET', '/api/admin/live-settings', 'app.settings'],
  ['POST', '/api/admin/live-settings', 'app.settings'],
  ['GET', '/api/admin/live-settings/history', 'app.settings'],
  ['POST', '/api/admin/live-settings/rollback', 'app.settings'],
  // Reports and the app server's state
  ['GET', '/api/admin/casino/report', 'app.reports'],
  ['GET', '/api/admin/alerts', 'app.reports'],
  ['GET', '/api/admin/finance-sync', 'app.reports'],
  ['GET', '/api/admin/money-check', 'app.reports'],
  // Kullanıcılar: search, ban (and lifting it), room level, deleting, an invite's coins back
  ['GET', '/api/admin/users', 'app.users'],
  // An account by the ID on the person's profile in the app (their own number): every page's account fields
  ['GET', '/api/admin/lookup', ['app.users', 'app.refunds', 'app.notices', 'app.agencies', 'app.agency_ledger', 'app.agency_staff', 'app.sanctions', 'app.sanctions_full', 'app.economy', 'app.jeton']],
  ['POST', '/api/admin/users/delete', 'app.users'],
  ['POST', '/api/admin/users/room-level', 'app.users'],
  // Profil izleri (the app's profile-marks.mjs): a person's marks (who left each, until when, how it came off), and
  // taking the ones showing off (all or one kind) with a reason. Kullanıcılar, and a reported person in Şikâyetler.
  ['GET', '/api/admin/marks', 'app.users'],
  ['POST', '/api/admin/marks/clear', 'app.users'],
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
  ['POST', '/api/admin/events/reward', 'app.events'],
  ['GET', '/api/admin/events/categories', 'app.events'],
  ['POST', '/api/admin/events/categories', 'app.events'],
  ['POST', '/api/admin/events/categories/remove', 'app.events'],
  ['GET', '/api/admin/events/report', 'app.events'],
  // Ajans merkezi: the tree and list, applications, status, rate, tier, parent, a streamer's agency, transfers and
  // transition commission, performance runs, reports, the simulator, the centre's audit log
  ['GET', '/api/admin/agency/tree', 'app.agencies'],
  ['GET', '/api/admin/agency/overview', 'app.agencies'],
  // The list also serves Ajans personeli's agency search (BD, operations score, violations).
  ['GET', '/api/admin/agency/list', ['app.agencies', 'app.agency_staff']],
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
  // Ajans merkezi's staff: roles and who holds them, BD assignment, operations score, violations and appeals, the
  // background jobs run now
  ['GET', '/api/admin/agency/roles', 'app.agency_staff'],
  ['POST', '/api/admin/agency/roles', 'app.agency_staff'],
  ['GET', '/api/admin/agency/staff', 'app.agency_staff'],
  ['POST', '/api/admin/agency/staff/set', 'app.agency_staff'],
  ['POST', '/api/admin/agency/staff/remove', 'app.agency_staff'],
  ['POST', '/api/admin/agency/bd', 'app.agency_staff'],
  ['POST', '/api/admin/agency/ops-score', 'app.agency_staff'],
  ['POST', '/api/admin/agency/violation', 'app.agency_staff'],
  ['GET', '/api/admin/agency/appeals', 'app.agency_staff'],
  ['POST', '/api/admin/agency/appeals/decide', 'app.agency_staff'],
  ['POST', '/api/admin/agency/jobs/run', 'app.agency_staff'],
  // Yaptırımlar: a moderator's permissions or all of them; the app decides which sanction each may give from the
  // permissions sent with the request (panelHeaders perms). The policies, who may do what, a device's risk: all only.
  ['GET', '/api/admin/sanctions/meta', ['app.sanctions', 'app.sanctions_full']],
  ['GET', '/api/admin/sanctions/search', ['app.sanctions', 'app.sanctions_full']],
  ['GET', '/api/admin/sanctions/user', ['app.sanctions', 'app.sanctions_full']],
  ['GET', '/api/admin/sanctions/pending', ['app.sanctions', 'app.sanctions_full']],
  ['POST', '/api/admin/sanctions', ['app.sanctions', 'app.sanctions_full']],
  ['POST', '/api/admin/sanctions/lift', ['app.sanctions', 'app.sanctions_full']],
  ['POST', '/api/admin/sanctions/approve', 'app.sanctions_full'],
  ['POST', '/api/admin/sanctions/evidence', ['app.sanctions', 'app.sanctions_full']],
  ['GET', '/api/admin/appeals', ['app.sanctions', 'app.sanctions_full']],
  ['POST', '/api/admin/appeals/decide', ['app.sanctions', 'app.sanctions_full']],
  ['POST', '/api/admin/sanction-policies', 'app.sanctions_full'],
  ['GET', '/api/admin/sanction-permissions', 'app.sanctions_full'],
  ['POST', '/api/admin/sanction-permissions', 'app.sanctions_full'],
  ['POST', '/api/admin/devices/risk', 'app.sanctions_full'],
  // A person's shop items: what they own, giving one, taking one back, the items a refund left to review
  ['GET', '/api/admin/economy/user', 'app.economy'],
  ['POST', '/api/admin/economy/grant', 'app.economy'],
  ['POST', '/api/admin/economy/revoke', 'app.economy'],
  ['GET', '/api/admin/economy/reviews', ['app.economy', 'app.refunds']],
  // Jeton Noktası: an account made a bank or back, a bank's stock sold to it (critical)
  ['POST', '/api/admin/jeton/bank', 'app.jeton'],
  ['POST', '/api/admin/jeton/wholesale', 'app.jeton'],
];
/** POSTs that only compute (nothing changes in the app): no row in this panel's audit log. */
const COMPUTE_ONLY = new Set(['/api/admin/agency/simulate', '/api/admin/levels/preview']);
export const localPath = (appPath: string) => `/api/app${appPath.slice('/api/admin'.length)}`;
/** Upload kinds and the permission each needs (the app's media.mjs kinds). */
const UPLOADS: Record<string, Permission[]> = {
  // A gift's icon, and a Şanslı package's (the app checks it as a gift's).
  gifticon: ['app.gifts', 'app.lucky'],
  // A gift's video, a shop entry effect's, a frame's SVGA, a room rocket level's and a Şanslı package's (the app's
  // converter makes them all).
  giftvideo: ['app.gifts', 'app.shop', 'app.rocket', 'app.lucky'],
  giftsource: ['app.gifts', 'app.shop', 'app.rocket', 'app.lucky'],
  stickerart: ['app.emojis'],
  shopframe: ['app.shop'],
  notice: ['app.notices'],
};
/** The permissions that may open the app's stored files through here (every page that shows them). */
// The app serves these files to anyone with the address (media.mjs GET /api/media/f/…); the panel still asks for a
// page that shows them: gift art, a Şanslı package's icon and video, a reported post's or room's picture, a ticket's
// photo, a notice's or event's picture.
const FILE_PERMS: Permission[] = ['app.gifts', 'app.lucky', 'app.emojis', 'app.shop', 'app.complaints', 'app.support', 'app.notices', 'app.events'];

const off = () => new HttpError(503, 'Uygulama bağlantısı ayarlı değil: sunucuda FC_APP_API_URL ve FC_APP_API_KEY gerekli', 'app_off');

function panelHeaders(ctx: Ctx, link: NonNullable<AppLink>) {
  const u = ctx.user!;
  // perms: this user's Uygulama permissions, for the app's rules that go finer than a page (sanctions.mjs permsOf).
  const perms = [...u.permissions].filter((p) => p.startsWith('app.')).sort();
  const who = Buffer.from(JSON.stringify({ id: u.id, email: u.email, name: u.name, role: u.role_key, perms }), 'utf8').toString('base64url');
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
    // The app's server gives a video's link up to 10 minutes (a source up to 500 MB from the client's site).
    const out = await appCall(ctx, link, 'POST', '/api/admin/gifts/fetch', req.body, { raw: true, timeoutMs: 630_000 });
    audit(ctx, 'app.gifts.fetch', 'app', null, null, { method: 'POST', path: '/api/admin/gifts/fetch', body: req.body });
    return { ...out, preview: localFiles(out.url) };
  });
  // A Şanslı package's icon or video from a link (Şanslı hediye ayarı): the app's server fetches it as a gift's (the
  // same checks and time); the address to save, and its preview through this server.
  r.add('POST', '/api/app/lucky/fetch', async (req, ctx) => {
    need(ctx, 'app.lucky');
    const out = await appCall(ctx, link, 'POST', '/api/admin/lucky/fetch', req.body, { raw: true, timeoutMs: 630_000 });
    audit(ctx, 'app.lucky.fetch', 'app', null, null, { method: 'POST', path: '/api/admin/lucky/fetch', body: req.body });
    return { ...out, preview: localFiles(out.url) };
  });
  // A frame's SVGA (Mağaza): the app's server turns it into the still picture and the moving WebP while this waits.
  r.add('POST', '/api/app/shop/frame-svga', async (req, ctx) => {
    need(ctx, 'app.shop');
    const out = await appCall(ctx, link, 'POST', '/api/admin/shop/frame-svga', req.body, { raw: true, timeoutMs: 270_000 });
    audit(ctx, 'app.shop.frame-svga', 'app', null, null, { method: 'POST', path: '/api/admin/shop/frame-svga', body: req.body });
    return { ...out, artPreview: localFiles(out.art), motionPreview: localFiles(out.motion) };
  });
  // A sticker's picture from a link (Emojiler): the same, for a PNG, WebP or Lottie JSON of at most 512 KB.
  r.add('POST', '/api/app/emoji/fetch', async (req, ctx) => {
    need(ctx, 'app.emojis');
    const out = await appCall(ctx, link, 'POST', '/api/admin/emoji/fetch', req.body, { raw: true, timeoutMs: 90_000 });
    audit(ctx, 'app.emoji.fetch', 'app', null, null, { method: 'POST', path: '/api/admin/emoji/fetch', body: req.body });
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
  const perms = Object.hasOwn(UPLOADS, kind) ? UPLOADS[kind] : null;
  if (!perms) throw bad('Geçersiz yükleme türü');
  if (!perms.some((p) => can(ctx, p))) need(ctx, perms[0]);
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
      // A video source up to 500 MB from a home connection: half an hour.
      signal: AbortSignal.timeout(30 * 60_000),
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
