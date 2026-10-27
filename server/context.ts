import { createHash } from 'node:crypto';

import type { Db } from './db.ts';
import { HttpError, bad, forbidden } from './lib/http.ts';

export const PERMISSIONS = {
  'dashboard.view': 'Ana paneli görüntüle',
  'ledger.view': 'İşlem defterini görüntüle',
  'ledger.write': 'Manuel işlem / ters kayıt gir',
  'rules.view': 'Komisyon kurallarını görüntüle',
  'rules.edit': 'Komisyon kuralı taslağı oluştur',
  'rules.activate': 'Komisyon kuralını yürürlüğe al (kritik)',
  'parties.view': 'Ajans, BD, yayıncı görüntüle',
  'parties.edit': 'Ajans, BD, yayıncı ve sözleşme düzenle',
  'statements.view': 'Hakedişleri görüntüle',
  'statements.calculate': 'Hakediş hesapla',
  'statements.approve': 'Hakediş onayla (kritik)',
  'payouts.record': 'Ödeme kaydet (kritik)',
  'channels.edit': 'Ödeme kanalı kesintilerini düzenle',
  'costs.view': 'Servis maliyetlerini görüntüle',
  'costs.edit': 'Tarife, kullanım ve fatura gir',
  'catalog.edit': 'Oyun, hediye, emoji, PK maliyetlerini düzenle',
  'lucky.view': 'Lucky Gift analizini görüntüle',
  'lucky.edit': 'Lucky Gift olasılık tablolarını düzenle',
  'expenses.view': 'Giderleri görüntüle',
  'expenses.edit': 'Gider gir / öde',
  'reports.view': 'Raporları görüntüle',
  'reports.export': 'Rapor dışa aktar',
  'periods.close': 'Finansal dönem kapat (kritik)',
  'alerts.view': 'Uyarıları görüntüle',
  'alerts.manage': 'Uyarı eşiklerini yönet',
  'integrations.manage': 'Entegrasyon ve API anahtarları',
  'users.manage': 'Kullanıcı ve rol yönetimi',
  'audit.view': 'Denetim kaydını görüntüle',
  'settings.edit': 'Kur, vergi, para birimi, sistem ayarları',
  'simulation.use': 'Büyüme simülasyonu',
} as const;
export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export type User = {
  id: number;
  email: string;
  name: string;
  role_key: string;
  role_name: string;
  scope: 'platform' | 'agency';
  agency_id: number | null;
  permissions: Set<string>;
};

export type Ctx = {
  db: Db;
  user: User | null;
  /** Integration calls authenticate with an API key instead of a user. */
  integration: { id: number; code: string } | null;
  now: () => Date;
};

export const today = (ctx: Ctx) => ctx.now().toISOString().slice(0, 10);
export const nowIso = (ctx: Ctx) => ctx.now().toISOString();

export function can(ctx: Ctx, perm: string): boolean {
  return !!ctx.user?.permissions.has(perm);
}
export function need(ctx: Ctx, perm: string) {
  if (!ctx.user) throw new HttpError(401, 'Oturum açmanız gerekiyor', 'unauthenticated');
  if (!can(ctx, perm)) throw forbidden(`Bu işlem için "${PERMISSIONS[perm as Permission] ?? perm}" yetkisi gerekiyor`);
}
export const actorId = (ctx: Ctx) => ctx.user?.id ?? null;
export const actorName = (ctx: Ctx) => (ctx.user ? `${ctx.user.name} <${ctx.user.email}>` : ctx.integration ? `api:${ctx.integration.code}` : 'system');

/** Agency-scoped users only see their own agency. Returns the forced agency id or null for platform users. */
export function agencyScope(ctx: Ctx): number | null {
  if (ctx.user?.scope === 'agency') {
    if (!ctx.user.agency_id) throw forbidden('Hesabınız bir ajansa bağlı değil');
    return ctx.user.agency_id;
  }
  return null;
}
export function assertAgencyAccess(ctx: Ctx, agencyId: number | null | undefined) {
  const scope = agencyScope(ctx);
  if (scope !== null && scope !== agencyId) throw forbidden('Başka bir ajansın verilerine erişemezsiniz');
}

// ---- settings --------------------------------------------------------------------
export const DEFAULT_SETTINGS: Record<string, string> = {
  reporting_currency: 'TRY',
  dual_control: '1', // critical actions need a second user
  statement_period: 'monthly',
  coin_unit: 'COIN',
  diamond_unit: 'DIAMOND',
  company_name: 'Similarclup',
  timezone: 'Europe/Istanbul',
};

export function setting(db: Db, key: string): string {
  return db.value<string>('SELECT value FROM settings WHERE key = ?', key) ?? DEFAULT_SETTINGS[key] ?? '';
}

// ---- audit ---------------------------------------------------------------------------
const GENESIS = '0'.repeat(64);

export function audit(ctx: Ctx, action: string, entity: string, entityId: string | number | null, before: unknown, after: unknown, reason?: string | null) {
  const prev = ctx.db.value<string>('SELECT hash FROM audit_logs ORDER BY id DESC LIMIT 1') ?? GENESIS;
  const at = nowIso(ctx);
  const row = {
    at,
    user_id: actorId(ctx),
    actor: actorName(ctx),
    action,
    entity,
    entity_id: entityId === null ? null : String(entityId),
    before: before === undefined || before === null ? null : JSON.stringify(before, big),
    after: after === undefined || after === null ? null : JSON.stringify(after, big),
    reason: reason ?? null,
  };
  const hash = createHash('sha256').update(prev + JSON.stringify(row)).digest('hex');
  ctx.db.run(
    'INSERT INTO audit_logs (at, user_id, actor, action, entity, entity_id, before, after, reason, prev_hash, hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    row.at,
    row.user_id,
    row.actor,
    row.action,
    row.entity,
    row.entity_id,
    row.before,
    row.after,
    row.reason,
    prev,
    hash,
  );
}
const big = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);

/** Recomputes the hash chain; returns the first broken id or null. */
export function verifyAuditChain(db: Db): { ok: boolean; brokenAt: number | null; count: number } {
  let prev = GENESIS;
  let count = 0;
  for (const r of db.all('SELECT * FROM audit_logs ORDER BY id')) {
    const row = { at: r.at, user_id: r.user_id, actor: r.actor, action: r.action, entity: r.entity, entity_id: r.entity_id, before: r.before, after: r.after, reason: r.reason };
    const h = createHash('sha256').update(prev + JSON.stringify(row)).digest('hex');
    if (r.prev_hash !== prev || r.hash !== h) return { ok: false, brokenAt: r.id, count };
    prev = r.hash;
    count++;
  }
  return { ok: true, brokenAt: null, count };
}

// ---- currencies ---------------------------------------------------------------------
export function currency(db: Db, code: string): { code: string; decimals: number; kind: string } {
  const c = db.get<{ code: string; decimals: number; kind: string }>('SELECT code, decimals, kind FROM currencies WHERE code = ?', code);
  if (!c) throw bad(`Tanımsız para birimi: ${code}`);
  return c;
}
