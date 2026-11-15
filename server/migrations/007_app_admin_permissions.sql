-- The rest of the app's Yönetim (server/app-admin.ts): sanctions and appeals, the agency centre's staff, a person's
-- shop items, Jeton Noktası. Roles made before this get them here (bootstrap.ts gives a fresh database the same, and
-- adds the Moderatör role wherever it is missing).
UPDATE roles SET permissions = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(roles.permissions)
    UNION SELECT value FROM json_each('["app.agency_staff","app.sanctions","app.sanctions_full","app.economy"]')
  )
) WHERE key = 'operations_manager';
UPDATE roles SET permissions = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(roles.permissions)
    UNION SELECT value FROM json_each('["app.jeton"]')
  )
) WHERE key = 'finance_manager';
