-- Similarclup Finance Control — initial schema.
-- Amounts: INTEGER minor units of `currency` (see currencies.decimals). Rates/percents: TEXT decimals.
-- Ledger-type tables are append-only; triggers at the bottom reject UPDATE/DELETE on them.

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------- identity & access
CREATE TABLE roles (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('platform','agency')),
  permissions TEXT NOT NULL DEFAULT '[]',
  system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  agency_id INTEGER REFERENCES agencies(id),
  mfa_secret TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL
);

-- Immutable, hash-chained audit trail.
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  user_id INTEGER,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  before TEXT,
  after TEXT,
  reason TEXT,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE INDEX audit_entity ON audit_logs(entity, entity_id);

-- Maker-checker requests for critical actions.
CREATE TABLE approvals (
  id INTEGER PRIMARY KEY,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  payload TEXT NOT NULL,
  summary TEXT NOT NULL,
  requested_by INTEGER NOT NULL REFERENCES users(id),
  requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT
);

-- ---------------------------------------------------------------- money reference data
CREATE TABLE currencies (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  decimals INTEGER NOT NULL CHECK (decimals BETWEEN 0 AND 6),
  kind TEXT NOT NULL CHECK (kind IN ('fiat','virtual'))
);

CREATE TABLE exchange_rates (
  id INTEGER PRIMARY KEY,
  base TEXT NOT NULL REFERENCES currencies(code),
  quote TEXT NOT NULL REFERENCES currencies(code),
  rate TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX fx_lookup ON exchange_rates(base, quote, valid_from);

-- Monetary value of one virtual unit (coin, diamond) — used for "jeton harcamasının parasal karşılığı".
CREATE TABLE unit_valuations (
  id INTEGER PRIMARY KEY,
  unit TEXT NOT NULL REFERENCES currencies(code),
  currency TEXT NOT NULL REFERENCES currencies(code),
  value_per_unit TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('revenue','payout')),
  valid_from TEXT NOT NULL,
  note TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE tax_configurations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applies_to TEXT NOT NULL,            -- e.g. 'purchase', 'purchase:web', 'expense'
  percent TEXT NOT NULL,
  inclusive INTEGER NOT NULL DEFAULT 1, -- 1: tax is inside the gross amount
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------- parties & contracts
CREATE TABLE business_developers (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','passive')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE agencies (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  contact_name TEXT,
  contact_email TEXT,
  bd_id INTEGER REFERENCES business_developers(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','passive')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE publishers (
  id INTEGER PRIMARY KEY,
  external_id TEXT NOT NULL UNIQUE,     -- Similar Club user id
  name TEXT NOT NULL,
  agency_id INTEGER REFERENCES agencies(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','passive','unmapped')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Contract terms per party. Terms change by adding a new contract row, never editing amounts in place.
CREATE TABLE contracts (
  id INTEGER PRIMARY KEY,
  party_type TEXT NOT NULL CHECK (party_type IN ('agency','bd','publisher')),
  party_id INTEGER NOT NULL,
  kind TEXT NOT NULL,                   -- 'standart', 'maaşlı', 'garanti', ...
  currency TEXT NOT NULL REFERENCES currencies(code),
  fixed_salary_minor INTEGER NOT NULL DEFAULT 0,
  min_guarantee_minor INTEGER NOT NULL DEFAULT 0,
  payment_schedule TEXT NOT NULL DEFAULT 'monthly' CHECK (payment_schedule IN ('weekly','monthly')),
  terms TEXT NOT NULL DEFAULT '{}',     -- free-form documented terms (targets, deduction rules)
  starts_on TEXT NOT NULL,
  ends_on TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended','cancelled')),
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX contract_party ON contracts(party_type, party_id);

-- ---------------------------------------------------------------- payment channels
CREATE TABLE payment_channels (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,                   -- store, card, bank, web, other
  settlement_delay_days INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE channel_fee_versions (
  id INTEGER PRIMARY KEY,
  channel_id INTEGER NOT NULL REFERENCES payment_channels(id),
  percent TEXT NOT NULL DEFAULT '0',
  fixed_fee_minor INTEGER NOT NULL DEFAULT 0,
  refund_fee_minor INTEGER NOT NULL DEFAULT 0,
  chargeback_fee_minor INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL REFERENCES currencies(code),
  condition_note TEXT,
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------- accounting periods
CREATE TABLE periods (
  id INTEGER PRIMARY KEY,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,                -- inclusive
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  closed_by INTEGER,
  closed_at TEXT,
  UNIQUE (starts_on, ends_on)
);

-- ---------------------------------------------------------------- ledgers (append-only)
-- Real money movements: purchases, refunds, chargebacks, payouts, expense payments.
CREATE TABLE financial_transactions (
  id INTEGER PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  booked_on TEXT NOT NULL,              -- accounting date (first open period if occurred in a closed one)
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  user_ref TEXT,
  publisher_id INTEGER REFERENCES publishers(id),
  agency_id INTEGER REFERENCES agencies(id),
  channel_id INTEGER REFERENCES payment_channels(id),
  product_ref TEXT,
  currency TEXT NOT NULL REFERENCES currencies(code),
  amount_minor INTEGER NOT NULL,        -- signed: + inflow, - outflow
  tax_minor INTEGER NOT NULL DEFAULT 0,
  fee_minor INTEGER NOT NULL DEFAULT 0,
  net_minor INTEGER NOT NULL,           -- amount - tax - fee
  fee_version_id INTEGER REFERENCES channel_fee_versions(id),
  tax_config_id INTEGER REFERENCES tax_configurations(id),
  units INTEGER NOT NULL DEFAULT 0,     -- coins credited by a purchase
  reverses_id INTEGER REFERENCES financial_transactions(id),
  source TEXT NOT NULL,                 -- manual, csv, api, system
  source_ref TEXT,
  meta TEXT NOT NULL DEFAULT '{}',
  created_by INTEGER
);
CREATE INDEX ft_type_date ON financial_transactions(type, booked_on);
CREATE INDEX ft_reverses ON financial_transactions(reverses_id);

-- Virtual unit movements: coins and diamonds.
CREATE TABLE wallet_transactions (
  id INTEGER PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  booked_on TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  user_ref TEXT,
  publisher_id INTEGER REFERENCES publishers(id),
  agency_id INTEGER REFERENCES agencies(id),
  unit TEXT NOT NULL REFERENCES currencies(code),
  units INTEGER NOT NULL,               -- signed
  item_ref TEXT,                        -- gift / game / lucky config code
  event_ref TEXT,                       -- PK event, room, campaign
  quantity TEXT,                        -- minutes etc. for per-unit rules
  value_currency TEXT REFERENCES currencies(code),
  value_minor INTEGER,                  -- monetary value at valuation in force (frozen)
  valuation_id INTEGER REFERENCES unit_valuations(id),
  reverses_id INTEGER REFERENCES wallet_transactions(id),
  financial_tx_id INTEGER REFERENCES financial_transactions(id),
  source TEXT NOT NULL,
  source_ref TEXT,
  meta TEXT NOT NULL DEFAULT '{}',
  created_by INTEGER
);
CREATE INDEX wt_type_date ON wallet_transactions(type, booked_on);
CREATE INDEX wt_publisher ON wallet_transactions(publisher_id, booked_on);

-- ---------------------------------------------------------------- commission engine
CREATE TABLE commission_rules (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,               -- agency, bd, publisher, provider, other
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE commission_rule_versions (
  id INTEGER PRIMARY KEY,
  rule_id INTEGER NOT NULL REFERENCES commission_rules(id),
  version INTEGER NOT NULL,
  config TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft','pending_approval','active','retired','rejected')),
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  activated_by INTEGER,
  activated_at TEXT,
  UNIQUE (rule_id, version)
);

-- One row per (transaction, rule version, direction). Never edited; refunds add reversal rows.
CREATE TABLE commission_allocations (
  id INTEGER PRIMARY KEY,
  tx_kind TEXT NOT NULL CHECK (tx_kind IN ('financial','wallet')),
  tx_id INTEGER NOT NULL,
  rule_version_id INTEGER NOT NULL REFERENCES commission_rule_versions(id),
  direction TEXT NOT NULL CHECK (direction IN ('original','reversal')),
  reversal_of_tx_id INTEGER,            -- the refund/reversal transaction that caused a reversal row
  beneficiary_type TEXT NOT NULL,
  beneficiary_id INTEGER,
  beneficiary_name TEXT,
  stage INTEGER NOT NULL,
  currency TEXT NOT NULL REFERENCES currencies(code),
  base_minor INTEGER NOT NULL,
  amount_minor INTEGER NOT NULL,
  booked_on TEXT NOT NULL,
  trace TEXT NOT NULL,                  -- JSON: variables, method, caps, rounding
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (tx_kind, tx_id, rule_version_id, direction, reversal_of_tx_id)
);
CREATE INDEX alloc_benef ON commission_allocations(beneficiary_type, beneficiary_id, booked_on);

CREATE TABLE calculation_issues (
  id INTEGER PRIMARY KEY,
  tx_kind TEXT NOT NULL,
  tx_id INTEGER NOT NULL,
  kind TEXT NOT NULL,                   -- over_distribution, formula_error, missing_rate, conflict
  message TEXT NOT NULL,
  detail TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resolved_by INTEGER,
  resolved_at TEXT
);

-- ---------------------------------------------------------------- statements (hakediş) & payouts
CREATE TABLE payout_statements (
  id INTEGER PRIMARY KEY,
  party_type TEXT NOT NULL CHECK (party_type IN ('agency','bd','publisher')),
  party_id INTEGER NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  currency TEXT NOT NULL REFERENCES currencies(code),
  status TEXT NOT NULL CHECK (status IN ('calculated','approved','paid','cancelled')),
  total_minor INTEGER NOT NULL DEFAULT 0,
  paid_minor INTEGER NOT NULL DEFAULT 0,
  disputed_minor INTEGER NOT NULL DEFAULT 0,
  calculated_at TEXT NOT NULL,
  calculated_by INTEGER,
  approved_by INTEGER,
  approved_at TEXT,
  note TEXT
);
CREATE UNIQUE INDEX statement_unique ON payout_statements(party_type, party_id, period_start, period_end) WHERE status <> 'cancelled';

CREATE TABLE statement_lines (
  id INTEGER PRIMARY KEY,
  statement_id INTEGER NOT NULL REFERENCES payout_statements(id),
  kind TEXT NOT NULL,                   -- commission, salary, min_guarantee_topup, bonus, deduction, adjustment, carryover
  description TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  ref TEXT
);

-- Manual corrections booked into a period (never edits an approved statement).
CREATE TABLE payout_adjustments (
  id INTEGER PRIMARY KEY,
  party_type TEXT NOT NULL,
  party_id INTEGER NOT NULL,
  booked_on TEXT NOT NULL,
  currency TEXT NOT NULL REFERENCES currencies(code),
  amount_minor INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('bonus','deduction','adjustment','dispute')),
  reason TEXT NOT NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE payouts (
  id INTEGER PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  statement_id INTEGER NOT NULL REFERENCES payout_statements(id),
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  paid_on TEXT NOT NULL,
  method TEXT NOT NULL,
  reference TEXT,
  financial_tx_id INTEGER REFERENCES financial_transactions(id),
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------- technical services & costs
CREATE TABLE service_providers (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  integration_id INTEGER REFERENCES integration_connections(id),
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE cost_tariffs (
  id INTEGER PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES service_providers(id),
  service TEXT NOT NULL,                -- e.g. 'voice_minutes'
  unit TEXT NOT NULL,                   -- e.g. 'dakika', 'GB'
  currency TEXT NOT NULL REFERENCES currencies(code),
  fixed_monthly_minor INTEGER NOT NULL DEFAULT 0,
  included_quantity TEXT NOT NULL DEFAULT '0',
  unit_price TEXT NOT NULL DEFAULT '0', -- price per unit above the quota
  tiers TEXT,                           -- JSON [{from, unit_price}] overrides unit_price when set
  tax_percent TEXT NOT NULL DEFAULT '0',
  billing_day INTEGER NOT NULL DEFAULT 1,
  payment_terms_days INTEGER NOT NULL DEFAULT 0,
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE service_usage_records (
  id INTEGER PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  provider_id INTEGER NOT NULL REFERENCES service_providers(id),
  service TEXT NOT NULL,
  period TEXT NOT NULL,                 -- YYYY-MM
  usage_date TEXT,
  quantity TEXT NOT NULL,
  source TEXT NOT NULL,                 -- manual, csv, api
  note TEXT,
  created_by INTEGER,
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX usage_lookup ON service_usage_records(provider_id, service, period);

CREATE TABLE service_invoices (
  id INTEGER PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES service_providers(id),
  period TEXT NOT NULL,
  invoice_no TEXT,
  currency TEXT NOT NULL REFERENCES currencies(code),
  amount_minor INTEGER NOT NULL,
  tax_minor INTEGER NOT NULL DEFAULT 0,
  due_on TEXT,
  paid_on TEXT,
  attachment_ref TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (provider_id, period, invoice_no)
);

-- ---------------------------------------------------------------- catalog: games, gifts, emoji, animations, PK
CREATE TABLE catalog_items (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('game','gift','emoji','animation')),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  provider TEXT,
  coin_price INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'TRY' REFERENCES currencies(code),
  license_cost_minor INTEGER NOT NULL DEFAULT 0,     -- one-off
  production_cost_minor INTEGER NOT NULL DEFAULT 0,  -- one-off
  monthly_fee_minor INTEGER NOT NULL DEFAULT 0,
  per_use_cost TEXT NOT NULL DEFAULT '0',            -- per use (traffic, external service)
  per_tx_fee TEXT NOT NULL DEFAULT '0',
  revenue_share_percent TEXT NOT NULL DEFAULT '0',
  free INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  acquired_on TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE pk_events (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('in_room','cross_room')),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  reward_type TEXT NOT NULL,
  reward_cost_minor INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'TRY' REFERENCES currencies(code),
  note TEXT
);

-- ---------------------------------------------------------------- Lucky Gift
CREATE TABLE lucky_gift_configurations (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE lucky_gift_config_versions (
  id INTEGER PRIMARY KEY,
  config_id INTEGER NOT NULL REFERENCES lucky_gift_configurations(id),
  version INTEGER NOT NULL,
  gift_cost_coins INTEGER NOT NULL,
  odds TEXT NOT NULL,                   -- JSON [{multiplier, probability}] probabilities as decimals summing to 1
  max_reward_coins INTEGER NOT NULL,
  daily_reward_limit_coins INTEGER,
  per_user_daily_limit_coins INTEGER,
  total_budget_coins INTEGER,
  reserve_coins INTEGER NOT NULL DEFAULT 0,
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft','active','retired')),
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (config_id, version)
);

CREATE TABLE lucky_gift_results (
  id INTEGER PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  config_version_id INTEGER NOT NULL REFERENCES lucky_gift_config_versions(id),
  user_ref TEXT NOT NULL,
  spent_coins INTEGER NOT NULL,
  random_value TEXT NOT NULL,           -- uniform draw in [0,1) recorded for audit
  multiplier TEXT NOT NULL,
  reward_coins INTEGER NOT NULL,
  capped INTEGER NOT NULL DEFAULT 0,
  occurred_at TEXT NOT NULL,
  source TEXT NOT NULL,
  reverses_id INTEGER REFERENCES lucky_gift_results(id),
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX lucky_date ON lucky_gift_results(config_version_id, occurred_at);

-- ---------------------------------------------------------------- expenses
CREATE TABLE expense_categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  nature TEXT NOT NULL DEFAULT 'fixed' CHECK (nature IN ('fixed','variable')),
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE expense_records (
  id INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES expense_categories(id),
  vendor TEXT,
  description TEXT NOT NULL,
  nature TEXT NOT NULL CHECK (nature IN ('fixed','variable')),
  currency TEXT NOT NULL REFERENCES currencies(code),
  amount_minor INTEGER NOT NULL,
  tax_minor INTEGER NOT NULL DEFAULT 0,
  tx_date TEXT NOT NULL,
  accrual_date TEXT NOT NULL,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','paid','cancelled')),
  paid_on TEXT,
  recurrence TEXT NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none','monthly','yearly','days')),
  recurrence_days INTEGER,
  recurrence_until TEXT,
  parent_id INTEGER REFERENCES expense_records(id),
  module TEXT,
  attachment_ref TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX expense_accrual ON expense_records(accrual_date);
CREATE UNIQUE INDEX expense_recurring_once ON expense_records(parent_id, accrual_date) WHERE parent_id IS NOT NULL;

-- ---------------------------------------------------------------- cash, budgets, forecasts, alerts
CREATE TABLE cash_accounts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  currency TEXT NOT NULL REFERENCES currencies(code),
  active INTEGER NOT NULL DEFAULT 1
);

-- Bank statement balances as of a date; the source of "mevcut nakit".
CREATE TABLE cash_snapshots (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES cash_accounts(id),
  as_of TEXT NOT NULL,
  balance_minor INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE budgets (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('expense_category','service_provider','total')),
  scope_id INTEGER,
  period TEXT NOT NULL,                 -- YYYY-MM
  currency TEXT NOT NULL REFERENCES currencies(code),
  limit_minor INTEGER NOT NULL,
  profit_target_minor INTEGER,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE forecasts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  inputs TEXT NOT NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE alert_rules (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  params TEXT NOT NULL DEFAULT '{}',
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  notify_email TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE alerts (
  id INTEGER PRIMARY KEY,
  rule_id INTEGER REFERENCES alert_rules(id),
  kind TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  ref TEXT,
  suggested_action TEXT,
  dedupe_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  acknowledged_by INTEGER,
  acknowledged_at TEXT
);
CREATE UNIQUE INDEX alert_dedupe ON alerts(dedupe_key) WHERE status <> 'resolved';

-- ---------------------------------------------------------------- integrations
CREATE TABLE integration_connections (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('rest_api','webhook','csv','provider_api','database','manual')),
  status TEXT NOT NULL DEFAULT 'not_connected' CHECK (status IN ('not_connected','connected','error','disabled')),
  key_prefix TEXT,
  key_hash TEXT,
  config TEXT NOT NULL DEFAULT '{}',
  retry_policy TEXT NOT NULL DEFAULT '{"max_attempts":5,"backoff_seconds":60}',
  last_sync_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE import_batches (
  id INTEGER PRIMARY KEY,
  integration_id INTEGER REFERENCES integration_connections(id),
  kind TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  rows_total INTEGER NOT NULL DEFAULT 0,
  rows_ok INTEGER NOT NULL DEFAULT 0,
  rows_duplicate INTEGER NOT NULL DEFAULT 0,
  rows_error INTEGER NOT NULL DEFAULT 0,
  errors TEXT NOT NULL DEFAULT '[]',
  created_by INTEGER
);

CREATE TABLE reconciliations (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,                   -- service_invoice, channel_settlement
  ref TEXT NOT NULL,
  period TEXT NOT NULL,
  currency TEXT NOT NULL,
  system_minor INTEGER NOT NULL,
  external_minor INTEGER NOT NULL,
  difference_minor INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('matched','difference','accepted')),
  note TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------- immutability
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit_logs değiştirilemez'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit_logs silinemez'); END;
CREATE TRIGGER ft_no_update BEFORE UPDATE ON financial_transactions BEGIN SELECT RAISE(ABORT, 'financial_transactions değiştirilemez; ters kayıt kullanın'); END;
CREATE TRIGGER ft_no_delete BEFORE DELETE ON financial_transactions BEGIN SELECT RAISE(ABORT, 'financial_transactions silinemez; ters kayıt kullanın'); END;
CREATE TRIGGER wt_no_update BEFORE UPDATE ON wallet_transactions BEGIN SELECT RAISE(ABORT, 'wallet_transactions değiştirilemez; ters kayıt kullanın'); END;
CREATE TRIGGER wt_no_delete BEFORE DELETE ON wallet_transactions BEGIN SELECT RAISE(ABORT, 'wallet_transactions silinemez; ters kayıt kullanın'); END;
CREATE TRIGGER alloc_no_update BEFORE UPDATE ON commission_allocations BEGIN SELECT RAISE(ABORT, 'commission_allocations değiştirilemez'); END;
CREATE TRIGGER alloc_no_delete BEFORE DELETE ON commission_allocations BEGIN SELECT RAISE(ABORT, 'commission_allocations silinemez'); END;
CREATE TRIGGER lucky_no_update BEFORE UPDATE ON lucky_gift_results BEGIN SELECT RAISE(ABORT, 'lucky_gift_results değiştirilemez'); END;
CREATE TRIGGER lucky_no_delete BEFORE DELETE ON lucky_gift_results BEGIN SELECT RAISE(ABORT, 'lucky_gift_results silinemez'); END;
CREATE TRIGGER payout_no_update BEFORE UPDATE ON payouts BEGIN SELECT RAISE(ABORT, 'payouts değiştirilemez'); END;
CREATE TRIGGER payout_no_delete BEFORE DELETE ON payouts BEGIN SELECT RAISE(ABORT, 'payouts silinemez'); END;
CREATE TRIGGER adj_no_update BEFORE UPDATE ON payout_adjustments BEGIN SELECT RAISE(ABORT, 'payout_adjustments değiştirilemez'); END;
CREATE TRIGGER adj_no_delete BEFORE DELETE ON payout_adjustments BEGIN SELECT RAISE(ABORT, 'payout_adjustments silinemez'); END;
CREATE TRIGGER usage_no_delete BEFORE DELETE ON service_usage_records BEGIN SELECT RAISE(ABORT, 'service_usage_records silinemez'); END;
-- Rule versions: config and validity are frozen once a version leaves draft.
CREATE TRIGGER rule_version_frozen BEFORE UPDATE OF config, valid_from, rule_id, version ON commission_rule_versions
  WHEN OLD.status NOT IN ('draft') BEGIN SELECT RAISE(ABORT, 'Taslak olmayan kural sürümü değiştirilemez; yeni sürüm oluşturun'); END;
CREATE TRIGGER rule_version_no_delete BEFORE DELETE ON commission_rule_versions WHEN OLD.status <> 'draft'
  BEGIN SELECT RAISE(ABORT, 'Kural sürümü silinemez'); END;
CREATE TRIGGER lucky_version_frozen BEFORE UPDATE OF odds, gift_cost_coins, max_reward_coins, valid_from ON lucky_gift_config_versions
  WHEN OLD.status <> 'draft' BEGIN SELECT RAISE(ABORT, 'Aktif Lucky sürümü değiştirilemez; yeni sürüm oluşturun'); END;
-- Statement lines of approved/paid statements are frozen.
CREATE TRIGGER lines_frozen_upd BEFORE UPDATE ON statement_lines
  WHEN (SELECT status FROM payout_statements WHERE id = OLD.statement_id) <> 'calculated'
  BEGIN SELECT RAISE(ABORT, 'Onaylı hakediş satırları değiştirilemez'); END;
CREATE TRIGGER lines_frozen_del BEFORE DELETE ON statement_lines
  WHEN (SELECT status FROM payout_statements WHERE id = OLD.statement_id) <> 'calculated'
  BEGIN SELECT RAISE(ABORT, 'Onaylı hakediş satırları silinemez'); END;
CREATE TRIGGER lines_frozen_ins BEFORE INSERT ON statement_lines
  WHEN (SELECT status FROM payout_statements WHERE id = NEW.statement_id) <> 'calculated'
  BEGIN SELECT RAISE(ABORT, 'Onaylı hakedişe satır eklenemez'); END;
CREATE TRIGGER statement_amounts_frozen BEFORE UPDATE OF total_minor, party_type, party_id, period_start, period_end, currency ON payout_statements
  WHEN OLD.status <> 'calculated' BEGIN SELECT RAISE(ABORT, 'Onaylı hakediş tutarı değiştirilemez; düzeltme kaydı kullanın'); END;
