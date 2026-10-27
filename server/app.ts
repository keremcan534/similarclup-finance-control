import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { integrationForKey, loadUser, userForToken } from './auth.ts';
import type { Ctx } from './context.ts';
import type { Db } from './db.ts';
import { HttpError, cookies, readBody, send } from './lib/http.ts';
import { MoneyError } from './lib/money.ts';
import { buildRouter, type AppConfig } from './routes.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'web');
// Vendored ES modules served without a build step.
const VENDOR: Record<string, string> = {
  '/vendor/preact.mjs': 'node_modules/preact/dist/preact.module.js',
  '/vendor/hooks.mjs': 'node_modules/preact/hooks/dist/hooks.module.js',
  '/vendor/htm.mjs': 'node_modules/htm/dist/htm.module.js',
};
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};

function serveStatic(path: string, res: ServerResponse): boolean {
  let file: string | null = null;
  if (VENDOR[path]) file = join(ROOT, VENDOR[path]);
  else {
    const rel = path === '/' || !extname(path) ? 'index.html' : normalize(path).replace(/^[/\\]+/, '');
    const full = join(WEB, rel);
    if (!full.startsWith(WEB + sep) && full !== WEB) return false;
    file = full;
  }
  if (!existsSync(file) || !statSync(file).isFile()) return false;
  // The vendored preact hooks module imports "preact"; rewrite to our served path.
  let body: string | Buffer = readFileSync(file);
  if (path === '/vendor/hooks.mjs') body = body.toString('utf8').replace(/from\s*["']preact["']/g, 'from "./preact.mjs"');
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache', ...SECURITY_HEADERS });
  res.end(body);
  return true;
}

export function createApp(db: Db, cfg: AppConfig, now: () => Date = () => new Date()) {
  const router = buildRouter(cfg);

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';
    if (!url.pathname.startsWith('/api/')) {
      if (method === 'GET' && serveStatic(url.pathname, res)) return;
      return send(res, 404, { error: 'Bulunamadı' });
    }
    const ctx: Ctx = { db, user: null, integration: null, now };
    try {
      const m = router.match(method, url.pathname);
      if (!m) throw new HttpError(404, 'Uç nokta bulunamadı', 'not_found');
      const raw = method === 'GET' ? '' : await readBody(req);
      if (raw && !(req.headers['content-type'] ?? '').includes('application/json')) throw new HttpError(415, 'İstek gövdesi application/json olmalı', 'unsupported_media');
      let body: any = {};
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          throw new HttpError(400, 'Geçersiz JSON', 'bad_json');
        }
      }
      const bearer = (req.headers.authorization ?? '').startsWith('Bearer ') ? req.headers.authorization!.slice(7) : null;
      const token = bearer ?? cookies(req.headers).fc_session ?? null;
      if (token) ctx.user = userForToken(db, token, now());
      const apiKey = req.headers['x-api-key'];
      if (typeof apiKey === 'string') ctx.integration = integrationForKey(db, apiKey);
      // Local no-login mode: browser requests act as the first active super admin.
      if (cfg.noLogin && !ctx.user && typeof apiKey !== 'string') {
        const id = db.value<number>("SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.key = 'super_admin' AND u.active = 1 ORDER BY u.id LIMIT 1");
        if (id) ctx.user = loadUser(db, id);
      }
      if (!m.route.public && !ctx.user) throw new HttpError(401, 'Oturum açmanız gerekiyor', 'unauthenticated');
      const r = { method, path: url.pathname, query: url.searchParams, params: m.params, body, headers: req.headers, ip: req.socket.remoteAddress ?? '', sessionToken: token };
      const out: any = await m.route.handler(r as any, ctx);
      if (out && typeof out === 'object' && '__raw' in out)
        return send(res, 200, out.__raw, { 'content-type': out.__type, 'content-disposition': `attachment; filename="${out.__file}"` });
      const headers: Record<string, string> = {};
      if (out && typeof out === 'object' && '__cookie' in out) {
        headers['set-cookie'] = out.__cookie;
        delete out.__cookie;
      }
      send(res, 200, out ?? { ok: true }, headers);
    } catch (e: any) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message, code: e.code, details: e.details });
      if (e instanceof MoneyError) return send(res, 400, { error: e.message, code: 'invalid_number' });
      const msg = String(e?.message ?? e);
      if (/UNIQUE constraint failed/.test(msg)) return send(res, 409, { error: 'Bu kayıt zaten var (benzersiz alan çakışması)', code: 'duplicate' });
      if (/FOREIGN KEY constraint failed/.test(msg)) return send(res, 400, { error: 'İlişkili kayıt bulunamadı', code: 'foreign_key' });
      if (/değiştirilemez|silinemez|eklenemez/.test(msg)) return send(res, 409, { error: msg.replace(/^.*?: /, ''), code: 'immutable' });
      console.error(`[${new Date().toISOString()}] ${method} ${url.pathname}`, e);
      send(res, 500, { error: 'Sunucu hatası', code: 'internal' });
    }
  }

  return createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error(e);
      if (!res.headersSent) send(res, 500, { error: 'Sunucu hatası' });
    });
  });
}
