-- Ajans / BD / Yayıncı from the app (owners, 22 Nov 2026: "şu anda yaptığımız her şey finance kontrol panelinde
-- olmalı"; these were typed in by hand and a streamer the panel didn't know stayed unmatched). server/app-sync.ts
-- reads the app's agency network (GET /api/admin/agency/finance-roster) and keeps these rows in step: app_id is the
-- app's id of the agency or the BD's account (a publisher's is external_id already), app_rate the agency's commission
-- rate in the app now (as the app pays it; the panel's own commission rules are its bookkeeping), synced_at the last
-- time the app was read for it.
ALTER TABLE agencies ADD COLUMN app_id TEXT;
ALTER TABLE agencies ADD COLUMN app_rate REAL;
ALTER TABLE agencies ADD COLUMN app_parent_id TEXT;
ALTER TABLE agencies ADD COLUMN synced_at TEXT;
CREATE UNIQUE INDEX agencies_app_id ON agencies(app_id) WHERE app_id IS NOT NULL;
ALTER TABLE business_developers ADD COLUMN app_id TEXT;
ALTER TABLE business_developers ADD COLUMN synced_at TEXT;
CREATE UNIQUE INDEX business_developers_app_id ON business_developers(app_id) WHERE app_id IS NOT NULL;
ALTER TABLE publishers ADD COLUMN synced_at TEXT;
-- The last run, for the pages ("Uygulamadan eşitlendi: …").
CREATE TABLE app_sync_runs (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ok INTEGER NOT NULL,
  summary TEXT NOT NULL
);
