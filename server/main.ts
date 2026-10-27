import { config } from './config.ts';
import type { Ctx } from './context.ts';
import { openDb } from './db.ts';
import { createApp } from './app.ts';
import { bootstrap, saveCredentials } from './bootstrap.ts';
import { evaluateAlerts } from './domain/alerts.ts';
import { generateRecurring } from './domain/costs.ts';

const cfg = config();
const db = openDb(cfg.dbPath);
const admin = bootstrap(db);
if (admin) console.log(`İlk yönetici oluşturuldu. Giriş bilgileri: ${saveCredentials(cfg.dataDir, [{ role: 'Süper yönetici', ...admin }])}`);

createApp(db, cfg).listen(cfg.port, cfg.host, () => {
  console.log(`Similarclup Finance Control → http://${cfg.host}:${cfg.port}  (veritabanı: ${cfg.dbPath})`);
});

// Hourly housekeeping as the "system" actor: due recurring expenses and threshold alerts.
const system: Ctx = { db, user: null, integration: null, now: () => new Date() };
const housekeeping = () => {
  try {
    const created = generateRecurring(system, new Date().toISOString().slice(0, 10));
    const alerts = evaluateAlerts(system);
    if (created || alerts.created) console.log(`[${new Date().toISOString()}] ${created} tekrarlanan gider, ${alerts.created} yeni uyarı`);
    for (const e of alerts.errors) console.warn('Uyarı kontrolü hatası:', e);
  } catch (e) {
    console.error('Periyodik kontrol hatası', e);
  }
};
setTimeout(housekeeping, 5_000);
setInterval(housekeeping, 60 * 60_000).unref();

const stop = () => {
  db.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
