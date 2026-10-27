// Ledger: every money and virtual-unit movement enters here as an event with an idempotency key.
// Rows are append-only (DB triggers); corrections are new rows that reference the original.
// Fees, taxes and valuations are resolved at the event date and frozen on the row.

import { createHash } from 'node:crypto';

import type { Db, Row } from '../db.ts';
import { actorId, audit, currency, setting, type Ctx } from '../context.ts';
import { HttpError, bad, conflict, datetime, int, notFound, reqStr, str } from '../lib/http.ts';
import { dec, divRound, fromMinor, mul, parseMinor, pctOf, toMinor } from '../lib/money.ts';
import { applyCommissions, reverseCommissions } from './commission.ts';
import { recordLuckyResult } from './lucky.ts';
import { bookingDate, channelFeeVersion, convertMinor, taxConfig, unitValuation } from './rates.ts';

export const EVENT_TYPES = ['purchase', 'refund', 'chargeback', 'gift', 'call', 'game', 'lucky', 'bonus_grant', 'promotion', 'usage', 'publisher', 'coin_spend'] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export type EventResult = { key: string; status: 'created' | 'duplicate' | 'error'; ids?: number[]; error?: string; details?: unknown };

const payloadHash = (e: unknown) => createHash('sha256').update(JSON.stringify(e)).digest('hex').slice(0, 32);

function existing(db: Db, table: 'financial_transactions' | 'wallet_transactions', key: string, hash: string): Row | null {
  const r = db.get(`SELECT id, meta FROM ${table} WHERE idempotency_key = ?`, key);
  if (!r) return null;
  const prev = JSON.parse(r.meta).payload_hash;
  if (prev && prev !== hash) throw conflict(`"${key}" anahtarı farklı içerikle daha önce kullanılmış`);
  return r;
}

/** Finds or creates the publisher for a Similar Club user id; unknown ids become "unmapped". */
export function publisherFor(ctx: Ctx, ref: string): Row {
  const { db } = ctx;
  const p = db.get('SELECT * FROM publishers WHERE external_id = ?', ref);
  if (p) return p;
  const id = db.run("INSERT INTO publishers (external_id, name, status) VALUES (?, ?, 'unmapped')", ref, `Eşleşmemiş ${ref}`).id;
  audit(ctx, 'publisher.auto_create', 'publishers', id, null, { external_id: ref, status: 'unmapped' }, 'Entegrasyon olayında bilinmeyen yayıncı');
  return db.get('SELECT * FROM publishers WHERE id = ?', id)!;
}

type Base = { key: string; occurred_at: string; booked_on: string; source: string; source_ref: string | null; hash: string; created_by: number | null };

