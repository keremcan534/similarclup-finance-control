import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Loads .env (KEY=VALUE lines) without overriding real environment variables. */
export function loadEnv() {
  const f = join(ROOT, '.env');
  if (!existsSync(f)) return;
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

export function config() {
  loadEnv();
  const dataDir = resolve(ROOT, process.env.FC_DATA_DIR ?? 'data');
  mkdirSync(dataDir, { recursive: true });
  const host = process.env.FC_HOST ?? '127.0.0.1';
  const noLogin = process.env.FC_NO_LOGIN === '1';
  // Without login anyone who can reach the port is a super admin, so it is local-only.
  if (noLogin && !['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('FC_NO_LOGIN=1 yalnız FC_HOST=127.0.0.1 ile kullanılabilir');
  return {
    port: Number(process.env.FC_PORT ?? 4300),
    host,
    dataDir,
    dbPath: resolve(dataDir, process.env.FC_DB_FILE ?? 'finance.db'),
    cookieSecure: process.env.FC_COOKIE_SECURE === '1',
    noLogin,
  };
}
