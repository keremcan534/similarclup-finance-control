-- Uygulama finance pages (server/app-admin.ts): the finance manager may decide withdrawals and agency payouts,
-- refund store purchases, edit the Şanslı packages and the live settings and read the reports; the operations
-- manager may read the reports. Roles made before this get them here (bootstrap.ts gives a fresh database the same).
UPDATE roles SET permissions = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(roles.permissions)
    UNION SELECT value FROM json_each('["app.withdrawals","app.payouts","app.refunds","app.lucky","app.settings","app.reports"]')
  )
) WHERE key = 'finance_manager';
UPDATE roles SET permissions = json_insert(permissions, '$[#]', 'app.reports')
 WHERE key = 'operations_manager' AND NOT EXISTS (SELECT 1 FROM json_each(roles.permissions) WHERE value = 'app.reports');
