import type { IncomingMessage, ServerResponse } from 'node:http';

export class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, message: string, code = 'error', details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const bad = (msg: string, details?: unknown) => new HttpError(400, msg, 'bad_request', details);
export const forbidden = (msg = 'Bu işlem için yetkiniz yok') => new HttpError(403, msg, 'forbidden');
export const notFound = (what = 'Kayıt') => new HttpError(404, `${what} bulunamadı`, 'not_found');
export const conflict = (msg: string, details?: unknown) => new HttpError(409, msg, 'conflict', details);

export type Req = {
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  body: any;
  headers: IncomingMessage['headers'];
  ip: string;
};
export type Handler<C> = (req: Req, ctx: C) => unknown | Promise<unknown>;
type Route<C> = { method: string; parts: string[]; handler: Handler<C>; perm?: string; public?: boolean };
export type RouteOpts = { perm?: string; public?: boolean };

export class Router<C> {
  routes: Route<C>[] = [];
  add(method: string, path: string, handler: Handler<C>, opts: RouteOpts = {}) {
    this.routes.push({ method, parts: path.split('/').filter(Boolean), handler, ...opts });
  }
  get = (p: string, h: Handler<C>, o?: RouteOpts) => this.add('GET', p, h, o);
  post = (p: string, h: Handler<C>, o?: RouteOpts) => this.add('POST', p, h, o);
  put = (p: string, h: Handler<C>, o?: RouteOpts) => this.add('PUT', p, h, o);
  del = (p: string, h: Handler<C>, o?: RouteOpts) => this.add('DELETE', p, h, o);

  match(method: string, path: string): { route: Route<C>; params: Record<string, string> } | null {
    const parts = path.split('/').filter(Boolean);
    for (const r of this.routes) {
      if (r.method !== method || r.parts.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < parts.length; i++) {
        if (r.parts[i].startsWith(':')) params[r.parts[i].slice(1)] = decodeURIComponent(parts[i]);
        else if (r.parts[i] !== parts[i]) {
          ok = false;
          break;
        }
      }
      if (ok) return { route: r, params };
    }
    return null;
  }
}

export async function readBody(req: IncomingMessage, limit = 10 * 1024 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new HttpError(413, 'İstek gövdesi çok büyük', 'too_large');
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** JSON.stringify that renders bigint as string so no precision is lost. */
export const toJson = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));

export function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const isText = typeof body === 'string' && headers['content-type'];
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(isText ? body : toJson(body));
}

export function cookies(h: IncomingMessage['headers']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (h.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// ---- input validation helpers -----------------------------------------------------
export function str(v: unknown, field: string, opts: { required?: boolean; max?: number } = {}): string | null {
  if (v === undefined || v === null || v === '') {
    if (opts.required) throw bad(`${field} zorunlu`);
    return null;
  }
  if (typeof v !== 'string' && typeof v !== 'number') throw bad(`${field} metin olmalı`);
  const s = String(v).trim();
  if (opts.max && s.length > opts.max) throw bad(`${field} en fazla ${opts.max} karakter`);
  if (opts.required && !s) throw bad(`${field} zorunlu`);
  return s;
}
export const reqStr = (v: unknown, field: string, max = 500) => str(v, field, { required: true, max }) as string;

export function int(v: unknown, field: string, opts: { required?: boolean; min?: number; max?: number } = {}): number | null {
  if (v === undefined || v === null || v === '') {
    if (opts.required) throw bad(`${field} zorunlu`);
    return null;
  }
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isSafeInteger(n)) throw bad(`${field} tam sayı olmalı`);
  if (opts.min !== undefined && n < opts.min) throw bad(`${field} en az ${opts.min}`);
  if (opts.max !== undefined && n > opts.max) throw bad(`${field} en fazla ${opts.max}`);
  return n;
}
export const reqInt = (v: unknown, field: string, o: { min?: number; max?: number } = {}) => int(v, field, { ...o, required: true }) as number;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
export function date(v: unknown, field: string, required = true): string | null {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`${field} zorunlu (YYYY-AA-GG)`);
    return null;
  }
  if (typeof v !== 'string' || !DATE_RE.test(v) || Number.isNaN(Date.parse(v + 'T00:00:00Z'))) throw bad(`${field} YYYY-AA-GG biçiminde olmalı`);
  return v;
}
/** ISO timestamp, normalised to UTC "…Z". Plain dates become midnight UTC. */
export function datetime(v: unknown, field: string): string {
  if (typeof v === 'string' && DATE_RE.test(v)) return v + 'T00:00:00.000Z';
  if (typeof v !== 'string' || !DATETIME_RE.test(v) || Number.isNaN(Date.parse(v))) throw bad(`${field} ISO tarih-saat olmalı (örn. 2026-10-01T12:00:00Z)`);
  return new Date(v).toISOString();
}
export function oneOf<T extends string>(v: unknown, field: string, allowed: readonly T[], def?: T): T {
  if ((v === undefined || v === null || v === '') && def !== undefined) return def;
  if (!allowed.includes(v as T)) throw bad(`${field} şunlardan biri olmalı: ${allowed.join(', ')}`);
  return v as T;
}
export const bool = (v: unknown) => v === true || v === 1 || v === '1' || v === 'true';
