const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const bcrypt = require('bcryptjs');

test('注册审批流程', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookshelf-auth-'));
  const dbPath = path.join(tmpDir, 'data.json');
  const legacyPassword = 'legacy-pass-123';

  // 预置一个没有 status / name 的历史用户，用来验证启动迁移
  fs.writeFileSync(dbPath, JSON.stringify({
    users: [{
      id: 'legacy-user',
      email: 'legacy@test.local',
      password_hash: bcrypt.hashSync(legacyPassword, 4),
      role: 'user',
      created_at: '2026-01-01T00:00:00.000Z'
    }],
    books: [],
    reading_progress: []
  }, null, 2));

  process.env.DATA_DIR = tmpDir;
  process.env.DB_PATH = dbPath;
  process.env.ADMIN_EMAIL = 'admin@test.local';
  process.env.ADMIN_PASSWORD = 'admin-pass-123';
  process.env.JWT_SECRET = 'test-secret';

  const app = require('../server');
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function request(pathname, { method = 'GET', token, body } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + pathname, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  let adminToken;
  let pendingUser;

  try {
    await t.test('历史账户迁移为已批准并可登录', async () => {
      const res = await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'legacy@test.local', password: legacyPassword }
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.user.status, 'active');
      assert.equal(res.data.user.name, 'legacy');
    });

    await t.test('默认管理员可以登录', async () => {
      const res = await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'admin@test.local', password: 'admin-pass-123' }
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.user.role, 'admin');
      adminToken = res.data.token;
      assert.ok(adminToken);
    });

    await t.test('注册字段校验', async () => {
      const cases = [
        [{ email: 'a@test.local', password: 'secret1' }, '请填写显示名称'],
        [{ email: 'a@test.local', password: 'secret1', name: '   ' }, '请填写显示名称'],
        [{ email: 'a@test.local', password: 'secret1', name: 'x'.repeat(33) }, '显示名称不能超过 32 个字符'],
        [{ email: 'not-an-email', password: 'secret1', name: '读者' }, '邮箱格式不正确'],
        [{ email: 'a@test.local', password: '12345', name: '读者' }, '密码至少 6 位'],
        [{ email: 'a@test.local', name: '读者' }, '邮箱和密码不能为空']
      ];
      for (const [body, error] of cases) {
        const res = await request('/api/auth/register', { method: 'POST', body });
        assert.equal(res.status, 400, JSON.stringify(body));
        assert.equal(res.data.error, error);
      }
    });

    await t.test('注册成功只创建待审批普通用户且不发令牌', async () => {
      const res = await request('/api/auth/register', {
        method: 'POST',
        body: { email: 'Reader@One.Test', password: 'reader-pass-123', name: '  读者一号  ' }
      });
      assert.equal(res.status, 201);
      assert.equal(res.data.pending, true);
      assert.equal(res.data.token, undefined);
      assert.equal(res.data.user.email, 'reader@one.test');
      assert.equal(res.data.user.name, '读者一号');
      assert.equal(res.data.user.role, 'user');
      assert.equal(res.data.user.status, 'pending');
      assert.deepEqual(res.data.user.permissions, []);
      pendingUser = res.data.user;
    });

    await t.test('邮箱大小写不敏感查重', async () => {
      const res = await request('/api/auth/register', {
        method: 'POST',
        body: { email: 'READER@one.test', password: 'reader-pass-123', name: '另一个名字' }
      });
      assert.equal(res.status, 409);
      assert.match(res.data.error, /已被注册/);
    });

    await t.test('待审批账户不能登录，密码错误仍返回 401', async () => {
      const pending = await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'reader@one.test', password: 'reader-pass-123' }
      });
      assert.equal(pending.status, 403);
      assert.equal(pending.data.code, 'ACCOUNT_PENDING');
      assert.equal(pending.data.token, undefined);

      const wrong = await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'reader@one.test', password: 'wrong-password' }
      });
      assert.equal(wrong.status, 401);
    });

    await t.test('后台列表与统计能看到待审批账户', async () => {
      const list = await request('/api/admin/users', { token: adminToken });
      assert.equal(list.status, 200);
      assert.equal(list.data[0].status, 'pending');
      const item = list.data.find(u => u.email === 'reader@one.test');
      assert.ok(item);
      assert.equal(item.name, '读者一号');
      assert.equal(item.role, 'user');

      const stats = await request('/api/admin/stats', { token: adminToken });
      assert.equal(stats.status, 200);
      assert.equal(stats.data.pending, 1);
    });

    await t.test('管理员批准后普通用户可登录且权限受限', async () => {
      const approved = await request('/api/admin/users/' + pendingUser.id, {
        method: 'PUT',
        token: adminToken,
        body: { status: 'active' }
      });
      assert.equal(approved.status, 200);
      assert.equal(approved.data.status, 'active');
      assert.equal(approved.data.role, 'user');

      const login = await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'reader@one.test', password: 'reader-pass-123' }
      });
      assert.equal(login.status, 200);
      assert.ok(login.data.token);

      const me = await request('/api/auth/me', { token: login.data.token });
      assert.equal(me.status, 200);
      assert.equal(me.data.user.role, 'user');
      assert.equal(me.data.user.name, '读者一号');
      assert.ok(me.data.user.permissions.includes('read'));
      assert.ok(me.data.user.permissions.includes('upload'));
      assert.ok(!me.data.user.permissions.includes('manage_users'));

      const books = await request('/api/books', { token: login.data.token });
      assert.equal(books.status, 200);

      // 管理员把账户改回待审批后，旧令牌立即失效
      const suspended = await request('/api/admin/users/' + pendingUser.id, {
        method: 'PUT',
        token: adminToken,
        body: { status: 'pending' }
      });
      assert.equal(suspended.status, 200);
      const blocked = await request('/api/auth/me', { token: login.data.token });
      assert.equal(blocked.status, 403);
      assert.equal(blocked.data.code, 'ACCOUNT_PENDING');
    });

    await t.test('拒绝后不能登录，重新批准后可登录', async () => {
      const reg = await request('/api/auth/register', {
        method: 'POST',
        body: { email: 'reject@test.local', password: 'reject-pass-123', name: '待拒绝用户' }
      });
      assert.equal(reg.status, 201);

      const rejected = await request('/api/admin/users/' + reg.data.user.id, {
        method: 'PUT',
        token: adminToken,
        body: { status: 'rejected' }
      });
      assert.equal(rejected.status, 200);
      assert.equal(rejected.data.status, 'rejected');

      const login = await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'reject@test.local', password: 'reject-pass-123' }
      });
      assert.equal(login.status, 403);
      assert.equal(login.data.code, 'ACCOUNT_REJECTED');

      const approved = await request('/api/admin/users/' + reg.data.user.id, {
        method: 'PUT',
        token: adminToken,
        body: { status: 'active' }
      });
      assert.equal(approved.status, 200);

      const relogin = await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'reject@test.local', password: 'reject-pass-123' }
      });
      assert.equal(relogin.status, 200);
    });

    await t.test('管理员自锁与待审批改角色的保护', async () => {
      const me = await request('/api/auth/me', { token: adminToken });
      const selfPending = await request('/api/admin/users/' + me.data.user.id, {
        method: 'PUT',
        token: adminToken,
        body: { status: 'pending' }
      });
      assert.equal(selfPending.status, 400);
      assert.match(selfPending.data.error, /自己/);

      const secondAdmin = await request('/api/admin/users', {
        method: 'POST',
        token: adminToken,
        body: { email: 'admin2@test.local', password: 'admin2-pass-123', role: 'admin' }
      });
      assert.equal(secondAdmin.status, 200);
      const rejectAdmin = await request('/api/admin/users/' + secondAdmin.data.id, {
        method: 'PUT',
        token: adminToken,
        body: { status: 'rejected' }
      });
      assert.equal(rejectAdmin.status, 400);
      assert.match(rejectAdmin.data.error, /管理员/);

      const stillPending = await request('/api/auth/register', {
        method: 'POST',
        body: { email: 'pending-role@test.local', password: 'pending-pass-123', name: '待审批改角色' }
      });
      assert.equal(stillPending.status, 201);
      const roleChange = await request('/api/admin/users/' + stillPending.data.user.id, {
        method: 'PUT',
        token: adminToken,
        body: { role: 'admin' }
      });
      assert.equal(roleChange.status, 400);
      assert.match(roleChange.data.error, /先批准/);
    });

    await t.test('后台新建账户默认为已批准', async () => {
      const created = await request('/api/admin/users', {
        method: 'POST',
        token: adminToken,
        body: { email: 'created@test.local', password: 'created-pass-123', role: 'user' }
      });
      assert.equal(created.status, 200);
      assert.equal(created.data.status, 'active');

      const login = await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'created@test.local', password: 'created-pass-123' }
      });
      assert.equal(login.status, 200);
    });

    await t.test('后台新建与修改邮箱强制校验格式', async () => {
      const badCreate = await request('/api/admin/users', {
        method: 'POST',
        token: adminToken,
        body: { email: 'bad-email', password: 'created-pass-123', role: 'user' }
      });
      assert.equal(badCreate.status, 400);
      assert.match(badCreate.data.error, /邮箱格式/);

      const list = await request('/api/admin/users', { token: adminToken });
      const target = list.data.find(u => u.email === 'created@test.local');
      assert.ok(target);
      const badUpdate = await request('/api/admin/users/' + target.id, {
        method: 'PUT',
        token: adminToken,
        body: { email: 'also-bad' }
      });
      assert.equal(badUpdate.status, 400);
      assert.match(badUpdate.data.error, /邮箱格式/);
    });

    await t.test('修改显示名称无需密码，修改邮箱或密码必须验证', async () => {
      const created = await request('/api/admin/users', {
        method: 'POST',
        token: adminToken,
        body: { email: 'account@test.local', password: 'account-pass-123', role: 'user' }
      });
      assert.equal(created.status, 200);
      const login = await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'account@test.local', password: 'account-pass-123' }
      });
      assert.equal(login.status, 200);
      let token = login.data.token;

      // 只改显示名称，不需要当前密码
      const rename = await request('/api/account', {
        method: 'PUT',
        token,
        body: { name: '新显示名称', email: 'account@test.local' }
      });
      assert.equal(rename.status, 200);
      assert.equal(rename.data.user.name, '新显示名称');

      // 改邮箱但没有当前密码
      const noPassword = await request('/api/account', {
        method: 'PUT',
        token,
        body: { name: '新显示名称', email: 'account-new@test.local' }
      });
      assert.equal(noPassword.status, 400);
      assert.match(noPassword.data.error, /当前密码/);

      // 当前密码错误
      const wrongPassword = await request('/api/account', {
        method: 'PUT',
        token,
        body: { name: '新显示名称', email: 'account-new@test.local', current_password: 'wrong-pass' }
      });
      assert.equal(wrongPassword.status, 403);
      assert.match(wrongPassword.data.error, /当前密码/);

      // 当前密码正确，邮箱修改后重新签发令牌
      const emailChange = await request('/api/account', {
        method: 'PUT',
        token,
        body: { name: '新显示名称', email: 'account-new@test.local', current_password: 'account-pass-123' }
      });
      assert.equal(emailChange.status, 200);
      assert.equal(emailChange.data.user.email, 'account-new@test.local');
      assert.ok(emailChange.data.token);
      token = emailChange.data.token;

      // 改密码需要当前密码
      const passwordWithoutCurrent = await request('/api/account', {
        method: 'PUT',
        token,
        body: { name: '新显示名称', email: 'account-new@test.local', new_password: 'account-pass-456', confirm_password: 'account-pass-456' }
      });
      assert.equal(passwordWithoutCurrent.status, 400);
      assert.match(passwordWithoutCurrent.data.error, /当前密码/);

      const passwordChange = await request('/api/account', {
        method: 'PUT',
        token,
        body: {
          name: '新显示名称',
          email: 'account-new@test.local',
          current_password: 'account-pass-123',
          new_password: 'account-pass-456',
          confirm_password: 'account-pass-456'
        }
      });
      assert.equal(passwordChange.status, 200);

      const newLogin = await request('/api/auth/login', {
        method: 'POST',
        body: { email: 'account-new@test.local', password: 'account-pass-456' }
      });
      assert.equal(newLogin.status, 200);

      const badEmail = await request('/api/account', {
        method: 'PUT',
        token: passwordChange.data.token,
        body: { name: '新显示名称', email: 'still-bad', current_password: 'account-pass-456' }
      });
      assert.equal(badEmail.status, 400);
      assert.match(badEmail.data.error, /邮箱格式/);
    });
  } finally {
    await new Promise(resolve => {
      server.close(resolve);
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
