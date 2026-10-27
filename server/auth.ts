import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import type { Db } from './db.ts';
import type { Ctx, User } from './context.ts';
import { HttpError } from './lib/http.ts';

const SESSION_HOURS = 12;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function hashPassword(pw: string): string {
  if (pw.length < 10) throw new HttpError(400, 'Parola en az 10 karakter olmalı', 'weak_password');
  const salt = randomBytes(16);
  const h = scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$${salt.toString('base64')}$${h.toString('base64')}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, n, salt, hash] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const got = scryptSync(pw, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: 8, p: 1 });
  return timingSafeEqual(expected, got);
}

// ---- TOTP (RFC 6238) — optional second factor ------------------------------------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function newTotpSecret(): string {
  return [...randomBytes(20)].map((b) => B32[b & 31]).join('');
}
function b32decode(s: string): Buffer {
  let bits = '';
  for (const c of s.replace(/=+$/, '').toUpperCase()) bits += B32.indexOf(c).toString(2).padStart(5, '0');
  const out: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
export function totp(secret: string, at = Date.now(), step = 30): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / step)));
  const h = createHmac('sha1', b32decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  const code = (h.readUInt32BE(o) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, '0');
}
export function verifyTotp(secret: string, code: string, at = Date.now()): boolean {
  return [-1, 0, 1].some((w) => totp(secret, at + w * 30_000) === code);
}

// ---- users & sessions ----------------------------------------------------------------
export function loadUser(db: Db, id: number): User | null {
  const r = db.get(
    `SELECT u.id, u.email, u.name, u.agency_id, u.active, r.key AS role_key, r.name AS role_name, r.scope, r.permissions
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
    id,
  );
  if (!r || !r.active) return null;
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    role_key: r.role_key,
    role_name: r.role_name,
    scope: r.scope,
    agency_id: r.agency_id,
    permissions: new Set(JSON.parse(r.permissions)),
  };
}

export function login(ctx: Ctx, email: string, password: string, code?: string): { token: string; user: User } {
  const { db } = ctx;
  const u = db.get('SELECT * FROM users WHERE email = ?', email);
  const now = ctx.now();
  const fail = () => new HttpError(401, 'E-posta veya parola hatalı', 'invalid_login');
  if (!u || !u.active) throw fail();
  if (u.locked_until && new Date(u.locked_until) > now) throw new HttpError(429, 'Çok fazla hatalı deneme. Hesap geçici olarak kilitli.', 'locked');
  if (!verifyPassword(password, u.password_hash)) {
    const fails = u.failed_logins + 1;
    const lock = fails >= MAX_FAILS ? new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString() : null;
    db.run('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?', lock ? 0 : fails, lock, u.id);
    throw fail();
  }
  if (u.mfa_secret) {
    if (!code) throw new HttpError(401, 'Doğrulama kodu gerekli', 'mfa_required');
    if (!verifyTotp(u.mfa_secret, code, now.getTime())) throw new HttpError(401, 'Doğrulama kodu hatalı', 'mfa_invalid');
  }
  db.run('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?', u.id);
  const token = randomBytes(32).toString('base64url');
  db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', sha256(token), u.id, new Date(now.getTime() + SESSION_HOURS * 3600_000).toISOString());
  db.run('DELETE FROM sessions WHERE expires_at < ?', now.toISOString());
  return { token, user: loadUser(db, u.id)! };
}

export function userForToken(db: Db, token: string, now: Date): User | null {
  const s = db.get('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?', sha256(token));
  if (!s || new Date(s.expires_at) < now) return null;
  return loadUser(db, s.user_id);
}

export function logout(db: Db, token: string) {
  db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
}

// ---- integration API keys ---------------------------------------------------------
/** Returns the plaintext key once; only its hash is stored. Format: fc_<prefix>_<secret>. */
export function newApiKey(): { key: string; prefix: string; hash: string } {
  const prefix = randomBytes(4).toString('hex');
  const key = `fc_${prefix}_${randomBytes(24).toString('base64url')}`;
  return { key, prefix, hash: sha256(key) };
}

export function integrationForKey(db: Db, key: string): { id: number; code: string } | null {
  const m = /^fc_([0-9a-f]{8})_/.exec(key);
  if (!m) return null;
  const r = db.get('SELECT id, code, key_hash, status FROM integration_connections WHERE key_prefix = ?', m[1]);
  if (!r || r.status === 'disabled' || !r.key_hash) return null;
  const a = Buffer.from(r.key_hash, 'hex');
  const b = Buffer.from(sha256(key), 'hex');
  return a.length === b.length && timingSafeEqual(a, b) ? { id: r.id, code: r.code } : null;
}
