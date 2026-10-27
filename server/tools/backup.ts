// Consistent online backup: VACUUM INTO writes a self-contained copy even while the server runs.
//   npm run backup            → data/backups/finance-<zaman>.db
//   npm run backup -- yol.db  → given path
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { config } from '../config.ts';
import { verifyAuditChain } from '../context.ts';
import { openDb } from '../db.ts';

const cfg = config();
const target = resolve(process.argv[2] ?? join(cfg.dataDir, 'backups', `finance-${new Date().toISOString().replace(/[:.]/g, '-')}.db`));
mkdirSync(dirname(target), { recursive: true });
const db = openDb(cfg.dbPath);
db.raw.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
db.close();

// Verify the copy opens, passes integrity check and has an intact audit chain.
const copy = openDb(target);
const integrity = copy.value<string>('PRAGMA integrity_check');
const chain = verifyAuditChain(copy);
copy.close();
if (integrity !== 'ok' || !chain.ok) {
  console.error(`Yedek doğrulanamadı: integrity=${integrity}, audit=${JSON.stringify(chain)}`);
  process.exit(1);
}
console.log(`Yedek alındı ve doğrulandı: ${target} (denetim zinciri ${chain.count} kayıt)`);
