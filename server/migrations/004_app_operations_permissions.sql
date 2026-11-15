-- Uygulama operations pages (server/app-admin.ts): the operations manager may search and ban app users, handle
-- complaints and support tickets, put up notices and review events. Roles made before this get them here
-- (bootstrap.ts gives a fresh database the same).
UPDATE roles SET permissions = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(roles.permissions)
    UNION SELECT value FROM json_each('["app.users","app.complaints","app.support","app.notices","app.events"]')
  )
) WHERE key = 'operations_manager';
