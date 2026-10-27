// Reference data every installation needs: roles, currencies, default categories, the
// Similar Club connection placeholder and the first super admin. Contains no financial data.

import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { hashPassword } from './auth.ts';
import { ALL_PERMISSIONS, DEFAULT_SETTINGS } from './context.ts';
import type { Db } from './db.ts';

const VIEW = ['dashboard.view', 'ledger.view', 'rules.view', 'parties.view', 'statements.view', 'costs.view', 'lucky.view', 'expenses.view', 'reports.view', 'alerts.view'];

export const SYSTEM_ROLES: { key: string; name: string; scope: 'platform' | 'agency'; permissions: string[] }[] = [
  { key: 'super_admin', name: 'Süper yönetici', scope: 'platform', permissions: ALL_PERMISSIONS },
  {
    key: 'finance_manager',
    name: 'Finans yöneticisi',
    scope: 'platform',
    permissions: [
      ...VIEW,
      'ledger.write',
      'rules.edit',
      'rules.activate',
      'parties.edit',
      'statements.calculate',
      'statements.approve',
      'payouts.record',
      'channels.edit',
      'costs.edit',
      'catalog.edit',
      'expenses.edit',
      'reports.export',
      'periods.close',
      'alerts.manage',
      'simulation.use',
      'audit.view',
    ],
  },
  { key: 'operations_manager', name: 'Operasyon yöneticisi', scope: 'platform', permissions: ['dashboard.view', 'parties.view', 'costs.view', 'lucky.view', 'reports.view', 'alerts.view', 'simulation.use'] },
  { key: 'agency_manager', name: 'Ajans yöneticisi', scope: 'agency', permissions: ['parties.view', 'statements.view', 'reports.view'] },
  { key: 'read_only', name: 'Salt okunur', scope: 'platform', permissions: ['dashboard.view', 'reports.view'] },
];

const CURRENCIES = [
  ['TRY', 'Türk lirası', 2, 'fiat'],
  ['USD', 'ABD doları', 2, 'fiat'],
  ['EUR', 'Euro', 2, 'fiat'],
  ['COIN', 'Similar Club jetonu', 0, 'virtual'],
  ['DIAMOND', 'Elmas (yayıncı kazancı)', 0, 'virtual'],
] as const;

const EXPENSE_CATEGORIES: [string, 'fixed' | 'variable'][] = [
  ['Yönetici maaşları', 'fixed'],
  ['Yazılım ve bakım', 'fixed'],
  ['Müşteri desteği', 'fixed'],
  ['Moderasyon', 'variable'],
  ['Muhasebe ve hukuk', 'fixed'],
  ['Reklam', 'variable'],
  ['Kullanıcı kazanımı', 'variable'],
  ['Ajans edinme', 'variable'],
  ['Ofis ve idari giderler', 'fixed'],
  ['Banka ve finansman giderleri', 'variable'],
  ['Vergi ve resmi yükümlülükler', 'fixed'],
  ['Donanım ve lisans', 'fixed'],
  ['Beklenmeyen giderler', 'variable'],
];

export const randomPassword = () => randomBytes(12).toString('base64url');
export const randomEmail = (prefix: string) => `${prefix}-${randomBytes(4).toString('hex')}@similarclup.local`;

/**
 * Writes generated login credentials to <dataDir>/giris-bilgileri.txt (data/ is git-ignored) instead of
 * echoing them, so they are not left in logs. Readable only by the current user where the OS allows it.
 */
export function saveCredentials(dataDir: string, rows: { role: string; email: string; password: string }[]): string {
  const file = join(dataDir, 'giris-bilgileri.txt');
  const body = [
    `# Similarclup Finance Control — oluşturulan giriş bilgileri (${new Date().toISOString()})`,
    '# İlk girişten sonra Hesabım → Parola değiştir ile değiştirin ve bu dosyayı silin.',
    '',
    ...rows.map((r) => `${r.role.padEnd(22)} ${r.email.padEnd(42)} ${r.password}`),
    '',
  ].join('\n');
  writeFileSync(file, body, { encoding: 'utf8', mode: 0o600 });
  return file;
}

/** Idempotent. Returns the generated admin credentials when it had to create the first user. */
export function bootstrap(db: Db, admin?: { email: string; password: string }): { email: string; password: string } | null {
  return db.tx(() => {
    for (const r of SYSTEM_ROLES) {
      const existing = db.get('SELECT id FROM roles WHERE key = ?', r.key);
      if (!existing) db.run('INSERT INTO roles (key, name, scope, permissions, system) VALUES (?,?,?,?,1)', r.key, r.name, r.scope, JSON.stringify(r.permissions));
      else if (r.key === 'super_admin') db.run('UPDATE roles SET permissions = ? WHERE id = ?', JSON.stringify(r.permissions), existing.id);
    }
    for (const c of CURRENCIES) db.run('INSERT OR IGNORE INTO currencies (code, name, decimals, kind) VALUES (?,?,?,?)', ...c);
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?,?)', k, v);
    for (const [n, nature] of EXPENSE_CATEGORIES) db.run('INSERT OR IGNORE INTO expense_categories (name, nature) VALUES (?,?)', n, nature);
    db.run("INSERT OR IGNORE INTO integration_connections (code, name, kind, status, config) VALUES ('similarclub', 'Similar Club uygulaması', 'rest_api', 'not_connected', '{}')");
    if (!db.value<number>('SELECT COUNT(*) FROM alert_rules')) {
      const add = (kind: string, name: string, params: object, sev: string) => db.run('INSERT INTO alert_rules (kind, name, params, severity) VALUES (?,?,?,?)', kind, name, JSON.stringify(params), sev);
      add('commission_over_limit', 'Komisyon toplamı dağıtılabilir tutarı aşıyor', {}, 'critical');
      add('inconsistent_balance', 'Tutarsız bakiye / hesaplama sorunu', {}, 'critical');
      add('integration_down', 'Entegrasyon 6 saattir veri göndermiyor', { hours: '6' }, 'warning');
      add('lucky_reserve', 'Lucky ödül rezervi', {}, 'warning');
      add('negative_result', 'Negatif işletme sonucu', {}, 'warning');
      add('due_payments', '7 gün içinde vadesi gelen ödemeler', { days: '7' }, 'info');
      add('invoice_mismatch', 'Fatura farkı %5 üzeri', { percent: '5' }, 'warning');
    }
    if (db.value<number>('SELECT COUNT(*) FROM users')) return null;
    const email = admin?.email ?? (process.env.FC_ADMIN_EMAIL || randomEmail('yonetici'));
    const password = admin?.password ?? (process.env.FC_ADMIN_PASSWORD || randomPassword());
    const role = db.value<number>("SELECT id FROM roles WHERE key = 'super_admin'")!;
    db.run('INSERT INTO users (email, name, password_hash, role_id) VALUES (?,?,?,?)', email, 'Süper yönetici', hashPassword(password), role);
    return { email, password };
  });
}
