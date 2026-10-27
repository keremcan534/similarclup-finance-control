import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { hashPassword, login, logout, newApiKey, newTotpSecret, verifyTotp } from './auth.ts';
import { ALL_PERMISSIONS, PERMISSIONS, agencyScope, assertAgencyAccess, audit, can, currency, need, setting, today, verifyAuditChain, type Ctx } from './context.ts';
import { createRow, updateRow, type Resource } from './lib/crud.ts';
import { parseCsv, toCsv } from './lib/csv.ts';
import { FUNCTIONS, validateFormula } from './lib/formula.ts';
import { HttpError, Router, bad, bool, conflict, date, int, notFound, oneOf, reqInt, reqStr, str, type Req } from './lib/http.ts';
import { ROUNDING_MODES, dec, fmt, isDecString, parseMinor } from './lib/money.ts';
import { ALERT_KINDS, evaluateAlerts, validateAlertParams } from './domain/alerts.ts';
import { FINANCIAL_TX_TYPES, PERIOD_VARIABLES, TX_VARIABLES, WALLET_TX_TYPES, findConflicts, previewRule, retryIssues, validateRuleConfig } from './domain/commission.ts';
import { cancelExpense, generateRecurring, payExpense, reconcileInvoice, serviceCosts } from './domain/costs.ts';
import { decide, requestAction, requestPeriodClose, requestRuleActivation, retireRule } from './domain/governance.ts';
import { EVENT_TYPES, ingestEvent, ingestEvents, reverseTransaction } from './domain/ledger.ts';
import { createLuckyVersion, drawLucky, expectedMultiplier, luckyAnalysis } from './domain/lucky.ts';
import { agencyContribution, catalogReport, dailySeries, drill, summary, unitEconomics } from './domain/reports.ts';
import { PRESET_USERS, SIM_INPUTS, runSimulation } from './domain/simulation.ts';
import { addAdjustment, approveStatement, calculateAll, calculateStatement, cancelStatement, partyFinance, recordPayout, setDispute, type PartyType } from './domain/statements.ts';

export type AppConfig = { dataDir: string; dbPath: string; cookieSecure: boolean; noLogin?: boolean };

const monthStartOf = (d: string) => d.slice(0, 7) + '-01';
function range(req: Req, ctx: Ctx) {
  const to = date(req.query.get('to') || today(ctx), 'to')!;
  const from = date(req.query.get('from') || monthStartOf(to), 'from')!;
  if (from > to) throw bad('Başlangıç bitişten sonra olamaz');
  return { from, to };
}
function page(req: Req) {
  const limit = Math.min(int(req.query.get('limit'), 'limit', { min: 1, max: 1000 }) ?? 100, 1000);
  const offset = int(req.query.get('offset'), 'offset', { min: 0 }) ?? 0;
  return { limit, offset };
}
const reason = (body: any, required = true) => {
  const r = str(body?.reason, 'reason', { max: 1000 });
  if (required && !r) throw bad('Gerekçe zorunlu');
  return r;
};

// ---- master data resources -------------------------------------------------------------
const R: Record<string, Resource & { perm: [string, string] }> = {
  agencies: {
    table: 'agencies',
    label: 'Ajans',
    perm: ['parties.view', 'parties.edit'],
    immutable: ['code'],
    fields: [
      { name: 'code', type: 'text', required: true, max: 40 },
      { name: 'name', type: 'text', required: true, max: 200 },
      { name: 'contact_name', type: 'text', max: 200 },
      { name: 'contact_email', type: 'text', max: 200 },
      { name: 'bd_id', type: 'ref', table: 'business_developers' },
      { name: 'status', type: 'enum', values: ['active', 'passive'], def: 'active' },
    ],
  },
  bds: {
    table: 'business_developers',
    label: 'BD',
    perm: ['parties.view', 'parties.edit'],
    immutable: ['code'],
    fields: [
      { name: 'code', type: 'text', required: true, max: 40 },
      { name: 'name', type: 'text', required: true, max: 200 },
      { name: 'email', type: 'text', max: 200 },
      { name: 'status', type: 'enum', values: ['active', 'passive'], def: 'active' },
    ],
  },
  publishers: {
    table: 'publishers',
    label: 'Yayıncı',
    perm: ['parties.view', 'parties.edit'],
    immutable: ['external_id'],
    fields: [
      { name: 'external_id', type: 'text', required: true, max: 100 },
      { name: 'name', type: 'text', required: true, max: 200 },
      { name: 'agency_id', type: 'ref', table: 'agencies' },
      { name: 'status', type: 'enum', values: ['active', 'passive', 'unmapped'], def: 'active' },
    ],
  },
  channels: {
    table: 'payment_channels',
    label: 'Ödeme kanalı',
    perm: ['ledger.view', 'channels.edit'],
    immutable: ['code'],
    fields: [
      { name: 'code', type: 'text', required: true, max: 40 },
      { name: 'name', type: 'text', required: true, max: 200 },
      { name: 'kind', type: 'enum', values: ['store', 'card', 'bank', 'web', 'other'], required: true },
      { name: 'settlement_delay_days', type: 'int', min: 0, max: 365 },
      { name: 'active', type: 'bool' },
    ],
  },
  providers: {
    table: 'service_providers',
    label: 'Servis sağlayıcı',
    perm: ['costs.view', 'costs.edit'],
    immutable: ['code'],
    fields: [
      { name: 'code', type: 'text', required: true, max: 40 },
      { name: 'name', type: 'text', required: true, max: 200 },
      { name: 'category', type: 'text', required: true, max: 100 },
      { name: 'integration_id', type: 'ref', table: 'integration_connections' },
      { name: 'active', type: 'bool' },
    ],
  },
  catalog: {
    table: 'catalog_items',
    label: 'Katalog öğesi',
    perm: ['costs.view', 'catalog.edit'],
    immutable: ['code'],
    fields: [
      { name: 'kind', type: 'enum', values: ['game', 'gift', 'emoji', 'animation'], required: true },
      { name: 'code', type: 'text', required: true, max: 60 },
      { name: 'name', type: 'text', required: true, max: 200 },
      { name: 'provider', type: 'text', max: 200 },
      { name: 'coin_price', type: 'int', min: 0 },
      { name: 'currency', type: 'text', required: true, max: 8 },
      { name: 'license_cost', type: 'money', column: 'license_cost_minor', currencyField: 'currency' },
      { name: 'production_cost', type: 'money', column: 'production_cost_minor', currencyField: 'currency' },
      { name: 'monthly_fee', type: 'money', column: 'monthly_fee_minor', currencyField: 'currency' },
      { name: 'per_use_cost', type: 'decimal', min: '0' },
      { name: 'per_tx_fee', type: 'decimal', min: '0' },
      { name: 'revenue_share_percent', type: 'decimal', min: '0', max: '100' },
      { name: 'free', type: 'bool' },
      { name: 'active', type: 'bool' },
      { name: 'acquired_on', type: 'date' },
    ],
  },
  pk: {
    table: 'pk_events',
    label: 'PK etkinliği',
    perm: ['costs.view', 'catalog.edit'],
    immutable: ['code'],
    fields: [
      { name: 'code', type: 'text', required: true, max: 60 },
      { name: 'name', type: 'text', required: true, max: 200 },
      { name: 'kind', type: 'enum', values: ['in_room', 'cross_room'], required: true },
      { name: 'starts_at', type: 'text', required: true, max: 40 },
      { name: 'ends_at', type: 'text', required: true, max: 40 },
      { name: 'reward_type', type: 'text', required: true, max: 100 },
      { name: 'currency', type: 'text', required: true, max: 8 },
      { name: 'reward_cost', type: 'money', column: 'reward_cost_minor', currencyField: 'currency' },
      { name: 'note', type: 'text', max: 500 },
    ],
  },
  expense_categories: {
    table: 'expense_categories',
    label: 'Gider kategorisi',
    perm: ['expenses.view', 'expenses.edit'],
    fields: [
      { name: 'name', type: 'text', required: true, max: 100 },
      { name: 'nature', type: 'enum', values: ['fixed', 'variable'], def: 'fixed' },
      { name: 'active', type: 'bool' },
    ],
  },
  cash_accounts: {
    table: 'cash_accounts',
    label: 'Nakit hesabı',
    perm: ['reports.view', 'expenses.edit'],
    immutable: ['currency'],
    fields: [
      { name: 'name', type: 'text', required: true, max: 100 },
      { name: 'currency', type: 'text', required: true, max: 8 },
      { name: 'active', type: 'bool' },
    ],
  },
  budgets: {
    table: 'budgets',
    label: 'Bütçe',
    perm: ['reports.view', 'alerts.manage'],
    fields: [
      { name: 'name', type: 'text', required: true, max: 200 },
      { name: 'scope_type', type: 'enum', values: ['expense_category', 'service_provider', 'total'], required: true },
      { name: 'scope_id', type: 'int' },
      { name: 'period', type: 'text', required: true, max: 7 },
      { name: 'currency', type: 'text', required: true, max: 8 },
      { name: 'limit', type: 'money', column: 'limit_minor', currencyField: 'currency', required: true },
      { name: 'profit_target', type: 'money', column: 'profit_target_minor', currencyField: 'currency', allowNegative: true },
    ],
  },
};

