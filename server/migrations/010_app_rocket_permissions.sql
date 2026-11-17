-- Uygulama › Oda roketi (server/app-admin.ts, the app's room-rocket.mjs): the finance manager switches the room rocket
-- on and off and sets its levels' goals and prizes (coins and shop items drawn by chance among the people who fill a
-- level, as with Şanslı hediye). Roles made before this get it here (a fresh database gets it from bootstrap.ts
-- SYSTEM_ROLES); the super admin always has every permission.
UPDATE roles SET permissions = json_insert(permissions, '$[#]', 'app.rocket')
 WHERE key = 'finance_manager'
   AND NOT EXISTS (SELECT 1 FROM json_each(roles.permissions) WHERE value = 'app.rocket');
