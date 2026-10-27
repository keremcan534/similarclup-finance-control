// Maker-checker approvals for critical actions, rule activation, and accounting period close.

import { actorId, audit, need, setting, type Ctx } from '../context.ts';
import { bad, conflict, forbidden, notFound } from '../lib/http.ts';
import { findConflicts, type RuleConfig } from './commission.ts';
import { activateLuckyVersion } from './lucky.ts';

type Handler = { perm: string; run: (ctx: Ctx, payload: any) => unknown };

const HANDLERS: Record<string, Handler> = {
  'rule.activate': { perm: 'rules.activate', run: (ctx, p) => activateRuleVersion(ctx, p.version_id, p.valid_from) },
  'period.close': { perm: 'periods.close', run: (ctx, p) => closePeriod(ctx, p.period_id) },
  'lucky.activate': { perm: 'lucky.edit', run: (ctx, p) => activateLuckyVersion(ctx, p.version_id) },
};

/**
 * Requests a critical action. With dual control on, it waits for a different user with the same
 * permission; with it off (single-operator setups) it runs at once. Both paths are audited.
 */
export function requestAction(ctx: Ctx, action: string, entity: string, entityId: number | string, payload: unknown, summary: string) {
  const h = HANDLERS[action];
  if (!h) throw bad(`Bilinmeyen onay işlemi: ${action}`);
  const { db } = ctx;
  if (db.get("SELECT 1 FROM approvals WHERE action = ? AND entity = ? AND entity_id = ? AND status = 'pending'", action, entity, String(entityId))) throw conflict('Bu işlem için bekleyen bir onay talebi zaten var');
  if (setting(db, 'dual_control') !== '1') {
    need(ctx, h.perm);
    const result = h.run(ctx, payload);
    audit(ctx, `${action}.direct`, entity, entityId, null, payload, 'Çift onay kapalı');
    return { status: 'executed', result };
  }
  const id = db.run('INSERT INTO approvals (action, entity, entity_id, payload, summary, requested_by) VALUES (?,?,?,?,?,?)', action, entity, String(entityId), JSON.stringify(payload), summary, actorId(ctx)).id;
  audit(ctx, 'approval.request', 'approvals', id, null, { action, entity, entity_id: entityId, payload, summary });
  return { status: 'pending', approval_id: id };
}

export function decide(ctx: Ctx, id: number, approve: boolean, note: string | null) {
  const { db } = ctx;
  const a = db.get('SELECT * FROM approvals WHERE id = ?', id);
  if (!a) throw notFound('Onay talebi');
  if (a.status !== 'pending') throw conflict('Talep zaten sonuçlandırılmış');
  const h = HANDLERS[a.action];
  if (approve) need(ctx, h.perm);
  if (approve && a.requested_by === actorId(ctx)) throw forbidden('Görevler ayrılığı: kendi talebinizi onaylayamazsınız');
  if (!approve && a.requested_by !== actorId(ctx)) need(ctx, h.perm);
  return db.tx(() => {
    db.run('UPDATE approvals SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?', approve ? 'approved' : a.requested_by === actorId(ctx) ? 'cancelled' : 'rejected', actorId(ctx), ctx.now().toISOString(), note, id);
    let result: unknown = null;
    if (approve) result = h.run(ctx, JSON.parse(a.payload));
    else if (a.action === 'rule.activate') db.run("UPDATE commission_rule_versions SET status = 'draft' WHERE id = ? AND status = 'pending_approval'", JSON.parse(a.payload).version_id);
    audit(ctx, approve ? 'approval.approve' : 'approval.reject', 'approvals', id, { status: 'pending' }, { status: approve ? 'approved' : 'rejected', action: a.action }, note);
    return { status: approve ? 'approved' : 'rejected', result };
  });
}

// ---- commission rule versions ---------------------------------------------------------
export function requestRuleActivation(ctx: Ctx, versionId: number, validFrom: string | null) {
  const { db } = ctx;
  const v = db.get('SELECT v.*, r.code FROM commission_rule_versions v JOIN commission_rules r ON r.id = v.rule_id WHERE v.id = ?', versionId);
  if (!v) throw notFound('Kural sürümü');
  if (v.status !== 'draft') throw conflict('Yalnız taslak sürüm yürürlüğe alınabilir');
  const from = validFrom ?? ctx.now().toISOString();
  if (from.slice(0, 10) < ctx.now().toISOString().slice(0, 10)) throw bad('Kural geriye dönük yürürlüğe alınamaz; geçmiş için düzeltme kaydı kullanın');
  const conflicts = findConflicts(db, JSON.parse(v.config) as RuleConfig, v.rule_id);
  if (setting(db, 'dual_control') === '1') db.run("UPDATE commission_rule_versions SET status = 'pending_approval' WHERE id = ?", versionId);
  const r = requestAction(ctx, 'rule.activate', 'commission_rule_versions', versionId, { version_id: versionId, valid_from: from, conflicts }, `${v.code} v${v.version} yürürlüğe alınsın (${from.slice(0, 16).replace('T', ' ')})${conflicts.length ? ` · ${conflicts.length} çakışma uyarısı` : ''}`);
  return { ...r, conflicts };
}