function listResource(ctx: Ctx, key: string, req: Req) {
  const r = R[key];
  need(ctx, r.perm[0]);
  const { limit, offset } = page(req);
  const scope = agencyScope(ctx);
  const search = req.query.get('q');
  const where: string[] = [];
  const params: any[] = [];
  if (scope !== null) {
    if (key === 'agencies') where.push('id = ?');
    else if (key === 'publishers') where.push('agency_id = ?');
    else throw new HttpError(403, 'Bu listeye erişiminiz yok', 'forbidden');
    params.push(scope);
  }
  if (search) {
    where.push(`(${r.fields.filter((f) => f.type === 'text').map((f) => `${f.name} LIKE ?`).join(' OR ')})`);
    r.fields.filter((f) => f.type === 'text').forEach(() => params.push(`%${search}%`));
  }
  for (const f of ['status', 'kind', 'agency_id', 'bd_id', 'scope_type', 'period']) {
    const v = req.query.get(f);
    if (v && r.fields.some((x) => x.name === f)) {
      where.push(`${f} = ?`);
      params.push(v);
    }
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return {
    rows: ctx.db.all(`SELECT * FROM ${r.table} ${w} ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`, ...params),
    total: ctx.db.value<number>(`SELECT COUNT(*) FROM ${r.table} ${w}`, ...params),
  };
}

export function buildRouter(cfg: AppConfig) {
  const r = new Router<Ctx>();

  // ---- auth ----------------------------------------------------------------------------
  r.post(
    '/api/auth/login',
    (req, ctx) => {
      const out = login(ctx, reqStr(req.body?.email, 'email', 200), reqStr(req.body?.password, 'password', 200), str(req.body?.code, 'code', { max: 10 }) ?? undefined);
      ctx.user = out.user;
      audit(ctx, 'auth.login', 'users', out.user.id, null, { ip: req.ip });
      return {
        __cookie: `fc_session=${out.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${12 * 3600}${cfg.cookieSecure ? '; Secure' : ''}`,
        user: publicUser(ctx),
        token: out.token,
      };
    },
    { public: true },
  );
  r.post('/api/auth/logout', (req, ctx) => {
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '') || (req as any).sessionToken;
    if (token) logout(ctx.db, token);
    return { __cookie: 'fc_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0', ok: true };
  });
  r.get('/api/auth/me', (_req, ctx) => ({ user: publicUser(ctx) }));
  r.post('/api/auth/password', (req, ctx) => {
    const u = ctx.db.get('SELECT * FROM users WHERE id = ?', ctx.user!.id)!;
    login(ctx, u.email, reqStr(req.body?.current, 'current', 200), str(req.body?.code, 'code', { max: 10 }) ?? undefined);
    ctx.db.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(reqStr(req.body?.password, 'password', 200)), u.id);
    ctx.db.run('DELETE FROM sessions WHERE user_id = ?', u.id);
    audit(ctx, 'auth.password_change', 'users', u.id, null, null);
    return { ok: true };
  });
  r.post('/api/auth/mfa/setup', (_req, ctx) => {
    const secret = newTotpSecret();
    return { secret, otpauth: `otpauth://totp/Similarclup%20Finance:${encodeURIComponent(ctx.user!.email)}?secret=${secret}&issuer=Similarclup%20Finance` };
  });
  r.post('/api/auth/mfa/confirm', (req, ctx) => {
    const secret = reqStr(req.body?.secret, 'secret', 64);
    if (!verifyTotp(secret, reqStr(req.body?.code, 'code', 10), ctx.now().getTime())) throw bad('Kod doğrulanamadı');
    ctx.db.run('UPDATE users SET mfa_secret = ? WHERE id = ?', secret, ctx.user!.id);
    audit(ctx, 'auth.mfa_enable', 'users', ctx.user!.id, null, null);
    return { ok: true };
  });

  // ---- meta ----------------------------------------------------------------------------
  r.get('/api/meta', (_req, ctx) => ({
    no_login: !!cfg.noLogin,
    permissions: PERMISSIONS,
    currencies: ctx.db.all('SELECT * FROM currencies ORDER BY kind, code'),
    reporting_currency: setting(ctx.db, 'reporting_currency'),
    settings: Object.fromEntries(ctx.db.all('SELECT key, value FROM settings').map((s) => [s.key, s.value])),
    tx_types: { financial: FINANCIAL_TX_TYPES, wallet: WALLET_TX_TYPES },
    event_types: EVENT_TYPES,
    rule_variables: { transaction: TX_VARIABLES, period: PERIOD_VARIABLES },
    functions: Object.fromEntries(Object.entries(FUNCTIONS).map(([k, f]) => [k, f.doc])),
    rounding_modes: ROUNDING_MODES,
    alert_kinds: ALERT_KINDS,
    simulation_inputs: SIM_INPUTS,
    simulation_presets: PRESET_USERS,
  }));

  // ---- dashboard -----------------------------------------------------------------------
  r.get('/api/dashboard', (req, ctx) => {
    need(ctx, 'dashboard.view');
    const { from, to } = range(req, ctx);
    return summary(ctx.db, from, to, to < today(ctx) ? to : today(ctx));
  });
  r.get('/api/dashboard/series', (req, ctx) => {
    need(ctx, 'dashboard.view');
    const { from, to } = range(req, ctx);
    return dailySeries(ctx.db, from, to);
  });
  r.get('/api/dashboard/drill', (req, ctx) => {
    need(ctx, 'dashboard.view');
    const { from, to } = range(req, ctx);
    return { rows: drill(ctx.db, reqStr(req.query.get('metric'), 'metric', 60), from, to) };
  });
  r.get('/api/dashboard/live', (_req, ctx) => {
    need(ctx, 'dashboard.view');
    const { db } = ctx;
    const day = today(ctx);
    const hourAgo = new Date(ctx.now().getTime() - 3600_000).toISOString();
    const integrations = db.all("SELECT code, name, kind, status, last_sync_at, last_error FROM integration_connections WHERE status <> 'disabled'");
    const connected = integrations.some((i) => i.status === 'connected');
    const minutes = (kind: string) => db.all("SELECT quantity FROM wallet_transactions WHERE type = 'call_earning' AND item_ref = ? AND booked_on = ?", kind, day).reduce((s, r2) => s + Number(r2.quantity ?? 0), 0);
    // Ledger-derived figures are real recorded data; they are only as fresh as the last ingested event.
    const live = (value: unknown, source: string) => ({ value, source: connected ? source : `${source} — canlı akış yok, son kayıtlı veri`, available: true });
    const na = (why: string) => ({ value: null, source: why, available: false });
    return {
      as_of: ctx.now().toISOString(),
      connected,
      last_event_at: db.value<string>('SELECT MAX(recorded_at) FROM (SELECT recorded_at FROM wallet_transactions UNION ALL SELECT recorded_at FROM financial_transactions)'),
      metrics: {
        active_users_today: live(db.value<number>('SELECT COUNT(DISTINCT user_ref) FROM wallet_transactions WHERE booked_on = ? AND user_ref IS NOT NULL', day), 'Ledger olayları (bugün)'),
        events_last_hour: live(db.value<number>('SELECT COUNT(*) FROM wallet_transactions WHERE recorded_at >= ?', hourAgo), 'Ledger olayları (son 1 saat)'),
        voice_call_minutes_today: live(minutes('voice'), 'Arama olayları'),
        video_call_minutes_today: live(minutes('video'), 'Arama olayları'),
        connected_users: na('Similar Club canlı bağlantı API’si bağlı değil'),
        active_rooms: na('Similar Club oda API’si bağlı değil'),
        active_voice_connections: na('Ses altyapısı API’si bağlı değil'),
        active_video_calls: na('Video altyapısı API’si bağlı değil'),
        server_resources: na('Sunucu izleme API’si bağlı değil'),
      },
      month_service_costs: serviceCosts(db, day.slice(0, 7)),
      integrations,
    };
  });

  // ---- ledger ----------------------------------------------------------------------------
  for (const kind of ['financial', 'wallet'] as const) {
    const table = kind === 'financial' ? 'financial_transactions' : 'wallet_transactions';
    r.get(`/api/ledger/${kind}`, (req, ctx) => {
      need(ctx, 'ledger.view');
      const { limit, offset } = page(req);
      const where: string[] = [];
      const p: any[] = [];
      const add = (cond: string, v: unknown) => {
        if (v) {
          where.push(cond);
          p.push(v);
        }
      };
      add('t.type = ?', req.query.get('type'));
      add('t.booked_on >= ?', req.query.get('from'));
      add('t.booked_on <= ?', req.query.get('to'));
      add('t.user_ref = ?', req.query.get('user_ref'));
      add('t.publisher_id = ?', req.query.get('publisher_id'));
      add('t.agency_id = ?', agencyScope(ctx) ?? req.query.get('agency_id'));
      const q = req.query.get('q');
      if (q) {
        where.push('(t.idempotency_key LIKE ? OR t.user_ref LIKE ? OR t.source_ref LIKE ?)');
        p.push(`%${q}%`, `%${q}%`, `%${q}%`);
      }
      const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
      return {
        rows: ctx.db.all(
          `SELECT t.*, p.name AS publisher, a.name AS agency, (SELECT COUNT(*) FROM commission_allocations c WHERE c.tx_kind = '${kind}' AND c.tx_id = t.id) AS allocations
             FROM ${table} t LEFT JOIN publishers p ON p.id = t.publisher_id LEFT JOIN agencies a ON a.id = t.agency_id ${w} ORDER BY t.id DESC LIMIT ${limit} OFFSET ${offset}`,
          ...p,
        ),
        total: ctx.db.value<number>(`SELECT COUNT(*) FROM ${table} t ${w}`, ...p),
      };
    });
    r.get(`/api/ledger/${kind}/:id`, (req, ctx) => {
      need(ctx, 'ledger.view');
      const t = ctx.db.get(`SELECT * FROM ${table} WHERE id = ?`, Number(req.params.id));
      if (!t) throw notFound('İşlem');
      assertAgencyAccess(ctx, agencyScope(ctx) === null ? null : t.agency_id);
      return {
        tx: t,
        allocations: ctx.db.all(
          `SELECT a.*, r.code AS rule, r.name AS rule_name, v.version FROM commission_allocations a JOIN commission_rule_versions v ON v.id = a.rule_version_id JOIN commission_rules r ON r.id = v.rule_id
            WHERE a.tx_kind = ? AND (a.tx_id = ? OR a.reversal_of_tx_id = ?) ORDER BY a.stage, a.id`,
          kind,
          t.id,
          t.id,
        ),
        related: ctx.db.all(`SELECT id, idempotency_key, type, booked_on FROM ${table} WHERE reverses_id = ? OR id = ?`, t.id, t.reverses_id ?? -1),
        issues: ctx.db.all('SELECT * FROM calculation_issues WHERE tx_kind = ? AND tx_id = ?', kind, t.id),
      };
    });
    r.post(`/api/ledger/${kind}/:id/reverse`, (req, ctx) => {
      need(ctx, 'ledger.write');
      return reverseTransaction(ctx, kind, Number(req.params.id), reason(req.body)!);
    });
  }
  r.post('/api/ledger/events', (req, ctx) => {
    need(ctx, 'ledger.write');
    const events = Array.isArray(req.body?.events) ? req.body.events : [req.body];
    const out = ingestEvents(ctx, events, 'manual', null, 'manual');
    audit(ctx, 'ledger.manual_events', 'import_batches', out.batch_id, null, { created: out.created, errors: out.errors });
    return out;
  });
  r.get('/api/ledger/balances', (req, ctx) => {
    need(ctx, 'ledger.view');
    const ref = req.query.get('user_ref');
    return {
      rows: ctx.db.all(
        `SELECT user_ref, unit, SUM(units) AS balance, COUNT(*) AS tx FROM wallet_transactions WHERE user_ref IS NOT NULL ${ref ? 'AND user_ref = ?' : ''} GROUP BY user_ref, unit ORDER BY balance DESC LIMIT 200`,
        ...(ref ? [ref] : []),
      ),
    };
  });

  // ---- ingestion (integration API key) -------------------------------------------------
  r.post(
    '/api/ingest/events',
    (req, ctx) => {
      if (!ctx.integration) throw new HttpError(401, 'Geçerli X-Api-Key gerekli', 'unauthenticated');
      return ingestEvents(ctx, req.body?.events, 'api', ctx.integration.id, 'api');
    },
    { public: true },
  );
  r.post(
    '/api/ingest/lucky/draw',
    (req, ctx) => {
      if (!ctx.integration) throw new HttpError(401, 'Geçerli X-Api-Key gerekli', 'unauthenticated');
      const code = reqStr(req.body?.config_code, 'config_code', 100);
      const user = reqStr(req.body?.user_ref, 'user_ref', 100);
      const key = reqStr(req.body?.idempotency_key, 'idempotency_key', 200);
      const prev = ctx.db.get('SELECT * FROM lucky_gift_results WHERE idempotency_key = ?', key);
      if (prev) return { duplicate: true, ...prev };
      const d = drawLucky(ctx, code, user);
      const res = ingestEvent(
        ctx,
        { type: 'lucky', idempotency_key: key, config_code: code, version: d.version, user_ref: user, publisher_ref: req.body?.publisher_ref, spent_coins: ctx.db.value('SELECT gift_cost_coins FROM lucky_gift_config_versions v JOIN lucky_gift_configurations c ON c.id = v.config_id WHERE c.code = ? AND v.version = ?', code, d.version), random_value: d.random_value, multiplier: d.multiplier, reward_coins: d.reward_coins, capped_by: d.capped_by, occurred_at: ctx.now().toISOString() },
        'api',
      );
      if (res.status === 'error') throw bad(res.error!, res.details);
      return { duplicate: false, ...d };
    },
    { public: true },
  );
  r.post('/api/import/csv', (req, ctx) => {
    const kind = oneOf(req.body?.kind, 'kind', ['events', 'usage', 'expenses', 'publishers'] as const);
    need(ctx, kind === 'expenses' ? 'expenses.edit' : kind === 'usage' ? 'costs.edit' : 'ledger.write');
    const rows = parseCsv(reqStr(req.body?.csv, 'csv', 10_000_000));
    if (!rows.length) throw bad('CSV boş veya başlık satırı yok');
    if (kind === 'expenses') {
      const res = rows.map((row, i) => {
        try {
          const cat = ctx.db.get('SELECT id FROM expense_categories WHERE name = ?', row.category);
          if (!cat) throw bad(`Kategori bulunamadı: ${row.category}`);
          createExpense(ctx, { ...row, category_id: cat.id });
          return { row: i + 2, ok: true };
        } catch (e: any) {
          return { row: i + 2, ok: false, error: e.message };
        }
      });
      const errs = res.filter((x) => !x.ok);
      ctx.db.run('INSERT INTO import_batches (kind, rows_total, rows_ok, rows_error, errors, created_by) VALUES (?,?,?,?,?,?)', 'csv:expenses', rows.length, rows.length - errs.length, errs.length, JSON.stringify(errs.slice(0, 200)), ctx.user!.id);
      return { total: rows.length, created: rows.length - errs.length, errors: errs.length, results: res };
    }
    const events = rows.map((row) => (kind === 'usage' ? { type: 'usage', ...row } : kind === 'publishers' ? { type: 'publisher', idempotency_key: `publisher:${row.external_id}`, ...row } : row));
    return ingestEvents(ctx, events, 'csv', null, `csv:${kind}`);
  });

  // ---- commission rules ----------------------------------------------------------------
  const ruleCodes = (ctx: Ctx) => ctx.db.all<{ code: string }>('SELECT code FROM commission_rules').map((x) => x.code);
  r.get('/api/rules', (_req, ctx) => {
    need(ctx, 'rules.view');
    return {
      rows: ctx.db.all(
        `SELECT r.*, (SELECT COUNT(*) FROM commission_rule_versions v WHERE v.rule_id = r.id) AS versions,
                (SELECT json_object('id', v.id, 'version', v.version, 'status', v.status, 'valid_from', v.valid_from, 'config', json(v.config))
                   FROM commission_rule_versions v WHERE v.rule_id = r.id AND v.status = 'active') AS active,
                (SELECT COUNT(*) FROM commission_rule_versions v WHERE v.rule_id = r.id AND v.status IN ('draft','pending_approval')) AS drafts
           FROM commission_rules r ORDER BY r.category, r.code`,
      ).map((x) => ({ ...x, active: x.active ? JSON.parse(x.active) : null })),
    };
  });
  r.get('/api/rules/:id', (req, ctx) => {
    need(ctx, 'rules.view');
    const rule = ctx.db.get('SELECT * FROM commission_rules WHERE id = ?', Number(req.params.id));
    if (!rule) throw notFound('Kural');
    return {
      rule,
      versions: ctx.db.all('SELECT * FROM commission_rule_versions WHERE rule_id = ? ORDER BY version DESC', rule.id).map((v) => ({ ...v, config: JSON.parse(v.config) })),
      usage: ctx.db.all(
        "SELECT v.version, COUNT(*) AS n, a.currency, SUM(a.amount_minor) AS total FROM commission_allocations a JOIN commission_rule_versions v ON v.id = a.rule_version_id WHERE v.rule_id = ? GROUP BY v.version, a.currency",
        rule.id,
      ),
    };
  });
  r.post('/api/rules', (req, ctx) => {
    need(ctx, 'rules.edit');
    const code = reqStr(req.body?.code, 'code', 40).toUpperCase();
    if (!/^[A-Z][A-Z0-9_]*$/.test(code)) throw bad('Kod büyük harf, rakam ve _ içermeli (harfle başlamalı)');
    if (ctx.db.get('SELECT 1 FROM commission_rules WHERE code = ?', code)) throw conflict('Bu kod zaten var');
    const config = validateRuleConfig(ctx.db, req.body?.config, ruleCodes(ctx));
    return ctx.db.tx(() => {
      const id = ctx.db.run(
        'INSERT INTO commission_rules (code, name, description, category, created_by) VALUES (?,?,?,?,?)',
        code,
        reqStr(req.body?.name, 'name', 200),
        str(req.body?.description, 'description', { max: 2000 }),
        reqStr(req.body?.category, 'category', 40),
        ctx.user!.id,
      ).id;
      const vid = ctx.db.run("INSERT INTO commission_rule_versions (rule_id, version, config, valid_from, status, created_by) VALUES (?, 1, ?, ?, 'draft', ?)", id, JSON.stringify(config), ctx.now().toISOString(), ctx.user!.id).id;
      audit(ctx, 'rule.create', 'commission_rules', id, null, { code, config });
      return { id, version_id: vid, conflicts: findConflicts(ctx.db, config, id) };
    });
  });
  r.put('/api/rules/:id', (req, ctx) => {
    need(ctx, 'rules.edit');
    const before = ctx.db.get('SELECT * FROM commission_rules WHERE id = ?', Number(req.params.id));
    if (!before) throw notFound('Kural');
    ctx.db.run('UPDATE commission_rules SET name = ?, description = ?, category = ? WHERE id = ?', reqStr(req.body?.name ?? before.name, 'name', 200), str(req.body?.description ?? before.description, 'description', { max: 2000 }), reqStr(req.body?.category ?? before.category, 'category', 40), before.id);
    audit(ctx, 'rule.update_meta', 'commission_rules', before.id, before, req.body);
    return { ok: true };
  });
  r.post('/api/rules/:id/versions', (req, ctx) => {
    need(ctx, 'rules.edit');
    const rule = ctx.db.get('SELECT * FROM commission_rules WHERE id = ?', Number(req.params.id));
    if (!rule) throw notFound('Kural');
    const config = validateRuleConfig(ctx.db, req.body?.config, ruleCodes(ctx));
    const version = (ctx.db.value<number>('SELECT MAX(version) FROM commission_rule_versions WHERE rule_id = ?', rule.id) ?? 0) + 1;
    const vid = ctx.db.run("INSERT INTO commission_rule_versions (rule_id, version, config, valid_from, status, created_by) VALUES (?,?,?,?, 'draft', ?)", rule.id, version, JSON.stringify(config), ctx.now().toISOString(), ctx.user!.id).id;
    audit(ctx, 'rule.version.create', 'commission_rule_versions', vid, null, { rule: rule.code, version, config });
    return { id: vid, version, conflicts: findConflicts(ctx.db, config, rule.id) };
  });
  r.put('/api/rules/versions/:vid', (req, ctx) => {
    need(ctx, 'rules.edit');
    const v = ctx.db.get('SELECT * FROM commission_rule_versions WHERE id = ?', Number(req.params.vid));
    if (!v) throw notFound('Kural sürümü');
    if (v.status !== 'draft') throw conflict('Yalnız taslak sürüm düzenlenebilir');
    const config = validateRuleConfig(ctx.db, req.body?.config, ruleCodes(ctx));
    ctx.db.run('UPDATE commission_rule_versions SET config = ? WHERE id = ?', JSON.stringify(config), v.id);
    audit(ctx, 'rule.version.edit', 'commission_rule_versions', v.id, JSON.parse(v.config), config);
    return { ok: true, conflicts: findConflicts(ctx.db, config, v.rule_id) };
  });
  r.del('/api/rules/versions/:vid', (req, ctx) => {
    need(ctx, 'rules.edit');
    const v = ctx.db.get('SELECT * FROM commission_rule_versions WHERE id = ?', Number(req.params.vid));
    if (!v) throw notFound('Kural sürümü');
    if (v.status !== 'draft') throw conflict('Yalnız taslak silinebilir');
    if (ctx.db.value<number>('SELECT COUNT(*) FROM commission_rule_versions WHERE rule_id = ?', v.rule_id) === 1) throw conflict('Kuralın tek sürümü silinemez');
    ctx.db.run('DELETE FROM commission_rule_versions WHERE id = ?', v.id);
    audit(ctx, 'rule.version.delete_draft', 'commission_rule_versions', v.id, JSON.parse(v.config), null);
    return { ok: true };
  });
  r.post('/api/rules/versions/:vid/activate', (req, ctx) => {
    need(ctx, 'rules.edit');
    const vf = req.body?.valid_from ? (date(req.body.valid_from, 'valid_from') as string) + 'T00:00:00.000Z' : null;
    return requestRuleActivation(ctx, Number(req.params.vid), vf);
  });
  r.post('/api/rules/:id/retire', (req, ctx) => {
    need(ctx, 'rules.activate');
    retireRule(ctx, Number(req.params.id), reason(req.body)!);
    return { ok: true };
  });
  r.post('/api/rules/validate', (req, ctx) => {
    need(ctx, 'rules.view');
    try {
      const config = validateRuleConfig(ctx.db, req.body?.config, ruleCodes(ctx));
      return { ok: true, config, conflicts: findConflicts(ctx.db, config, int(req.body?.rule_id, 'rule_id')) };
    } catch (e) {
      if (e instanceof HttpError) return { ok: false, errors: (e.details as string[]) ?? [e.message] };
      throw e;
    }
  });
  r.post('/api/rules/preview', (req, ctx) => {
    need(ctx, 'rules.view');
    const config = validateRuleConfig(ctx.db, req.body?.config, ruleCodes(ctx));
    const s = req.body?.sample ?? {};
    const cur = currency(ctx.db, s.currency ?? config.currency);
    const m = (v: unknown) => (v === undefined || v === '' ? 0n : parseMinor(String(v), cur.decimals));
    const sample =
      config.tx_kind === 'wallet'
        ? { units: Number(s.units ?? 0), quantity: s.quantity ?? null, value_currency: cur.code, value_minor: m(s.value), publisher_id: int(s.publisher_id, 'publisher_id'), agency_id: int(s.agency_id, 'agency_id'), item_ref: s.item_ref ?? null }
        : (() => {
            const gross = m(s.gross_amount);
            const tax = m(s.tax_amount);
            const fee = m(s.channel_fee);
            return { currency: cur.code, amount_minor: gross, tax_minor: tax, fee_minor: fee, net_minor: gross - tax - fee, units: Number(s.coins ?? 0), product_ref: s.product_ref ?? null, agency_id: int(s.agency_id, 'agency_id'), publisher_id: int(s.publisher_id, 'publisher_id') };
          })();
    if (config.scope === 'period') throw bad('Dönemsel kural önizlemesi için Hakediş ekranındaki önizlemeyi kullanın');
    return previewRule(ctx.db, config, sample);
  });
  r.post('/api/formula/validate', (req, ctx) => {
    need(ctx, 'rules.view');
    return validateFormula(reqStr(req.body?.expr, 'expr', 2000), req.body?.variables);
  });
  r.get('/api/rules-issues', (_req, ctx) => {
    need(ctx, 'rules.view');
    return { rows: ctx.db.all("SELECT * FROM calculation_issues ORDER BY status = 'open' DESC, id DESC LIMIT 500") };
  });
  r.post('/api/rules-issues/retry', (_req, ctx) => {
    need(ctx, 'rules.edit');
    return retryIssues(ctx);
  });

  // ---- approvals ---------------------------------------------------------------------------
  r.get('/api/approvals', (req, ctx) => {
    if (!['rules.activate', 'periods.close', 'lucky.edit', 'rules.edit'].some((p) => can(ctx, p))) need(ctx, 'rules.activate');
    const status = req.query.get('status') ?? 'pending';
    return {
      rows: ctx.db.all(
        `SELECT a.*, u.name AS requested_by_name, d.name AS decided_by_name FROM approvals a JOIN users u ON u.id = a.requested_by LEFT JOIN users d ON d.id = a.decided_by
          ${status === 'all' ? '' : 'WHERE a.status = ?'} ORDER BY a.id DESC LIMIT 200`,
        ...(status === 'all' ? [] : [status]),
      ).map((a) => ({ ...a, payload: JSON.parse(a.payload) })),
    };
  });
  r.post('/api/approvals/:id/decide', (req, ctx) => decide(ctx, Number(req.params.id), bool(req.body?.approve), str(req.body?.note, 'note', { max: 1000 })));

  // ---- parties, contracts, finance views ----------------------------------------------
  for (const key of ['agencies', 'bds', 'publishers', 'channels', 'providers', 'catalog', 'pk', 'expense_categories', 'cash_accounts', 'budgets']) {
    r.get(`/api/${key}`, (req, ctx) => listResource(ctx, key, req));
    r.post(`/api/${key}`, (req, ctx) => {
      need(ctx, R[key].perm[1]);
      return createRow(ctx, R[key], req.body);
    });
    r.put(`/api/${key}/:id`, (req, ctx) => {
      need(ctx, R[key].perm[1]);
      return updateRow(ctx, R[key], Number(req.params.id), req.body, str(req.body?.reason, 'reason', { max: 1000 }));
    });
  }
  r.get('/api/contracts', (req, ctx) => {
    need(ctx, 'parties.view');
    const t = req.query.get('party_type');
    const id = req.query.get('party_id');
    if (agencyScope(ctx) !== null) {
      if (t !== 'agency' && t !== 'publisher') throw new HttpError(403, 'Erişim yok', 'forbidden');
      if (t === 'agency') assertAgencyAccess(ctx, Number(id));
      else assertAgencyAccess(ctx, ctx.db.value<number>('SELECT agency_id FROM publishers WHERE id = ?', Number(id)));
    }
    return { rows: ctx.db.all(`SELECT * FROM contracts ${t ? 'WHERE party_type = ? AND party_id = ?' : ''} ORDER BY starts_on DESC, id DESC LIMIT 500`, ...(t ? [t, Number(id)] : [])) };
  });
  r.post('/api/contracts', (req, ctx) => {
    need(ctx, 'parties.edit');
    const b = req.body ?? {};
    const type = oneOf(b.party_type, 'party_type', ['agency', 'bd', 'publisher'] as const);
    const pid = reqInt(b.party_id, 'party_id');
    const cur = currency(ctx.db, reqStr(b.currency, 'currency', 8));
    const starts = date(b.starts_on, 'starts_on')!;
    const ends = date(b.ends_on, 'ends_on', false);
    if (ends && ends < starts) throw bad('Bitiş başlangıçtan önce olamaz');
    const terms = b.terms ?? {};
    return ctx.db.tx(() => {
      // A new contract ends the overlapping active one the day before it starts.
      const prevEnd = new Date(Date.parse(starts) - 86_400_000).toISOString().slice(0, 10);
      for (const c of ctx.db.all("SELECT * FROM contracts WHERE party_type = ? AND party_id = ? AND status = 'active' AND (ends_on IS NULL OR ends_on >= ?)", type, pid, starts)) {
        ctx.db.run("UPDATE contracts SET ends_on = ?, status = CASE WHEN ? < starts_on THEN 'cancelled' ELSE 'active' END WHERE id = ?", prevEnd, prevEnd, c.id);
        audit(ctx, 'contract.end', 'contracts', c.id, { ends_on: c.ends_on }, { ends_on: prevEnd }, 'Yeni sözleşme');
      }
      const id = ctx.db.run(
        'INSERT INTO contracts (party_type, party_id, kind, currency, fixed_salary_minor, min_guarantee_minor, payment_schedule, terms, starts_on, ends_on, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        type,
        pid,
        reqStr(b.kind, 'kind', 60),
        cur.code,
        b.fixed_salary ? parseMinor(b.fixed_salary, cur.decimals) : 0n,
        b.min_guarantee ? parseMinor(b.min_guarantee, cur.decimals) : 0n,
        oneOf(b.payment_schedule, 'payment_schedule', ['weekly', 'monthly'] as const, 'monthly'),
        JSON.stringify(terms),
        starts,
        ends,
        ctx.user!.id,
      ).id;
      audit(ctx, 'contract.create', 'contracts', id, null, b);
      return { id };
    });
  });
  r.post('/api/contracts/:id/end', (req, ctx) => {
    need(ctx, 'parties.edit');
    const c = ctx.db.get('SELECT * FROM contracts WHERE id = ?', Number(req.params.id));
    if (!c) throw notFound('Sözleşme');
    const ends = date(req.body?.ends_on, 'ends_on')!;
    ctx.db.run("UPDATE contracts SET ends_on = ?, status = 'ended' WHERE id = ?", ends, c.id);
    audit(ctx, 'contract.end', 'contracts', c.id, { ends_on: c.ends_on, status: c.status }, { ends_on: ends, status: 'ended' }, reason(req.body));
    return { ok: true };
  });
  r.get('/api/parties/:type/:id/finance', (req, ctx) => {
    need(ctx, 'parties.view');
    const type = oneOf(req.params.type, 'type', ['agency', 'bd', 'publisher'] as const);
    const id = Number(req.params.id);
    if (agencyScope(ctx) !== null) {
      if (type === 'bd') throw new HttpError(403, 'Erişim yok', 'forbidden');
      assertAgencyAccess(ctx, type === 'agency' ? id : ctx.db.value<number>('SELECT agency_id FROM publishers WHERE id = ?', id));
    }
    const { from, to } = range(req, ctx);
    return partyFinance(ctx.db, type, id, from, to);
  });

  // ---- statements & payouts --------------------------------------------------------------
  r.get('/api/statements', (req, ctx) => {
    need(ctx, 'statements.view');
    const { limit, offset } = page(req);
    const where: string[] = [];
    const p: any[] = [];
    for (const f of ['party_type', 'status']) {
      const v = req.query.get(f);
      if (v) {
        where.push(`s.${f} = ?`);
        p.push(v);
      }
    }
    if (req.query.get('party_id')) {
      where.push('s.party_id = ?');
      p.push(Number(req.query.get('party_id')));
    }
    const scope = agencyScope(ctx);
    if (scope !== null) {
      where.push("((s.party_type = 'agency' AND s.party_id = ?) OR (s.party_type = 'publisher' AND s.party_id IN (SELECT id FROM publishers WHERE agency_id = ?)))");
      p.push(scope, scope);
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return {
      rows: ctx.db.all(
        `SELECT s.*, COALESCE(a.name, b.name, pu.name) AS party_name FROM payout_statements s
           LEFT JOIN agencies a ON s.party_type = 'agency' AND a.id = s.party_id
           LEFT JOIN business_developers b ON s.party_type = 'bd' AND b.id = s.party_id
           LEFT JOIN publishers pu ON s.party_type = 'publisher' AND pu.id = s.party_id
           ${w} ORDER BY s.period_end DESC, s.id DESC LIMIT ${limit} OFFSET ${offset}`,
        ...p,
      ),
    };
  });
  r.get('/api/statements/:id', (req, ctx) => {
    need(ctx, 'statements.view');
    const s = ctx.db.get('SELECT * FROM payout_statements WHERE id = ?', Number(req.params.id));
    if (!s) throw notFound('Hakediş');
    if (agencyScope(ctx) !== null) assertAgencyAccess(ctx, s.party_type === 'agency' ? s.party_id : s.party_type === 'publisher' ? ctx.db.value('SELECT agency_id FROM publishers WHERE id = ?', s.party_id) : -1);
    return { statement: s, lines: ctx.db.all('SELECT * FROM statement_lines WHERE statement_id = ? ORDER BY id', s.id), payouts: ctx.db.all('SELECT * FROM payouts WHERE statement_id = ? ORDER BY id', s.id) };
  });
  r.post('/api/statements/calculate', (req, ctx) => {
    need(ctx, 'statements.calculate');
    const type = oneOf(req.body?.party_type, 'party_type', ['agency', 'bd', 'publisher'] as const) as PartyType;
    const from = date(req.body?.from, 'from')!;
    const to = date(req.body?.to, 'to')!;
    if (req.body?.party_id) {
      const s = calculateStatement(ctx, type, reqInt(req.body.party_id, 'party_id'), from, to);
      return { results: [{ party_id: s.party_id, ok: true, statement_id: s.id, total_minor: s.total_minor }] };
    }
    return { results: calculateAll(ctx, type, from, to) };
  });
  r.post('/api/statements/:id/approve', (req, ctx) => {
    need(ctx, 'statements.approve');
    approveStatement(ctx, Number(req.params.id), str(req.body?.note, 'note', { max: 1000 }));
    return { ok: true };
  });
  r.post('/api/statements/:id/cancel', (req, ctx) => {
    need(ctx, 'statements.approve');
    cancelStatement(ctx, Number(req.params.id), reason(req.body)!);
    return { ok: true };
  });
  r.post('/api/statements/:id/dispute', (req, ctx) => {
    need(ctx, 'statements.calculate');
    const s = ctx.db.get('SELECT currency FROM payout_statements WHERE id = ?', Number(req.params.id));
    if (!s) throw notFound('Hakediş');
    setDispute(ctx, Number(req.params.id), parseMinor(reqStr(req.body?.amount, 'amount', 30), currency(ctx.db, s.currency).decimals), reason(req.body)!);
    return { ok: true };
  });
  r.post('/api/statements/:id/pay', (req, ctx) => {
    need(ctx, 'payouts.record');
    const s = ctx.db.get('SELECT currency FROM payout_statements WHERE id = ?', Number(req.params.id));
    if (!s) throw notFound('Hakediş');
    return recordPayout(ctx, Number(req.params.id), {
      amount_minor: parseMinor(reqStr(req.body?.amount, 'amount', 30), currency(ctx.db, s.currency).decimals),
      paid_on: date(req.body?.paid_on, 'paid_on')!,
      method: reqStr(req.body?.method, 'method', 60),
      reference: str(req.body?.reference, 'reference', { max: 200 }),
      idempotency_key: reqStr(req.body?.idempotency_key, 'idempotency_key', 200),
    });
  });
  r.get('/api/adjustments', (req, ctx) => {
    need(ctx, 'statements.view');
    if (agencyScope(ctx) !== null) throw new HttpError(403, 'Erişim yok', 'forbidden');
    return { rows: ctx.db.all('SELECT * FROM payout_adjustments ORDER BY id DESC LIMIT 500') };
  });
  r.post('/api/adjustments', (req, ctx) => {
    need(ctx, 'statements.calculate');
    const b = req.body ?? {};
    const cur = currency(ctx.db, reqStr(b.currency, 'currency', 8));
    return addAdjustment(ctx, {
      party_type: oneOf(b.party_type, 'party_type', ['agency', 'bd', 'publisher'] as const),
      party_id: reqInt(b.party_id, 'party_id'),
      amount_minor: parseMinor(reqStr(b.amount, 'amount', 30), cur.decimals),
      currency: cur.code,
      kind: oneOf(b.kind, 'kind', ['bonus', 'deduction', 'adjustment', 'dispute'] as const),
      reason: reason(b)!,
      booked_on: date(b.booked_on, 'booked_on', false),
    });
  });

  // ---- payment channel fees ------------------------------------------------------------
  r.get('/api/channels/:id/fees', (req, ctx) => {
    need(ctx, 'ledger.view');
    return { rows: ctx.db.all('SELECT * FROM channel_fee_versions WHERE channel_id = ? ORDER BY valid_from DESC, id DESC', Number(req.params.id)) };
  });
  r.post('/api/channels/:id/fees', (req, ctx) => {
    need(ctx, 'channels.edit');
    const b = req.body ?? {};
    const ch = ctx.db.get('SELECT * FROM payment_channels WHERE id = ?', Number(req.params.id));
    if (!ch) throw notFound('Kanal');
    const cur = currency(ctx.db, reqStr(b.currency, 'currency', 8));
    const pct = reqStr(b.percent ?? '0', 'percent', 20);
    if (!isDecString(pct) || dec(pct) < 0n || dec(pct) > dec(100)) throw bad('percent 0–100 arası olmalı');
    const from = date(b.valid_from, 'valid_from')!;
    if (from < today(ctx) && !bool(b.allow_past)) throw bad('Geçmiş tarihli kesinti oranı geçmiş işlemleri değiştirmez; yalnız yeni olaylarda kullanılır. Onaylamak için allow_past gönderin.');
    const m = (v: unknown) => (v ? parseMinor(String(v), cur.decimals) : 0n);
    return ctx.db.tx(() => {
      ctx.db.run('UPDATE channel_fee_versions SET valid_to = ? WHERE channel_id = ? AND valid_to IS NULL AND valid_from < ?', from, ch.id, from);
      const id = ctx.db.run(
        'INSERT INTO channel_fee_versions (channel_id, percent, fixed_fee_minor, refund_fee_minor, chargeback_fee_minor, currency, condition_note, valid_from, created_by) VALUES (?,?,?,?,?,?,?,?,?)',
        ch.id,
        pct,
        m(b.fixed_fee),
        m(b.refund_fee),
        m(b.chargeback_fee),
        cur.code,
        str(b.condition_note, 'condition_note', { max: 500 }),
        from,
        ctx.user!.id,
      ).id;
      audit(ctx, 'channel_fee.create', 'channel_fee_versions', id, null, { channel: ch.code, ...b });
      return { id };
    });
  });

  // ---- technical costs --------------------------------------------------------------------
  r.get('/api/costs', (req, ctx) => {
    need(ctx, 'costs.view');
    const period = reqStr(req.query.get('period') ?? today(ctx).slice(0, 7), 'period', 7);
    if (!/^\d{4}-\d{2}$/.test(period)) throw bad('period YYYY-AA olmalı');
    return { period, lines: serviceCosts(ctx.db, period) };
  });
  r.get('/api/tariffs', (req, ctx) => {
    need(ctx, 'costs.view');
    return { rows: ctx.db.all('SELECT t.*, p.name AS provider FROM cost_tariffs t JOIN service_providers p ON p.id = t.provider_id ORDER BY p.name, t.service, t.valid_from DESC') };
  });
  r.post('/api/tariffs', (req, ctx) => {
    need(ctx, 'costs.edit');
    const b = req.body ?? {};
    const pid = reqInt(b.provider_id, 'provider_id');
    if (!ctx.db.get('SELECT 1 FROM service_providers WHERE id = ?', pid)) throw notFound('Sağlayıcı');
    const cur = currency(ctx.db, reqStr(b.currency, 'currency', 8));
    const service = reqStr(b.service, 'service', 100);
    const from = date(b.valid_from, 'valid_from')!;
    const d = (v: unknown, f: string) => {
      const s = String(v ?? '0');
      if (!isDecString(s) || dec(s) < 0n) throw bad(`${f} negatif olmayan sayı olmalı`);
      return s;
    };
    let tiers: string | null = null;
    if (Array.isArray(b.tiers) && b.tiers.length) {
      b.tiers.forEach((t: any, i: number) => {
        d(t.from, `tiers[${i}].from`);
        d(t.unit_price, `tiers[${i}].unit_price`);
      });
      tiers = JSON.stringify(b.tiers.map((t: any) => ({ from: String(t.from), unit_price: String(t.unit_price) })));
    }
    return ctx.db.tx(() => {
      ctx.db.run('UPDATE cost_tariffs SET valid_to = ? WHERE provider_id = ? AND service = ? AND valid_to IS NULL AND valid_from < ?', from, pid, service, from);
      const id = ctx.db.run(
        `INSERT INTO cost_tariffs (provider_id, service, unit, currency, fixed_monthly_minor, included_quantity, unit_price, tiers, tax_percent, billing_day, payment_terms_days, valid_from, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        pid,
        service,
        reqStr(b.unit, 'unit', 40),
        cur.code,
        b.fixed_monthly ? parseMinor(b.fixed_monthly, cur.decimals) : 0n,
        d(b.included_quantity, 'included_quantity'),
        d(b.unit_price, 'unit_price'),
        tiers,
        d(b.tax_percent, 'tax_percent'),
        int(b.billing_day, 'billing_day', { min: 1, max: 28 }) ?? 1,
        int(b.payment_terms_days, 'payment_terms_days', { min: 0, max: 365 }) ?? 0,
        from,
        ctx.user!.id,
      ).id;
      audit(ctx, 'tariff.create', 'cost_tariffs', id, null, b);
      return { id };
    });
  });
  r.get('/api/usage', (req, ctx) => {
    need(ctx, 'costs.view');
    const period = req.query.get('period');
    return { rows: ctx.db.all(`SELECT u.*, p.name AS provider FROM service_usage_records u JOIN service_providers p ON p.id = u.provider_id ${period ? 'WHERE u.period = ?' : ''} ORDER BY u.id DESC LIMIT 500`, ...(period ? [period] : [])) };
  });
  r.post('/api/usage', (req, ctx) => {
    need(ctx, 'costs.edit');
    const b = req.body ?? {};
    const res = ingestEvent(ctx, { type: 'usage', idempotency_key: b.idempotency_key || `manual-usage:${ctx.now().getTime()}:${Math.random()}`, ...b }, 'manual');
    if (res.status === 'error') throw bad(res.error!, res.details);
    audit(ctx, 'usage.create', 'service_usage_records', res.ids?.[0] ?? null, null, b);
    return res;
  });
  r.get('/api/invoices', (_req, ctx) => {
    need(ctx, 'costs.view');
    return {
      rows: ctx.db.all(
        `SELECT i.*, p.name AS provider, (SELECT json_object('status', r.status, 'difference_minor', r.difference_minor, 'system_minor', r.system_minor) FROM reconciliations r WHERE r.ref = 'invoice:' || i.id ORDER BY r.id DESC LIMIT 1) AS reconciliation
           FROM service_invoices i JOIN service_providers p ON p.id = i.provider_id ORDER BY i.period DESC, i.id DESC LIMIT 500`,
      ).map((x) => ({ ...x, reconciliation: x.reconciliation ? JSON.parse(x.reconciliation) : null })),
    };
  });
  r.post('/api/invoices', (req, ctx) => {
    need(ctx, 'costs.edit');
    const b = req.body ?? {};
    const cur = currency(ctx.db, reqStr(b.currency, 'currency', 8));
    const period = reqStr(b.period, 'period', 7);
    if (!/^\d{4}-\d{2}$/.test(period)) throw bad('period YYYY-AA olmalı');
    const id = ctx.db.run(
      'INSERT INTO service_invoices (provider_id, period, invoice_no, currency, amount_minor, tax_minor, due_on, paid_on, attachment_ref, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)',
      reqInt(b.provider_id, 'provider_id'),
      period,
      str(b.invoice_no, 'invoice_no', { max: 100 }),
      cur.code,
      parseMinor(reqStr(b.amount, 'amount', 30), cur.decimals),
      b.tax ? parseMinor(b.tax, cur.decimals) : 0n,
      date(b.due_on, 'due_on', false),
      date(b.paid_on, 'paid_on', false),
      str(b.attachment_ref, 'attachment_ref', { max: 500 }),
      ctx.user!.id,
    ).id;
    audit(ctx, 'invoice.create', 'service_invoices', id, null, b);
    return { id, reconciliation: reconcileInvoice(ctx, id) };
  });
  r.post('/api/invoices/:id/pay', (req, ctx) => {
    need(ctx, 'costs.edit');
    const inv = ctx.db.get('SELECT * FROM service_invoices WHERE id = ?', Number(req.params.id));
    if (!inv) throw notFound('Fatura');
    if (inv.paid_on) throw conflict('Fatura zaten ödenmiş');
    const paid = date(req.body?.paid_on, 'paid_on')!;
    ctx.db.tx(() => {
      ctx.db.run('UPDATE service_invoices SET paid_on = ? WHERE id = ?', paid, inv.id);
      const total = BigInt(inv.amount_minor) + BigInt(inv.tax_minor);
      ctx.db.run(
        "INSERT INTO financial_transactions (idempotency_key, type, occurred_at, booked_on, currency, amount_minor, net_minor, source, source_ref, created_by) VALUES (?, 'expense_payment', ?, ?, ?, ?, ?, 'manual', ?, ?)",
        `invoice:${inv.id}`,
        paid + 'T00:00:00.000Z',
        paid,
        inv.currency,
        -total,
        -total,
        `invoice:${inv.id}`,
        ctx.user!.id,
      );
    });
    audit(ctx, 'invoice.pay', 'service_invoices', inv.id, { paid_on: null }, { paid_on: paid });
    return { ok: true };
  });
  r.post('/api/invoices/:id/reconcile', (req, ctx) => {
    need(ctx, 'costs.edit');
    return reconcileInvoice(ctx, Number(req.params.id), str(req.body?.note, 'note', { max: 1000 }));
  });
  r.get('/api/reconciliations', (_req, ctx) => {
    need(ctx, 'costs.view');
    return { rows: ctx.db.all('SELECT * FROM reconciliations ORDER BY id DESC LIMIT 500') };
  });

  // ---- Lucky Gift --------------------------------------------------------------------------
  r.get('/api/lucky', (_req, ctx) => {
    need(ctx, 'lucky.view');
    return {
      rows: ctx.db.all('SELECT * FROM lucky_gift_configurations ORDER BY code').map((c) => ({
        ...c,
        versions: ctx.db.all('SELECT * FROM lucky_gift_config_versions WHERE config_id = ? ORDER BY version DESC', c.id).map((v) => {
          const odds = JSON.parse(v.odds);
          return { ...v, odds, expected_multiplier: fmt(expectedMultiplier(odds), 6) };
        }),
      })),
    };
  });
  r.post('/api/lucky/:code/versions', (req, ctx) => {
    need(ctx, 'lucky.edit');
    return createLuckyVersion(ctx, reqStr(req.params.code, 'code', 60).toUpperCase(), req.body ?? {});
  });
  r.post('/api/lucky/versions/:id/activate', (req, ctx) => {
    need(ctx, 'lucky.edit');
    const v = ctx.db.get('SELECT v.*, c.code FROM lucky_gift_config_versions v JOIN lucky_gift_configurations c ON c.id = v.config_id WHERE v.id = ?', Number(req.params.id));
    if (!v) throw notFound('Lucky sürümü');
    if (v.status !== 'draft') throw conflict('Yalnız taslak sürüm yürürlüğe alınabilir');
    return requestAction(ctx, 'lucky.activate', 'lucky_gift_config_versions', v.id, { version_id: v.id }, `${v.code} v${v.version} olasılık tablosu yürürlüğe alınsın`);
  });
  r.get('/api/lucky/analysis', (req, ctx) => {
    need(ctx, 'lucky.view');
    const { from, to } = range(req, ctx);
    return { rows: luckyAnalysis(ctx.db, from, to + 'T23:59:59.999Z') };
  });
  r.get('/api/lucky/results', (req, ctx) => {
    need(ctx, 'lucky.view');
    const { limit, offset } = page(req);
    return {
      rows: ctx.db.all(
        `SELECT r.*, c.code, v.version FROM lucky_gift_results r JOIN lucky_gift_config_versions v ON v.id = r.config_version_id JOIN lucky_gift_configurations c ON c.id = v.config_id
          ORDER BY r.id DESC LIMIT ${limit} OFFSET ${offset}`,
      ),
    };
  });

  // ---- expenses --------------------------------------------------------------------------
  r.get('/api/expenses', (req, ctx) => {
    need(ctx, 'expenses.view');
    const { from, to } = range(req, ctx);
    const status = req.query.get('status');
    return {
      rows: ctx.db.all(
        `SELECT e.*, c.name AS category FROM expense_records e JOIN expense_categories c ON c.id = e.category_id
          WHERE e.accrual_date BETWEEN ? AND ? ${status ? 'AND e.status = ?' : ''} ORDER BY e.accrual_date DESC, e.id DESC LIMIT 1000`,
        ...(status ? [from, to, status] : [from, to]),
      ),
    };
  });
  r.post('/api/expenses', (req, ctx) => {
    need(ctx, 'expenses.edit');
    return createExpense(ctx, req.body ?? {});
  });
  r.post('/api/expenses/:id/pay', (req, ctx) => {
    need(ctx, 'expenses.edit');
    payExpense(ctx, Number(req.params.id), date(req.body?.paid_on, 'paid_on')!);
    return { ok: true };
  });
  r.post('/api/expenses/:id/cancel', (req, ctx) => {
    need(ctx, 'expenses.edit');
    cancelExpense(ctx, Number(req.params.id), reason(req.body)!);
    return { ok: true };
  });
  r.post('/api/expenses/recurring/generate', (req, ctx) => {
    need(ctx, 'expenses.edit');
    return { created: generateRecurring(ctx, date(req.body?.until ?? today(ctx), 'until')!) };
  });

  // ---- cash --------------------------------------------------------------------------------
  r.get('/api/cash/snapshots', (_req, ctx) => {
    need(ctx, 'reports.view');
    return { rows: ctx.db.all('SELECT s.*, a.name, a.currency FROM cash_snapshots s JOIN cash_accounts a ON a.id = s.account_id ORDER BY s.as_of DESC, s.id DESC LIMIT 500') };
  });
  r.post('/api/cash/snapshots', (req, ctx) => {
    need(ctx, 'expenses.edit');
    const a = ctx.db.get('SELECT * FROM cash_accounts WHERE id = ?', reqInt(req.body?.account_id, 'account_id'));
    if (!a) throw notFound('Hesap');
    const id = ctx.db.run(
      'INSERT INTO cash_snapshots (account_id, as_of, balance_minor, source, created_by) VALUES (?,?,?,?,?)',
      a.id,
      date(req.body?.as_of, 'as_of')!,
      parseMinor(reqStr(req.body?.balance, 'balance', 30), currency(ctx.db, a.currency).decimals),
      'manual',
      ctx.user!.id,
    ).id;
    audit(ctx, 'cash.snapshot', 'cash_snapshots', id, null, req.body);
    return { id };
  });

  // ---- reports -----------------------------------------------------------------------------
  const reports: Record<string, (ctx: Ctx, from: string, to: string) => any> = {
    pnl: (ctx, from, to) => summary(ctx.db, from, to, to < today(ctx) ? to : today(ctx)),
    agencies: (ctx, from, to) => agencyContribution(ctx.db, from, to, agencyScope(ctx)),
    unit: (ctx, from, to) => unitEconomics(ctx.db, from, to),
    catalog: (ctx, from, to) => catalogReport(ctx.db, from, to),
    lucky: (ctx, from, to) => ({ rows: luckyAnalysis(ctx.db, from, to + 'T23:59:59.999Z') }),
    series: (ctx, from, to) => dailySeries(ctx.db, from, to),
    bds: (ctx, from, to) => ({
      rows: ctx.db.all("SELECT id FROM business_developers WHERE status = 'active'").map((b) => {
        const f = partyFinance(ctx.db, 'bd', b.id, from, to);
        return { id: b.id, code: f.party.code, name: f.party.name, currency: f.currency, ...f.variables, total_minor: f.total_minor, paid_minor: f.paid_minor, pending_minor: f.pending_minor };
      }),
    }),
    publishers: (ctx, from, to) => ({
      rows: ctx.db
        .all(`SELECT id FROM publishers WHERE status = 'active' ${agencyScope(ctx) !== null ? 'AND agency_id = ?' : ''} LIMIT 1000`, ...(agencyScope(ctx) !== null ? [agencyScope(ctx)!] : []))
        .map((p) => {
          const f = partyFinance(ctx.db, 'publisher', p.id, from, to);
          return { id: p.id, external_id: f.party.external_id, name: f.party.name, currency: f.currency, ...f.variables, total_minor: f.total_minor, paid_minor: f.paid_minor, pending_minor: f.pending_minor };
        }),
    }),
  };
  r.get('/api/reports/:name', (req, ctx) => {
    const name = req.params.name;
    const fn = reports[name];
    if (!fn) throw notFound('Rapor');
    need(ctx, 'reports.view');
    if (agencyScope(ctx) !== null && !['agencies', 'publishers'].includes(name)) throw new HttpError(403, 'Ajans kullanıcıları yalnız kendi ajans ve yayıncı raporlarını görebilir', 'forbidden');
    const { from, to } = range(req, ctx);
    const data = fn(ctx, from, to);
    if (req.query.get('format') === 'csv') {
      need(ctx, 'reports.export');
      audit(ctx, 'report.export', 'reports', name, null, { from, to });
      const rows = flattenReport(name, data);
      return { __raw: toCsv(rows), __type: 'text/csv; charset=utf-8', __file: `${name}_${from}_${to}.csv` };
    }
    return data;
  });

  // ---- simulation --------------------------------------------------------------------------
  r.post('/api/simulation/run', (req, ctx) => {
    need(ctx, 'simulation.use');
    return runSimulation(ctx.db, req.body?.inputs ?? {}, Array.isArray(req.body?.presets) ? req.body.presets.map(String) : undefined);
  });
  r.get('/api/forecasts', (_req, ctx) => {
    need(ctx, 'simulation.use');
    return { rows: ctx.db.all('SELECT * FROM forecasts ORDER BY id DESC').map((f) => ({ ...f, inputs: JSON.parse(f.inputs) })) };
  });
  r.post('/api/forecasts', (req, ctx) => {
    need(ctx, 'simulation.use');
    const id = ctx.db.run('INSERT INTO forecasts (name, inputs, created_by) VALUES (?,?,?)', reqStr(req.body?.name, 'name', 200), JSON.stringify(req.body?.inputs ?? {}), ctx.user!.id).id;
    return { id };
  });

  // ---- alerts --------------------------------------------------------------------------------
  r.get('/api/alerts', (req, ctx) => {
    need(ctx, 'alerts.view');
    const status = req.query.get('status') ?? 'open';
    return { rows: ctx.db.all(`SELECT * FROM alerts ${status === 'all' ? '' : 'WHERE status = ?'} ORDER BY id DESC LIMIT 500`, ...(status === 'all' ? [] : [status])) };
  });
  r.post('/api/alerts/evaluate', (_req, ctx) => {
    need(ctx, 'alerts.view');
    return evaluateAlerts(ctx);
  });
  r.post('/api/alerts/:id/:action', (req, ctx) => {
    need(ctx, 'alerts.view');
    const action = oneOf(req.params.action, 'action', ['acknowledge', 'resolve'] as const);
    const a = ctx.db.get('SELECT * FROM alerts WHERE id = ?', Number(req.params.id));
    if (!a) throw notFound('Uyarı');
    const status = action === 'acknowledge' ? 'acknowledged' : 'resolved';
    ctx.db.run('UPDATE alerts SET status = ?, acknowledged_by = ?, acknowledged_at = ? WHERE id = ?', status, ctx.user!.id, ctx.now().toISOString(), a.id);
    audit(ctx, `alert.${action}`, 'alerts', a.id, { status: a.status }, { status }, str(req.body?.note, 'note', { max: 500 }));
    return { ok: true };
  });
  r.get('/api/alert-rules', (_req, ctx) => {
    need(ctx, 'alerts.view');
    return { rows: ctx.db.all('SELECT * FROM alert_rules ORDER BY id').map((x) => ({ ...x, params: JSON.parse(x.params) })) };
  });
  r.post('/api/alert-rules', (req, ctx) => {
    need(ctx, 'alerts.manage');
    const kind = reqStr(req.body?.kind, 'kind', 60);
    const params = validateAlertParams(kind, req.body?.params);
    const id = ctx.db.run(
      'INSERT INTO alert_rules (kind, name, params, severity, notify_email, active) VALUES (?,?,?,?,?,1)',
      kind,
      str(req.body?.name, 'name', { max: 200 }) ?? ALERT_KINDS[kind].label,
      JSON.stringify(params),
      oneOf(req.body?.severity, 'severity', ['info', 'warning', 'critical'] as const, 'warning'),
      str(req.body?.notify_email, 'notify_email', { max: 200 }),
    ).id;
    audit(ctx, 'alert_rule.create', 'alert_rules', id, null, req.body);
    return { id };
  });
  r.put('/api/alert-rules/:id', (req, ctx) => {
    need(ctx, 'alerts.manage');
    const before = ctx.db.get('SELECT * FROM alert_rules WHERE id = ?', Number(req.params.id));
    if (!before) throw notFound('Uyarı kuralı');
    const params = req.body?.params ? validateAlertParams(before.kind, req.body.params) : JSON.parse(before.params);
    ctx.db.run(
      'UPDATE alert_rules SET name = ?, params = ?, severity = ?, notify_email = ?, active = ? WHERE id = ?',
      str(req.body?.name ?? before.name, 'name', { max: 200 }),
      JSON.stringify(params),
      oneOf(req.body?.severity ?? before.severity, 'severity', ['info', 'warning', 'critical'] as const),
      str(req.body?.notify_email ?? before.notify_email, 'notify_email', { max: 200 }),
      req.body?.active === undefined ? before.active : bool(req.body.active) ? 1 : 0,
      before.id,
    );
    audit(ctx, 'alert_rule.update', 'alert_rules', before.id, before, req.body);
    return { ok: true };
  });

  // ---- integrations ------------------------------------------------------------------------
  r.get('/api/integrations', (_req, ctx) => {
    need(ctx, 'integrations.manage');
    return {
      rows: ctx.db.all('SELECT id, code, name, kind, status, key_prefix, config, retry_policy, last_sync_at, last_error, created_at FROM integration_connections ORDER BY id'),
      batches: ctx.db.all('SELECT * FROM import_batches ORDER BY id DESC LIMIT 100').map((b) => ({ ...b, errors: JSON.parse(b.errors) })),
    };
  });
  r.post('/api/integrations', (req, ctx) => {
    need(ctx, 'integrations.manage');
    const id = ctx.db.run(
      'INSERT INTO integration_connections (code, name, kind, config) VALUES (?,?,?,?)',
      reqStr(req.body?.code, 'code', 60),
      reqStr(req.body?.name, 'name', 200),
      oneOf(req.body?.kind, 'kind', ['rest_api', 'webhook', 'csv', 'provider_api', 'database', 'manual'] as const),
      JSON.stringify(req.body?.config ?? {}),
    ).id;
    audit(ctx, 'integration.create', 'integration_connections', id, null, { ...req.body, config: '[gizli]' });
    return { id };
  });
  r.post('/api/integrations/:id/key', (req, ctx) => {
    need(ctx, 'integrations.manage');
    const i = ctx.db.get('SELECT * FROM integration_connections WHERE id = ?', Number(req.params.id));
    if (!i) throw notFound('Entegrasyon');
    const k = newApiKey();
    ctx.db.run("UPDATE integration_connections SET key_prefix = ?, key_hash = ?, status = CASE WHEN status = 'disabled' THEN 'not_connected' ELSE status END WHERE id = ?", k.prefix, k.hash, i.id);
    audit(ctx, 'integration.key_rotate', 'integration_connections', i.id, { key_prefix: i.key_prefix }, { key_prefix: k.prefix });
    return { key: k.key, note: 'Anahtar yalnız bir kez gösterilir; güvenli bir yerde saklayın.' };
  });
  r.post('/api/integrations/:id/status', (req, ctx) => {
    need(ctx, 'integrations.manage');
    const s = oneOf(req.body?.status, 'status', ['disabled', 'not_connected'] as const);
    ctx.db.run('UPDATE integration_connections SET status = ? WHERE id = ?', s, Number(req.params.id));
    audit(ctx, 'integration.status', 'integration_connections', Number(req.params.id), null, { status: s });
    return { ok: true };
  });

  // ---- users & roles -----------------------------------------------------------------------
  r.get('/api/users', (_req, ctx) => {
    need(ctx, 'users.manage');
    return {
      rows: ctx.db.all('SELECT u.id, u.email, u.name, u.role_id, r.name AS role, u.agency_id, u.active, (u.mfa_secret IS NOT NULL) AS mfa, u.created_at FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.id'),
      roles: ctx.db.all('SELECT * FROM roles ORDER BY id').map((x) => ({ ...x, permissions: JSON.parse(x.permissions) })),
    };
  });
  r.post('/api/users', (req, ctx) => {
    need(ctx, 'users.manage');
    const role = ctx.db.get('SELECT * FROM roles WHERE id = ?', reqInt(req.body?.role_id, 'role_id'));
    if (!role) throw notFound('Rol');
    const agency = int(req.body?.agency_id, 'agency_id');
    if (role.scope === 'agency' && !agency) throw bad('Ajans kapsamlı rol için agency_id zorunlu');
    const email = reqStr(req.body?.email, 'email', 200).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Geçerli bir e-posta girin');
    const id = ctx.db.run('INSERT INTO users (email, name, password_hash, role_id, agency_id) VALUES (?,?,?,?,?)', email, reqStr(req.body?.name, 'name', 200), hashPassword(reqStr(req.body?.password, 'password', 200)), role.id, role.scope === 'agency' ? agency : null).id;
    audit(ctx, 'user.create', 'users', id, null, { email, role: role.key, agency_id: agency });
    return { id };
  });
  r.put('/api/users/:id', (req, ctx) => {
    need(ctx, 'users.manage');
    const u = ctx.db.get('SELECT id, email, name, role_id, agency_id, active FROM users WHERE id = ?', Number(req.params.id));
    if (!u) throw notFound('Kullanıcı');
    if (u.id === ctx.user!.id && (req.body?.active === false || (req.body?.role_id && req.body.role_id !== u.role_id))) throw bad('Kendi rolünüzü veya durumunuzu değiştiremezsiniz');
    const next = {
      name: str(req.body?.name ?? u.name, 'name', { max: 200 }),
      role_id: int(req.body?.role_id ?? u.role_id, 'role_id'),
      agency_id: req.body?.agency_id === undefined ? u.agency_id : int(req.body.agency_id, 'agency_id'),
      active: req.body?.active === undefined ? u.active : bool(req.body.active) ? 1 : 0,
    };
    ctx.db.run('UPDATE users SET name = ?, role_id = ?, agency_id = ?, active = ? WHERE id = ?', next.name, next.role_id, next.agency_id, next.active, u.id);
    if (!next.active || next.role_id !== u.role_id) ctx.db.run('DELETE FROM sessions WHERE user_id = ?', u.id);
    if (req.body?.password) ctx.db.run('UPDATE users SET password_hash = ?, mfa_secret = CASE WHEN ? THEN NULL ELSE mfa_secret END WHERE id = ?', hashPassword(String(req.body.password)), bool(req.body?.reset_mfa) ? 1 : 0, u.id);
    audit(ctx, 'user.update', 'users', u.id, u, { ...next, password_reset: !!req.body?.password });
    return { ok: true };
  });
  r.post('/api/roles', (req, ctx) => {
    need(ctx, 'users.manage');
    const perms = (req.body?.permissions ?? []) as string[];
    const bad2 = perms.filter((p) => !ALL_PERMISSIONS.includes(p as any));
    if (bad2.length) throw bad(`Bilinmeyen yetki: ${bad2.join(', ')}`);
    const id = ctx.db.run(
      'INSERT INTO roles (key, name, scope, permissions) VALUES (?,?,?,?)',
      reqStr(req.body?.key, 'key', 60),
      reqStr(req.body?.name, 'name', 200),
      oneOf(req.body?.scope, 'scope', ['platform', 'agency'] as const, 'platform'),
      JSON.stringify(perms),
    ).id;
    audit(ctx, 'role.create', 'roles', id, null, req.body);
    return { id };
  });
  r.put('/api/roles/:id', (req, ctx) => {
    need(ctx, 'users.manage');
    const role = ctx.db.get('SELECT * FROM roles WHERE id = ?', Number(req.params.id));
    if (!role) throw notFound('Rol');
    if (role.key === 'super_admin') throw bad('Süper yönetici rolü değiştirilemez');
    const perms = (req.body?.permissions ?? JSON.parse(role.permissions)) as string[];
    const bad2 = perms.filter((p) => !ALL_PERMISSIONS.includes(p as any));
    if (bad2.length) throw bad(`Bilinmeyen yetki: ${bad2.join(', ')}`);
    ctx.db.run('UPDATE roles SET name = ?, permissions = ? WHERE id = ?', reqStr(req.body?.name ?? role.name, 'name', 200), JSON.stringify(perms), role.id);
    audit(ctx, 'role.update', 'roles', role.id, { permissions: JSON.parse(role.permissions) }, { permissions: perms });
    return { ok: true };
  });

  // ---- audit -------------------------------------------------------------------------------
  r.get('/api/audit', (req, ctx) => {
    need(ctx, 'audit.view');
    const { limit, offset } = page(req);
    const where: string[] = [];
    const p: any[] = [];
    for (const f of ['entity', 'entity_id', 'user_id']) {
      const v = req.query.get(f);
      if (v) {
        where.push(`${f} = ?`);
        p.push(v);
      }
    }
    const q = req.query.get('q');
    if (q) {
      where.push('(action LIKE ? OR actor LIKE ? OR reason LIKE ?)');
      p.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return { rows: ctx.db.all(`SELECT * FROM audit_logs ${w} ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`, ...p), total: ctx.db.value(`SELECT COUNT(*) FROM audit_logs ${w}`, ...p) };
  });
  r.get('/api/audit/verify', (_req, ctx) => {
    need(ctx, 'audit.view');
    return verifyAuditChain(ctx.db);
  });

  // ---- settings & reference data ---------------------------------------------------------
  r.put('/api/settings', (req, ctx) => {
    need(ctx, 'settings.edit');
    const allowed = ['reporting_currency', 'dual_control', 'company_name', 'timezone'];
    for (const [k, v] of Object.entries(req.body ?? {})) {
      if (!allowed.includes(k)) throw bad(`Ayar değiştirilemez: ${k}`);
      if (k === 'reporting_currency') currency(ctx.db, String(v));
      if (k === 'dual_control' && !['0', '1'].includes(String(v))) throw bad('dual_control 0 veya 1');
      const before = setting(ctx.db, k);
      ctx.db.run('INSERT INTO settings (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', k, String(v), ctx.now().toISOString());
      audit(ctx, 'setting.update', 'settings', k, before, String(v));
    }
    return { ok: true };
  });
  r.post('/api/currencies', (req, ctx) => {
    need(ctx, 'settings.edit');
    const code = reqStr(req.body?.code, 'code', 10).toUpperCase();
    ctx.db.run('INSERT INTO currencies (code, name, decimals, kind) VALUES (?,?,?,?)', code, reqStr(req.body?.name, 'name', 100), reqInt(req.body?.decimals, 'decimals', { min: 0, max: 6 }), oneOf(req.body?.kind, 'kind', ['fiat', 'virtual'] as const));
    audit(ctx, 'currency.create', 'currencies', code, null, req.body);
    return { ok: true };
  });
  const versioned: Record<string, { table: string; perm: string; insert: (ctx: Ctx, b: any) => number }> = {
    rates: {
      table: 'exchange_rates',
      perm: 'settings.edit',
      insert: (ctx, b) => {
        currency(ctx.db, b.base);
        currency(ctx.db, b.quote);
        if (!isDecString(b.rate) || dec(b.rate) <= 0n) throw bad('rate pozitif ondalık olmalı');
        return ctx.db.run('INSERT INTO exchange_rates (base, quote, rate, valid_from, source, created_by) VALUES (?,?,?,?,?,?)', b.base, b.quote, String(b.rate), date(b.valid_from, 'valid_from'), str(b.source, 'source', { max: 100 }) ?? 'manual', ctx.user!.id).id;
      },
    },
    valuations: {
      table: 'unit_valuations',
      perm: 'settings.edit',
      insert: (ctx, b) => {
        if (currency(ctx.db, b.unit).kind !== 'virtual') throw bad('unit sanal birim olmalı (COIN, DIAMOND)');
        if (currency(ctx.db, b.currency).kind !== 'fiat') throw bad('currency gerçek para olmalı');
        if (!isDecString(b.value_per_unit) || dec(b.value_per_unit) < 0n) throw bad('value_per_unit negatif olmayan ondalık olmalı');
        return ctx.db.run(
          'INSERT INTO unit_valuations (unit, currency, value_per_unit, purpose, valid_from, note, created_by) VALUES (?,?,?,?,?,?,?)',
          b.unit,
          b.currency,
          String(b.value_per_unit),
          oneOf(b.purpose, 'purpose', ['revenue', 'payout'] as const),
          date(b.valid_from, 'valid_from'),
          str(b.note, 'note', { max: 500 }),
          ctx.user!.id,
        ).id;
      },
    },
    taxes: {
      table: 'tax_configurations',
      perm: 'settings.edit',
      insert: (ctx, b) => {
        if (!isDecString(b.percent) || dec(b.percent) < 0n || dec(b.percent) > dec(100)) throw bad('percent 0–100 olmalı');
        const applies = reqStr(b.applies_to, 'applies_to', 60);
        const from = date(b.valid_from, 'valid_from')!;
        ctx.db.run('UPDATE tax_configurations SET valid_to = ? WHERE applies_to = ? AND valid_to IS NULL AND valid_from < ?', from, applies, from);
        return ctx.db.run('INSERT INTO tax_configurations (name, applies_to, percent, inclusive, valid_from, created_by) VALUES (?,?,?,?,?,?)', reqStr(b.name, 'name', 100), applies, String(b.percent), b.inclusive === false || b.inclusive === 0 ? 0 : 1, from, ctx.user!.id).id;
      },
    },
  };
  for (const [key, v] of Object.entries(versioned)) {
    r.get(`/api/${key}`, (_req, ctx) => {
      need(ctx, 'reports.view');
      return { rows: ctx.db.all(`SELECT * FROM ${v.table} ORDER BY valid_from DESC, id DESC LIMIT 500`) };
    });
    r.post(`/api/${key}`, (req, ctx) => {
      need(ctx, v.perm);
      const id = ctx.db.tx(() => v.insert(ctx, req.body ?? {}));
      audit(ctx, `${v.table}.create`, v.table, id, null, req.body);
      return { id };
    });
  }
  r.get('/api/periods', (_req, ctx) => {
    need(ctx, 'reports.view');
    return { rows: ctx.db.all('SELECT * FROM periods ORDER BY starts_on DESC') };
  });
  r.post('/api/periods', (req, ctx) => {
    need(ctx, 'periods.close');
    const s = date(req.body?.starts_on, 'starts_on')!;
    const e = date(req.body?.ends_on, 'ends_on')!;
    if (e < s) throw bad('Bitiş başlangıçtan önce olamaz');
    if (ctx.db.get('SELECT 1 FROM periods WHERE starts_on <= ? AND ends_on >= ?', e, s)) throw conflict('Dönem başka bir dönemle çakışıyor');
    const id = ctx.db.run('INSERT INTO periods (starts_on, ends_on) VALUES (?,?)', s, e).id;
    audit(ctx, 'period.create', 'periods', id, null, { starts_on: s, ends_on: e });
    return { id };
  });
  r.post('/api/periods/:id/close', (req, ctx) => {
    need(ctx, 'periods.close');
    return requestPeriodClose(ctx, Number(req.params.id));
  });

  r.post('/api/admin/backup', (_req, ctx) => {
    need(ctx, 'settings.edit');
    const dir = join(cfg.dataDir, 'backups');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `finance-${ctx.now().toISOString().replace(/[:.]/g, '-')}.db`);
    ctx.db.raw.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    audit(ctx, 'admin.backup', 'database', null, null, { file });
    return { file };
  });

  return r;
}

function createExpense(ctx: Ctx, b: any) {
  const cat = ctx.db.get('SELECT * FROM expense_categories WHERE id = ?', reqInt(b.category_id, 'category_id'));
  if (!cat) throw notFound('Kategori');
  const cur = currency(ctx.db, reqStr(b.currency, 'currency', 8));
  const tx = date(b.tx_date, 'tx_date')!;
  const recurrence = oneOf(b.recurrence, 'recurrence', ['none', 'monthly', 'yearly', 'days'] as const, 'none');
  const id = ctx.db.run(
    `INSERT INTO expense_records (category_id, vendor, description, nature, currency, amount_minor, tax_minor, tx_date, accrual_date, due_date, status, recurrence, recurrence_days, recurrence_until, module, attachment_ref, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?, 'unpaid', ?,?,?,?,?,?)`,
    cat.id,
    str(b.vendor, 'vendor', { max: 200 }),
    reqStr(b.description, 'description', 500),
    oneOf(b.nature, 'nature', ['fixed', 'variable'] as const, cat.nature),
    cur.code,
    parseMinor(reqStr(b.amount, 'amount', 30), cur.decimals),
    b.tax ? parseMinor(b.tax, cur.decimals) : 0n,
    tx,
    date(b.accrual_date, 'accrual_date', false) ?? tx,
    date(b.due_date, 'due_date', false),
    recurrence,
    recurrence === 'days' ? reqInt(b.recurrence_days, 'recurrence_days', { min: 1, max: 3650 }) : null,
    date(b.recurrence_until, 'recurrence_until', false),
    str(b.module, 'module', { max: 100 }),
    str(b.attachment_ref, 'attachment_ref', { max: 500 }),
    ctx.user?.id ?? null,
  ).id;
  audit(ctx, 'expense.create', 'expense_records', id, null, b);
  return { id };
}

function publicUser(ctx: Ctx) {
  const u = ctx.user!;
  return { id: u.id, email: u.email, name: u.name, role: u.role_key, role_name: u.role_name, scope: u.scope, agency_id: u.agency_id, permissions: [...u.permissions] };
}

/** Flattens a report object into CSV rows. */
function flattenReport(name: string, data: any): Record<string, unknown>[] {
  const big = (v: unknown) => (typeof v === 'bigint' ? v.toString() : v);
  const norm = (rows: any[]) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'object' && v !== null && typeof v !== 'bigint' ? JSON.stringify(v, (_k, x) => big(x)) : big(v)])));
  if (name === 'pnl') {
    const rows: Record<string, unknown>[] = [];
    const walk = (prefix: string, o: any) => {
      for (const [k, v] of Object.entries(o ?? {})) {
        if (typeof v === 'bigint' || typeof v === 'number' || typeof v === 'string' || v === null) rows.push({ kalem: prefix + k, tutar_minor: big(v), para_birimi: data.currency });
        else if (!Array.isArray(v)) walk(`${prefix}${k}.`, v);
      }
    };
    walk('', { revenue: data.revenue, commissions: data.commissions, payroll: data.payroll, services: { total: data.services.total, by_provider: data.services.by_provider }, catalog: { total: data.catalog.total }, expenses: data.expenses, totals: data.totals });
    return rows;
  }
  if (name === 'series') return norm(data.series);
  if (name === 'unit') return norm([data]);
  if (name === 'catalog') return norm([...data.items, ...data.pk]);
  return norm(data.rows ?? []);
}

