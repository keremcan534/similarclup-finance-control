-- Uygulama › Seviyeler ve VIP (server/app-admin.ts, the app's levels-admin.mjs): the finance manager sets VIP, Rütbe,
-- Cömertlik, Yankı and Abonelik (Rütbe prices and level drops touch money). Roles made before this get it here (a fresh
-- database gets it from bootstrap.ts SYSTEM_ROLES); the super admin always has every permission.
UPDATE roles SET permissions = json_insert(permissions, '$[#]', 'app.levels')
 WHERE key = 'finance_manager'
   AND NOT EXISTS (SELECT 1 FROM json_each(roles.permissions) WHERE value = 'app.levels');