export function activateRuleVersion(ctx: Ctx, versionId: number, validFrom: string) {
  const { db } = ctx;
  const v = db.get('SELECT * FROM commission_rule_versions WHERE id = ?', versionId);
  if (!v) throw notFound('Kural sürümü');
  if (!['draft', 'pending_approval'].includes(v.status)) throw conflict('Sürüm yürürlüğe alınabilir durumda değil');
  const now = ctx.now().toISOString();
  const from = validFrom > now ? validFrom : now;
  db.tx(() => {
    // valid_from is frozen once the version leaves draft, so set it while still draft.
    db.run("UPDATE commission_rule_versions SET status = 'draft' WHERE id = ?", versionId);
    db.run('UPDATE commission_rule_versions SET valid_from = ? WHERE id = ?', from, versionId);
    db.run("UPDATE commission_rule_versions SET status = 'retired', valid_to = ? WHERE rule_id = ? AND status = 'active' AND id <> ?", from, v.rule_id, versionId);
    db.run("UPDATE commission_rule_versions SET status = 'active', activated_by = ?, activated_at = ? WHERE id = ?", actorId(ctx), now, versionId);
  });
  audit(ctx, 'rule.activate', 'commission_rule_versions', versionId, { status: v.status }, { status: 'active', valid_from: from });
  return { valid_from: from };
}

export function retireRule(ctx: Ctx, ruleId: number, reason: string) {
  const { db } = ctx;
  const v = db.get("SELECT * FROM commission_rule_versions WHERE rule_id = ? AND status = 'active'", ruleId);
  if (!v) throw conflict('Kuralın aktif sürümü yok');
  const now = ctx.now().toISOString();
  db.run("UPDATE commission_rule_versions SET status = 'retired', valid_to = ? WHERE id = ?", now, v.id);
  audit(ctx, 'rule.retire', 'commission_rule_versions', v.id, { status: 'active' }, { status: 'retired', valid_to: now }, reason);
}

// ---- periods ---------------------------------------------------------------------------
export function closePeriod(ctx: Ctx, periodId: number) {
  const { db } = ctx;
  const p = db.get('SELECT * FROM periods WHERE id = ?', periodId);
  if (!p) throw notFound('Dönem');
  if (p.status === 'closed') throw conflict('Dönem zaten kapalı');
  const issues = db.value<number>(
    `SELECT COUNT(*) FROM calculation_issues i WHERE i.status = 'open' AND EXISTS (
       SELECT 1 FROM financial_transactions t WHERE i.tx_kind = 'financial' AND t.id = i.tx_id AND t.booked_on BETWEEN ? AND ?
       UNION ALL SELECT 1 FROM wallet_transactions w WHERE i.tx_kind = 'wallet' AND w.id = i.tx_id AND w.booked_on BETWEEN ? AND ?)`,
    p.starts_on,
    p.ends_on,
    p.starts_on,
    p.ends_on,
  );
  if (issues) throw conflict(`Dönemde ${issues} çözülmemiş hesaplama sorunu var; önce çözün`);
  const drafts = db.value<number>("SELECT COUNT(*) FROM payout_statements WHERE status = 'calculated' AND period_end BETWEEN ? AND ?", p.starts_on, p.ends_on);
  if (drafts) throw conflict(`Dönemde onaylanmamış ${drafts} hakediş var`);
  db.run("UPDATE periods SET status = 'closed', closed_by = ?, closed_at = ? WHERE id = ?", actorId(ctx), ctx.now().toISOString(), periodId);
  audit(ctx, 'period.close', 'periods', periodId, { status: 'open' }, { status: 'closed' });
}

export function requestPeriodClose(ctx: Ctx, periodId: number) {
  const p = ctx.db.get('SELECT * FROM periods WHERE id = ?', periodId);
  if (!p) throw notFound('Dönem');
  return requestAction(ctx, 'period.close', 'periods', periodId, { period_id: periodId }, `${p.starts_on} – ${p.ends_on} dönemi kapatılsın`);
}
