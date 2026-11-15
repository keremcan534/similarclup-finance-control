-- Uygulama › Emojiler (server/app-admin.ts): whoever manages the app's gifts manages its emoji packs and stickers too.
-- Roles made before this get the permission here (a fresh database gets it from bootstrap.ts SYSTEM_ROLES); the super
-- admin always has every permission.
UPDATE roles SET permissions = json_insert(permissions, '$[#]', 'app.emojis')
 WHERE key IN ('finance_manager', 'operations_manager')
   AND NOT EXISTS (SELECT 1 FROM json_each(roles.permissions) WHERE value = 'app.emojis');
