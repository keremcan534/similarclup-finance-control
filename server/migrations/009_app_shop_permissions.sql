-- Uygulama › Mağaza (server/app-admin.ts, the app's shop-items.mjs): whoever manages the app's gifts manages its shop's
-- frames and entry effects too. Roles made before this get the permission here (a fresh database gets it from
-- bootstrap.ts SYSTEM_ROLES); the super admin always has every permission.
UPDATE roles SET permissions = json_insert(permissions, '$[#]', 'app.shop')
 WHERE key IN ('finance_manager', 'operations_manager')
   AND NOT EXISTS (SELECT 1 FROM json_each(roles.permissions) WHERE value = 'app.shop');
