-- Uygulama › Yayıncı haftalık bonusu (server/app-admin.ts, the app's host-bonus.mjs): the finance manager sees the
-- weeks and what each agency streamer got, pays a week that closed while the bonus was off and takes a bonus back.
-- Roles made before this get it here (a fresh database gets it from bootstrap.ts SYSTEM_ROLES); the super admin
-- always has every permission.
UPDATE roles SET permissions = json_insert(permissions, '$[#]', 'app.host_bonus')
 WHERE key = 'finance_manager'
   AND NOT EXISTS (SELECT 1 FROM json_each(roles.permissions) WHERE value = 'app.host_bonus');
