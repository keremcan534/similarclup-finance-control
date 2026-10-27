// Restores a backup over the configured database. Stop the server first.
//   npm run restore -- data/backups/finance-....db
// The current database is kept next to it as finance.db.before-restore-<zaman>.
import { copyFileSync, existsSync, renameSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

import { config } from '../config.ts';
import { verifyAuditChain } from '../context.ts';
import { openDb } from '../db.ts';

const src = process.argv[2];
if (!src || !existsSync(resolve(src))) {
  console.error('Kullanım: npm run restore -- <yedek.db>');
  process.exit(1);
}
const cfg = config();
const check = openDb(resolve(src));
const integrity = check.value<string>('PRAGMA integrity_check');
const chain = verifyAuditChain(check);
check.close();
if (integrity !== 'ok' || !chain.ok) {
  console.error(`Yedek bozuk, geri yüklenmedi: integrity=${integrity}, audit=${JSON.stringify(chain)}`);
  process.exit(1);
}
if (existsSync(cfg.dbPath)) {
  const keep = `${cfg.dbPath}.before-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  renameSync(cfg.dbPath, keep);
  for (const ext of ['-wal', '-shm']) if (existsSync(cfg.dbPath + ext)) rmSync(cfg.dbPath + ext);
  console.log(`Mevcut veritabanı saklandı: ${keep}`);
}
copyFileSync(resolve(src), cfg.dbPath);
console.log(`Geri yüklendi: ${src} → ${cfg.dbPath}`);
