-- Uygulama › Ajans merkezi (server/app-admin.ts): the finance manager may run the app's agency network from the
-- centre's side (applications, status, rates, tiers, transfers, performance, reports) and its commission ledger and
-- rules. Roles made before this get them here (bootstrap.ts gives a fresh database the same).
UPDATE roles SET permissions = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(roles.permissions)
    UNION SELECT value FROM json_each('["app.agencies","app.agency_ledger"]')
  )
) WHERE key = 'finance_manager';
