// Ajans / BD / Yayıncı from the app (owners, 22 Nov 2026: "şu anda yaptığımız her şey finance kontrol panelinde
// olmalı"). The finance book's lists of who is paid (Ajans hesapları, BD hesapları, Yayıncılar) used to be typed in
// by hand, and a streamer the book didn't know stayed "unmatched" with no agency, so no agency commission was worked
// out for their gifts. This reads the app's agency network (GET /api/admin/agency/finance-roster) and keeps the
// book's rows in step: every agency (its code, name, BD, status and the commission rate the app pays it now), every BD
// with an agency, every streamer with their agency. The rows the app owns are found by the app's ids (migration 011);
// rows typed by hand stay as they are. A streamer who left their agency in the app is left without one here.
// Runs from the pages' "Uygulamadan eşitle" (parties.edit) and every hour on its own (main.ts).
import { appCall, type AppLink } from './app-admin.ts';
import { audit, nowIso, type Ctx, type User } from './context.ts';

/** Who the hourly run acts as in the app (read only): never a person. */
export const SYNC_USER: User = {
  id: 999_999_999,
  email: 'otomatik-esitleme@panel',
  name: 'Otomatik eşitleme',
  role_key: 'system',
  role_name: 'Sistem',
  scope: 'platform',
  agency_id: null,
  permissions: new Set(['app.agencies', 'parties.edit']),
};

export type SyncSummary = { agencies: number; bds: number; publishers: number; added: number; left: number };

type Roster = {
  agencies: { id: string; code: string; name: string; status: string; parentId: string | null; bd: string | null; rate: number | null }[];
  bds: { id: string; name: string; publicNo: string | null }[];
  streamers: { id: string; name: string; publicNo: string | null; agencyId: string }[];
};

const clip = (s: unknown, n: number) => String(s ?? '').slice(0, n);

export async function syncFromApp(ctx: Ctx, link: AppLink): Promise<SyncSummary> {
  let r: Roster;
  try {
    r = await appCall(ctx, link, 'GET', '/api/admin/agency/finance-roster');
  } catch (e) {
    ctx.db.run('INSERT INTO app_sync_runs (ok, summary) VALUES (0, ?)', clip((e as Error).message, 300));
    throw e;
  }
  const { db } = ctx;
  const at = nowIso(ctx);
  return db.tx(() => {
    let added = 0;
    // BDs: by the app account's id; the code is the person's ID when the app gives one.
    const bdIds = new Map<string, number>();
    for (const b of r.bds) {
      const row = db.get<{ id: number }>('SELECT id FROM business_developers WHERE app_id = ?', b.id);
      if (row) {
        db.run("UPDATE business_developers SET name = ?, status = 'active', synced_at = ? WHERE id = ?", clip(b.name, 200) || 'BD', at, row.id);
        bdIds.set(b.id, row.id);
      } else {
        const code = `BD-${b.publicNo ?? b.id.slice(0, 8)}`;
        const taken = db.get('SELECT 1 FROM business_developers WHERE code = ?', code);
        const id = db.run('INSERT INTO business_developers (code, name, app_id, synced_at) VALUES (?,?,?,?)', taken ? `BD-${b.id}` : code, clip(b.name, 200) || 'BD', b.id, at).id;
        bdIds.set(b.id, Number(id));
        added++;
      }
    }
    // Agencies: by the app's agency id; a hand-made row with the same code is taken over (its history stays).
    const agencyIds = new Map<string, number>();
    for (const a of r.agencies) {
      const status = a.status === 'approved' ? 'active' : 'passive';
      const bd = a.bd ? (bdIds.get(a.bd) ?? null) : null;
      const row = db.get<{ id: number }>('SELECT id FROM agencies WHERE app_id = ?', a.id) ?? db.get<{ id: number }>('SELECT id FROM agencies WHERE code = ? AND app_id IS NULL', a.code);
      if (row) {
        db.run('UPDATE agencies SET name = ?, bd_id = ?, status = ?, app_id = ?, app_rate = ?, app_parent_id = ?, synced_at = ? WHERE id = ?', clip(a.name, 200), bd, status, a.id, a.rate, a.parentId, at, row.id);
        agencyIds.set(a.id, row.id);
      } else {
        const id = db.run('INSERT INTO agencies (code, name, bd_id, status, app_id, app_rate, app_parent_id, synced_at) VALUES (?,?,?,?,?,?,?,?)', clip(a.code, 40), clip(a.name, 200), bd, status, a.id, a.rate, a.parentId, at).id;
        agencyIds.set(a.id, Number(id));
        added++;
      }
    }
    // Streamers: a publisher's external_id is the app account's id (the gift events' publisher_ref).
    const seen = new Set<string>();
    for (const s of r.streamers) {
      seen.add(s.id);
      const agency = agencyIds.get(s.agencyId) ?? null;
      const row = db.get<{ id: number }>('SELECT id FROM publishers WHERE external_id = ?', s.id);
      if (row) db.run("UPDATE publishers SET name = ?, agency_id = ?, status = CASE WHEN status = 'unmapped' THEN 'active' ELSE status END, synced_at = ? WHERE id = ?", clip(s.name, 200) || s.id, agency, at, row.id);
      else {
        db.run('INSERT INTO publishers (external_id, name, agency_id, synced_at) VALUES (?,?,?,?)', s.id, clip(s.name, 200) || s.id, agency, at);
        added++;
      }
    }
    // Someone the app no longer has in an agency: no agency here either (their past stays as it was booked).
    const gone = db.all<{ id: number; external_id: string }>('SELECT id, external_id FROM publishers WHERE agency_id IS NOT NULL AND synced_at IS NOT NULL');
    let left = 0;
    for (const p of gone)
      if (!seen.has(p.external_id)) {
        db.run('UPDATE publishers SET agency_id = NULL, synced_at = ? WHERE id = ?', at, p.id);
        left++;
      }
    const summary: SyncSummary = { agencies: r.agencies.length, bds: r.bds.length, publishers: r.streamers.length, added, left };
    db.run('INSERT INTO app_sync_runs (ok, summary) VALUES (1, ?)', JSON.stringify(summary));
    audit(ctx, 'parties.sync_app', 'agencies', null, null, summary);
    return summary;
  });
}

/** The last run, for the pages. */
export function lastSync(ctx: Ctx) {
  const r = ctx.db.get<{ at: string; ok: number; summary: string }>('SELECT at, ok, summary FROM app_sync_runs ORDER BY id DESC LIMIT 1');
  if (!r) return null;
  let summary: unknown = r.summary;
  try {
    summary = JSON.parse(r.summary);
  } catch {}
  return { at: r.at, ok: !!r.ok, summary };
}