function insertFinancial(db: Db, b: Base, f: Row): number {
  return db.run(
    `INSERT INTO financial_transactions (idempotency_key, type, occurred_at, booked_on, user_ref, publisher_id, agency_id, channel_id, product_ref,
       currency, amount_minor, tax_minor, fee_minor, net_minor, fee_version_id, tax_config_id, units, reverses_id, source, source_ref, meta, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    f.key ?? b.key,
    f.type,
    b.occurred_at,
    b.booked_on,
    f.user_ref ?? null,
    f.publisher_id ?? null,
    f.agency_id ?? null,
    f.channel_id ?? null,
    f.product_ref ?? null,
    f.currency,
    f.amount_minor,
    f.tax_minor ?? 0n,
    f.fee_minor ?? 0n,
    f.net_minor,
    f.fee_version_id ?? null,
    f.tax_config_id ?? null,
    f.units ?? 0,
    f.reverses_id ?? null,
    b.source,
    b.source_ref,
    JSON.stringify({ ...(f.meta ?? {}), payload_hash: b.hash }),
    b.created_by,
  ).id;
}

/** Inserts a wallet row; the monetary value is frozen from the valuation in force at the event date. */
function insertWallet(db: Db, b: Base, w: Row): number {
  let valueCurrency: string | null = w.value_currency ?? null;
  let valueMinor: bigint | null = w.value_minor ?? null;
  let valuationId: number | null = null;
  if (valueMinor === null) {
    const val = unitValuation(db, w.unit, 'revenue', b.occurred_at);
    if (val) {
      const c = currency(db, val.currency);
      valueCurrency = val.currency;
      valueMinor = toMinor(mul(dec(BigInt(w.units)), val.value), c.decimals);
      valuationId = val.id;
    }
  }
  return db.run(
    `INSERT INTO wallet_transactions (idempotency_key, type, occurred_at, booked_on, user_ref, publisher_id, agency_id, unit, units, item_ref, event_ref,
       quantity, value_currency, value_minor, valuation_id, reverses_id, financial_tx_id, source, source_ref, meta, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    w.key,
    w.type,
    b.occurred_at,
    b.booked_on,
    w.user_ref ?? null,
    w.publisher_id ?? null,
    w.agency_id ?? null,
    w.unit,
    w.units,
    w.item_ref ?? null,
    w.event_ref ?? null,
    w.quantity ?? null,
    valueCurrency,
    valueMinor,
    valuationId,
    w.reverses_id ?? null,
    w.financial_tx_id ?? null,
    b.source,
    b.source_ref,
    JSON.stringify({ ...(w.meta ?? {}), payload_hash: b.hash }),
    b.created_by,
  ).id;
}

const coins = (v: unknown, field: string) => int(v, field, { required: true, min: 0 }) as number;

// ---- event handlers --------------------------------------------------------------------
function purchase(ctx: Ctx, e: any, b: Base): number[] {
  const { db } = ctx;
  const ch = db.get('SELECT * FROM payment_channels WHERE code = ?', reqStr(e.channel, 'channel'));
  if (!ch) throw bad(`Tanımsız ödeme kanalı: ${e.channel}`);
  const cur = currency(db, reqStr(e.currency, 'currency'));
  if (cur.kind !== 'fiat') throw bad('Satın alma para birimi gerçek para olmalı');
  const gross = parseMinor(reqStr(e.amount, 'amount'), cur.decimals);
  if (gross <= 0n) throw bad('amount pozitif olmalı');

  const tax = taxConfig(db, [`purchase:${ch.code}`, 'purchase'], b.occurred_at);
  let taxMinor = 0n;
  if (tax) {
    const p = dec(tax.percent);
    taxMinor = tax.inclusive ? divRound(gross * p, 100n * 10n ** 12n + p) : toMinor(pctOf(fromMinor(gross, cur.decimals), p), cur.decimals);
  }
  const fee = channelFeeVersion(db, ch.id, b.occurred_at);
  let feeMinor = 0n;
  if (fee) {
    feeMinor = toMinor(pctOf(fromMinor(gross, cur.decimals), dec(fee.percent)), cur.decimals);
    if (fee.fixed_fee_minor) feeMinor += convertMinor(db, fee.fixed_fee_minor, fee.currency, cur.code, b.occurred_at);
  }
  const units = int(e.coins, 'coins', { min: 0 }) ?? 0;
  const id = insertFinancial(db, b, {
    type: 'purchase',
    user_ref: str(e.user_ref, 'user_ref', { max: 100 }),
    channel_id: ch.id,
    product_ref: str(e.product_ref, 'product_ref', { max: 100 }),
    currency: cur.code,
    amount_minor: gross,
    tax_minor: taxMinor,
    fee_minor: feeMinor,
    net_minor: gross - taxMinor - feeMinor,
    fee_version_id: fee?.id ?? null,
    tax_config_id: tax?.id ?? null,
    units,
    meta: fee ? {} : { warning: 'Kanal kesinti tarifesi tanımlı değil — kesinti 0 kabul edilmedi, kontrol edin' },
  });
  const ids = [id];
  if (units > 0)
    ids.push(
      insertWallet(db, b, {
        key: `${b.key}:coins`,
        type: 'coin_credit',
        user_ref: e.user_ref ?? null,
        unit: setting(db, 'coin_unit'),
        units,
        value_currency: cur.code,
        value_minor: gross,
        financial_tx_id: id,
      }),
    );
  applyCommissions(db, 'financial', id);
  return ids;
}

function refund(ctx: Ctx, e: any, b: Base, type: 'refund' | 'chargeback'): number[] {
  const { db } = ctx;
  const orig = db.get("SELECT * FROM financial_transactions WHERE idempotency_key = ? AND type = 'purchase'", reqStr(e.original_key, 'original_key'));
  if (!orig) throw bad(`İade edilecek satın alma bulunamadı: ${e.original_key}`);
  const cur = currency(db, orig.currency);
  const refunded = -BigInt(db.value<number>("SELECT COALESCE(SUM(amount_minor),0) FROM financial_transactions WHERE reverses_id = ? AND type IN ('refund','chargeback')", orig.id) ?? 0);
  const left = BigInt(orig.amount_minor) - refunded;
  const amount = e.amount === undefined || e.amount === null || e.amount === '' ? left : parseMinor(e.amount, cur.decimals);
  if (amount <= 0n) throw bad('İade tutarı pozitif olmalı');
  if (amount > left) throw bad(`İade tutarı kalan tutarı aşıyor (kalan ${fromMinor(left, cur.decimals)})`);
  const tax = divRound(BigInt(orig.tax_minor) * amount, BigInt(orig.amount_minor));
  const fv = orig.channel_id ? channelFeeVersion(db, orig.channel_id, b.occurred_at) : null;
  const feeField = type === 'refund' ? 'refund_fee_minor' : 'chargeback_fee_minor';
  const fee = fv && fv[feeField] ? convertMinor(db, fv[feeField], fv.currency, cur.code, b.occurred_at) : 0n;
  const id = insertFinancial(db, b, {
    type,
    user_ref: orig.user_ref,
    channel_id: orig.channel_id,
    product_ref: orig.product_ref,
    currency: cur.code,
    amount_minor: -amount,
    tax_minor: -tax,
    fee_minor: fee,
    net_minor: -amount + tax - fee,
    fee_version_id: fv?.id ?? null,
    reverses_id: orig.id,
    meta: { reason: str(e.reason, 'reason', { max: 500 }) },
  });
  const ids = [id];
  if (orig.units) {
    const back = Number(divRound(BigInt(orig.units) * amount, BigInt(orig.amount_minor), 'half_up'));
    const credit = db.get("SELECT id FROM wallet_transactions WHERE financial_tx_id = ? AND type = 'coin_credit'", orig.id);
    if (back > 0)
      ids.push(
        insertWallet(db, b, {
          key: `${b.key}:coins`,
          type: 'reversal',
          user_ref: orig.user_ref,
          unit: setting(db, 'coin_unit'),
          units: -back,
          value_currency: cur.code,
          value_minor: -amount,
          reverses_id: credit?.id ?? null,
          financial_tx_id: id,
          meta: { reason: type },
        }),
      );
  }
  reverseCommissions(db, 'financial', orig.id, db.get('SELECT * FROM financial_transactions WHERE id = ?', id) as any, amount, BigInt(orig.amount_minor));
  return ids;
}

function gift(ctx: Ctx, e: any, b: Base): number[] {
  const { db } = ctx;
  const pub = publisherFor(ctx, reqStr(e.publisher_ref, 'publisher_ref', 100));
  const n = coins(e.coins, 'coins');
  if (n <= 0) throw bad('coins pozitif olmalı');
  const unit = setting(db, 'coin_unit');
  const common = { item_ref: str(e.gift_ref, 'gift_ref', { max: 100 }), event_ref: str(e.event_ref, 'event_ref', { max: 100 }), meta: { room_ref: e.room_ref ?? null } };
  const send = insertWallet(db, b, { key: `${b.key}:send`, type: 'gift_send', user_ref: str(e.sender_ref, 'sender_ref', { max: 100 }), unit, units: -n, ...common });
  const recv = insertWallet(db, b, { key: `${b.key}:recv`, type: 'gift_receive', publisher_id: pub.id, agency_id: pub.agency_id, unit, units: n, ...common });
  applyCommissions(db, 'wallet', recv);
  return [send, recv];
}

function call(ctx: Ctx, e: any, b: Base): number[] {
  const { db } = ctx;
  const pub = publisherFor(ctx, reqStr(e.publisher_ref, 'publisher_ref', 100));
  const n = coins(e.coins, 'coins');
  const minutes = reqStr(e.minutes, 'minutes', 20);
  dec(minutes);
  const unit = setting(db, 'coin_unit');
  const kind = e.kind === 'video' ? 'video' : 'voice';
  const charge = insertWallet(db, b, { key: `${b.key}:charge`, type: 'call_charge', user_ref: str(e.user_ref, 'user_ref', { max: 100 }), unit, units: -n, quantity: minutes, item_ref: kind });
  const earn = insertWallet(db, b, { key: `${b.key}:earn`, type: 'call_earning', publisher_id: pub.id, agency_id: pub.agency_id, unit, units: n, quantity: minutes, item_ref: kind });
  applyCommissions(db, 'wallet', earn);
  return [charge, earn];
}

function game(ctx: Ctx, e: any, b: Base): number[] {
  const { db } = ctx;
  const unit = setting(db, 'coin_unit');
  const ref = reqStr(e.game_ref, 'game_ref', 100);
  const user = str(e.user_ref, 'user_ref', { max: 100 });
  const ids = [insertWallet(db, b, { key: `${b.key}:entry`, type: 'game_entry', user_ref: user, unit, units: -coins(e.entry_coins, 'entry_coins'), item_ref: ref })];
  const payout = int(e.payout_coins, 'payout_coins', { min: 0 }) ?? 0;
  if (payout > 0) ids.push(insertWallet(db, b, { key: `${b.key}:result`, type: 'game_result', user_ref: user, unit, units: payout, item_ref: ref }));
  for (const id of ids) applyCommissions(db, 'wallet', id);
  return ids;
}

function grant(ctx: Ctx, e: any, b: Base, type: 'bonus_grant' | 'promotion' | 'coin_spend'): number[] {
  const n = coins(e.coins, 'coins');
  const id = insertWallet(ctx.db, b, {
    key: b.key,
    type,
    user_ref: str(e.user_ref, 'user_ref', { max: 100 }),
    unit: setting(ctx.db, 'coin_unit'),
    units: type === 'coin_spend' ? -n : n,
    item_ref: str(e.item_ref ?? e.campaign_ref, 'campaign_ref', { max: 100 }),
  });
  applyCommissions(ctx.db, 'wallet', id);
  return [id];
}

function lucky(ctx: Ctx, e: any, b: Base): number[] {
  const { db } = ctx;
  const r = recordLuckyResult(ctx, {
    key: b.key,
    config_code: reqStr(e.config_code, 'config_code', 100),
    version: int(e.version, 'version', { min: 1 }),
    user_ref: reqStr(e.user_ref, 'user_ref', 100),
    spent_coins: coins(e.spent_coins, 'spent_coins'),
    random_value: reqStr(e.random_value, 'random_value', 40),
    multiplier: reqStr(e.multiplier, 'multiplier', 20),
    reward_coins: coins(e.reward_coins, 'reward_coins'),
    occurred_at: b.occurred_at,
    source: b.source,
    capped_by: str(e.capped_by, 'capped_by', { max: 20 }),
  });
  const unit = setting(db, 'coin_unit');
  const pub = e.publisher_ref ? publisherFor(ctx, String(e.publisher_ref)) : null;
  const spend = insertWallet(db, b, {
    key: `${b.key}:spend`,
    type: 'lucky_spend',
    user_ref: e.user_ref,
    publisher_id: pub?.id ?? null,
    agency_id: pub?.agency_id ?? null,
    unit,
    units: -r.spent_coins,
    item_ref: e.config_code,
    meta: { lucky_result_id: r.id },
  });
  const ids = [spend];
  if (r.reward_coins > 0)
    ids.push(insertWallet(db, b, { key: `${b.key}:reward`, type: 'lucky_reward', user_ref: e.user_ref, unit, units: r.reward_coins, item_ref: e.config_code, meta: { lucky_result_id: r.id } }));
  applyCommissions(db, 'wallet', spend);
  return ids;
}

function usage(ctx: Ctx, e: any, b: Base): number[] {
  const { db } = ctx;
  const p = db.get('SELECT id FROM service_providers WHERE code = ?', reqStr(e.provider_code, 'provider_code', 100));
  if (!p) throw bad(`Tanımsız servis sağlayıcı: ${e.provider_code}`);
  const period = reqStr(e.period ?? b.occurred_at.slice(0, 7), 'period', 7);
  if (!/^\d{4}-\d{2}$/.test(period)) throw bad('period YYYY-AA olmalı');
  const qty = reqStr(e.quantity, 'quantity', 30);
  if (dec(qty) < 0n) throw bad('quantity negatif olamaz');
  const prev = db.get('SELECT id FROM service_usage_records WHERE idempotency_key = ?', b.key);
  if (prev) return [prev.id];
  return [
    db.run(
      'INSERT INTO service_usage_records (idempotency_key, provider_id, service, period, usage_date, quantity, source, note, created_by) VALUES (?,?,?,?,?,?,?,?,?)',
      b.key,
      p.id,
      reqStr(e.service, 'service', 100),
      period,
      b.occurred_at.slice(0, 10),
      qty,
      b.source,
      str(e.note, 'note', { max: 500 }),
      b.created_by,
    ).id,
  ];
}

function publisherEvent(ctx: Ctx, e: any): number[] {
  const { db } = ctx;
  const ext = reqStr(e.external_id, 'external_id', 100);
  const agency = e.agency_code ? db.get('SELECT id FROM agencies WHERE code = ?', String(e.agency_code)) : null;
  if (e.agency_code && !agency) throw bad(`Tanımsız ajans kodu: ${e.agency_code}`);
  const before = db.get('SELECT * FROM publishers WHERE external_id = ?', ext);
  const name = str(e.name, 'name', { max: 200 }) ?? before?.name ?? ext;
  if (before) {
    db.run("UPDATE publishers SET name = ?, agency_id = ?, status = CASE WHEN status = 'unmapped' THEN 'active' ELSE status END WHERE id = ?", name, agency?.id ?? before.agency_id, before.id);
    audit(ctx, 'publisher.sync', 'publishers', before.id, before, db.get('SELECT * FROM publishers WHERE id = ?', before.id));
    return [before.id];
  }
  const id = db.run('INSERT INTO publishers (external_id, name, agency_id) VALUES (?,?,?)', ext, name, agency?.id ?? null).id;
  audit(ctx, 'publisher.sync', 'publishers', id, null, { external_id: ext, name, agency_id: agency?.id ?? null });
  return [id];
}

/** Processes one event atomically. Duplicate keys return the original ids instead of creating new rows. */
export function ingestEvent(ctx: Ctx, e: any, source: string, sourceRef: string | null = null): EventResult {
  const key = typeof e?.idempotency_key === 'string' ? e.idempotency_key.trim() : '';
  try {
    if (!key || key.length > 200) throw bad('idempotency_key zorunlu (en fazla 200 karakter)');
    const type = e.type as EventType;
    if (!EVENT_TYPES.includes(type)) throw bad(`Bilinmeyen olay türü: ${e.type}`);
    const hash = payloadHash(e);
    const { db } = ctx;
    if (type === 'publisher') return { key, status: 'created', ids: db.tx(() => publisherEvent(ctx, e)) };
    const table = ['purchase', 'refund', 'chargeback'].includes(type) ? 'financial_transactions' : 'wallet_transactions';
    const probeKey = { gift: `${key}:send`, call: `${key}:charge`, game: `${key}:entry`, lucky: `${key}:spend` }[type as string] ?? key;
    if (type !== 'usage') {
      const dup = existing(db, table, probeKey, hash);
      if (dup) return { key, status: 'duplicate', ids: [dup.id] };
    } else if (db.get('SELECT 1 FROM service_usage_records WHERE idempotency_key = ?', key)) return { key, status: 'duplicate' };
    const occurred = datetime(e.occurred_at ?? ctx.now().toISOString(), 'occurred_at');
    if (new Date(occurred).getTime() > ctx.now().getTime() + 5 * 60_000) throw bad('occurred_at gelecekte olamaz');
    const b: Base = { key, occurred_at: occurred, booked_on: bookingDate(db, occurred), source, source_ref: sourceRef, hash, created_by: actorId(ctx) };
    const ids = db.tx(() => {
      switch (type) {
        case 'purchase':
          return purchase(ctx, e, b);
        case 'refund':
        case 'chargeback':
          return refund(ctx, e, b, type);
        case 'gift':
          return gift(ctx, e, b);
        case 'call':
          return call(ctx, e, b);
        case 'game':
          return game(ctx, e, b);
        case 'lucky':
          return lucky(ctx, e, b);
        case 'bonus_grant':
        case 'promotion':
        case 'coin_spend':
          return grant(ctx, e, b, type);
        case 'usage':
          return usage(ctx, e, b);
      }
      throw bad('Desteklenmeyen olay');
    });
    return { key, status: 'created', ids };
  } catch (err) {
    if (err instanceof HttpError) return { key, status: 'error', error: err.message, details: err.details };
    throw err;
  }
}

export function ingestEvents(ctx: Ctx, events: unknown[], source: string, integrationId: number | null, kind = 'events') {
  if (!Array.isArray(events)) throw bad('events bir dizi olmalı');
  if (events.length > 5000) throw bad('Tek seferde en fazla 5000 olay gönderilebilir');
  const results = events.map((e) => ingestEvent(ctx, e, source));
  const ok = results.filter((r) => r.status === 'created').length;
  const dup = results.filter((r) => r.status === 'duplicate').length;
  const errors = results.map((r, i) => ({ ...r, row: i + 1 })).filter((r) => r.status === 'error');
  const batch = ctx.db.run(
    'INSERT INTO import_batches (integration_id, kind, rows_total, rows_ok, rows_duplicate, rows_error, errors, created_by) VALUES (?,?,?,?,?,?,?,?)',
    integrationId,
    kind,
    results.length,
    ok,
    dup,
    errors.length,
    JSON.stringify(errors.slice(0, 200).map((e) => ({ row: e.row, key: e.key, error: e.error, details: e.details }))),
    actorId(ctx),
  ).id;
  if (integrationId)
    ctx.db.run(
      "UPDATE integration_connections SET last_sync_at = ?, status = CASE WHEN status = 'disabled' THEN status ELSE 'connected' END, last_error = ? WHERE id = ?",
      ctx.now().toISOString(),
      errors.length ? `${errors.length} satır hatalı (parti #${batch})` : null,
      integrationId,
    );
  return { batch_id: batch, total: results.length, created: ok, duplicate: dup, errors: errors.length, results };
}

/** Full reversal of a ledger row (manual correction). The original stays; a mirror row is added. */
export function reverseTransaction(ctx: Ctx, kind: 'financial' | 'wallet', id: number, reason: string) {
  const { db } = ctx;
  const table = kind === 'financial' ? 'financial_transactions' : 'wallet_transactions';
  const t = db.get(`SELECT * FROM ${table} WHERE id = ?`, id);
  if (!t) throw notFound('İşlem');
  if (t.reverses_id) throw bad('Ters kayıt yeniden ters çevrilemez');
  // Purchases may already be partly refunded; the refund path reverses only what is left.
  if (kind === 'financial' && t.type === 'purchase') {
    const r = ingestEvent(ctx, { type: 'refund', idempotency_key: `reverse:${t.idempotency_key}`, original_key: t.idempotency_key, reason, occurred_at: ctx.now().toISOString() }, 'manual');
    if (r.status === 'error') throw bad(r.error!);
    audit(ctx, 'ledger.reverse', table, id, t, { reversal_ids: r.ids }, reason);
    return r;
  }
  if (db.get(`SELECT 1 FROM ${table} WHERE reverses_id = ?`, id)) throw conflict('Bu işlem için zaten ters kayıt var');
  const now = ctx.now().toISOString();
  const b: Base = { key: `reverse:${t.idempotency_key}`, occurred_at: now, booked_on: bookingDate(db, now), source: 'manual', source_ref: null, hash: '', created_by: actorId(ctx) };
  const newId = db.tx(() => {
    const rid =
      kind === 'financial'
        ? insertFinancial(db, b, {
            type: 'adjustment',
            user_ref: t.user_ref,
            publisher_id: t.publisher_id,
            agency_id: t.agency_id,
            channel_id: t.channel_id,
            currency: t.currency,
            amount_minor: -BigInt(t.amount_minor),
            tax_minor: -BigInt(t.tax_minor),
            fee_minor: -BigInt(t.fee_minor),
            net_minor: -BigInt(t.net_minor),
            reverses_id: t.id,
            meta: { reason, reversal_of_type: t.type },
          })
        : insertWallet(db, b, {
            key: b.key,
            type: 'reversal',
            user_ref: t.user_ref,
            publisher_id: t.publisher_id,
            agency_id: t.agency_id,
            unit: t.unit,
            units: -t.units,
            item_ref: t.item_ref,
            event_ref: t.event_ref,
            quantity: t.quantity,
            value_currency: t.value_currency,
            value_minor: t.value_minor === null ? null : -BigInt(t.value_minor),
            reverses_id: t.id,
            meta: { reason, reversal_of_type: t.type },
          });
    const row = db.get(`SELECT * FROM ${table} WHERE id = ?`, rid) as any;
    reverseCommissions(db, kind, t.id, row, 1n, 1n);
    return rid;
  });
  audit(ctx, 'ledger.reverse', table, id, t, { reversal_id: newId }, reason);
  return { key: b.key, status: 'created', ids: [newId] };
}
