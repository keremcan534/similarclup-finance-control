-- Uygulama pages (server/app-admin.ts): the finance and operations managers may manage the app's gifts. Roles made
-- before this get the permission here (a fresh database gets it from bootstrap.ts SYSTEM_ROLES); the super admin
-- always has every permission.
UPDATE roles SET permissions = json_insert(permissions, '$[#]', 'app.gifts')
 WHERE key IN ('finance_manager', 'operations_manager')
   AND NOT EXISTS (SELECT 1 FROM json_each(roles.permissions) WHERE value = 'app.gifts');
