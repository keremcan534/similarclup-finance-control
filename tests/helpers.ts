import { bootstrap } from '../server/bootstrap.ts';
import { loadUser } from '../server/auth.ts';
import type { Ctx } from '../server/context.ts';
import { openDb, type Db } from '../server/db.ts';
import { hashPassword } from '../server/auth.ts';

export const PASSWORD = 'test-password-123';

export function setup(nowIso = '2026-10-15T12:00:00.000Z') {
  const db = openDb(':memory:');
  bootstrap(db, { email: 'admin@test.local', password: PASSWORD });
  let now = new Date(nowIso);
  const adminId = db.value<number>("SELECT id FROM users WHERE email = 'admin@test.local'")!;
  const ctx: Ctx = { db, user: loadUser(db, adminId), integration: null, now: () => now };
  return {
    db,
    ctx,
    setNow: (iso: string) => {
      now = new Date(iso);
    },
    /** A second context acting as another user (for maker-checker). */
    as: (roleKey: string, email: string, agencyId: number | null = null): Ctx => {
      let id = db.value<number>('SELECT id FROM users WHERE email = ?', email);
      if (!id) {
        const role = db.value<number>('SELECT id FROM roles WHERE key = ?', roleKey)!;
        id = db.run('INSERT INTO users (email, name, password_hash, role_id, agency_id) VALUES (?,?,?,?,?)', email, email, hashPassword(PASSWORD), role, agencyId).id;
      }
      return { db, user: loadUser(db, id), integration: null, now: () => now };
    },
  };
}

/** Standard fixture: TRY, store channel 15% + 20% VAT, coin worth 0.10 TRY, one agency/BD/publisher. */
export function fixture(db: Db) {
  db.run("INSERT INTO payment_channels (code, name, kind, settlement_delay_days) VALUES ('google', 'Google Play', 'store', 30)");
  db.run("INSERT INTO channel_fee_versions (channel_id, percent, fixed_fee_minor, refund_fee_minor, currency, valid_from) VALUES (1, '15', 0, 500, 'TRY', '2026-01-01')");
  db.run("INSERT INTO tax_configurations (name, applies_to, percent, inclusive, valid_from) VALUES ('KDV', 'purchase', '20', 1, '2026-01-01')");
  db.run("INSERT INTO unit_valuations (unit, currency, value_per_unit, purpose, valid_from) VALUES ('COIN', 'TRY', '0.10', 'revenue', '2026-01-01')");
  db.run("INSERT INTO exchange_rates (base, quote, rate, valid_from) VALUES ('USD', 'TRY', '40', '2026-01-01')");
  const bd = db.run("INSERT INTO business_developers (code, name) VALUES ('BD1', 'Ayşe BD')").id;
  const agency = db.run("INSERT INTO agencies (code, name, bd_id) VALUES ('AG1', 'Yıldız Ajans', ?)", bd).id;
  const agency2 = db.run("INSERT INTO agencies (code, name) VALUES ('AG2', 'Ay Ajans')").id;
  const pub = db.run("INSERT INTO publishers (external_id, name, agency_id) VALUES ('u100', 'Yayıncı Deniz', ?)", agency).id;
  const pub2 = db.run("INSERT INTO publishers (external_id, name, agency_id) VALUES ('u200', 'Yayıncı Ece', ?)", agency2).id;
  return { bd, agency, agency2, pub, pub2 };
}

/** Creates a rule and activates its first version immediately (dual control off for setup). */
export function rule(ctx: Ctx, code: string, config: object, category = 'agency') {
  const { db } = ctx;
  const id = db.run('INSERT INTO commission_rules (code, name, category) VALUES (?,?,?)', code, code, category).id;
  const vid = db.run("INSERT INTO commission_rule_versions (rule_id, version, config, valid_from, status) VALUES (?, 1, ?, '2026-01-01T00:00:00.000Z', 'active')", id, JSON.stringify(config)).id;
  return { id, vid };
}

export const giftRule = (beneficiary: object, method: object, extra: object = {}) => ({
  scope: 'transaction',
  tx_kind: 'wallet',
  tx_types: ['gift_receive'],
  beneficiary,
  base: 'coin_value',
  method,
  currency: 'TRY',
  rounding: 'half_even',
  stage: 1,
  refund: 'reverse_proportional',
  ...extra,
});
