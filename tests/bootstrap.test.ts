// The first admin and a login named in the environment (server/bootstrap.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hashPassword, login } from '../server/auth.ts';
import { bootstrap } from '../server/bootstrap.ts';
import { setup } from './helpers.ts';

test('ortamdaki giriş (FC_ADMIN_EMAIL, FC_ADMIN_PASSWORD) bir kez süper yönetici olur; sonra değişen parola kalır', () => {
  const env = setup();
  const was = { email: process.env.FC_ADMIN_EMAIL, password: process.env.FC_ADMIN_PASSWORD };
  process.env.FC_ADMIN_EMAIL = 'admin';
  process.env.FC_ADMIN_PASSWORD = 'password';
  try {
    // Users exist already (the test admin): the named login is added, nothing is returned to write to a file.
    assert.equal(bootstrap(env.db), null);
    const u = env.db.get("SELECT u.id, r.key FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = 'admin'")!;
    assert.equal(u.key, 'super_admin');
    assert.ok(login(env.ctx, 'admin', 'password').token);
    assert.equal(login(env.ctx, 'ADMIN', 'password').user.email, 'admin');
    // A password changed in the panel stays: the next start doesn't put the one in the environment back.
    env.db.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword('yeni-parola-123'), u.id);
    bootstrap(env.db);
    assert.throws(() => login(env.ctx, 'admin', 'password'), /hatalı/);
    assert.ok(login(env.ctx, 'admin', 'yeni-parola-123').token);
    assert.equal(env.db.value<number>("SELECT COUNT(*) FROM users WHERE email = 'admin'"), 1);
    // The other admins are untouched.
    assert.ok(login(env.ctx, 'admin@test.local', 'test-password-123').token);
  } finally {
    for (const [k, v] of [['FC_ADMIN_EMAIL', was.email], ['FC_ADMIN_PASSWORD', was.password]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('ortamda giriş yoksa ya da yarımsa kimse eklenmez', () => {
  const env = setup();
  const was = { email: process.env.FC_ADMIN_EMAIL, password: process.env.FC_ADMIN_PASSWORD };
  const users = () => env.db.value<number>('SELECT COUNT(*) FROM users');
  const n = users();
  try {
    delete process.env.FC_ADMIN_EMAIL;
    delete process.env.FC_ADMIN_PASSWORD;
    bootstrap(env.db);
    process.env.FC_ADMIN_EMAIL = 'admin';
    bootstrap(env.db);
    assert.equal(users(), n);
  } finally {
    for (const [k, v] of [['FC_ADMIN_EMAIL', was.email], ['FC_ADMIN_PASSWORD', was.password]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
