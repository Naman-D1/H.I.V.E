const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Isolated test DB so this never touches a real hive.db.
process.env.DB_FILE = path.join(__dirname, 'test.db');
process.env.JWT_SECRET = 'test-secret-key-not-for-production';
process.env.ADMIN_EMAIL = 'admin@test.edu';
process.env.ADMIN_PASSWORD = 'admin-password-1';
delete process.env.ALLOWED_EMAIL_DOMAIN;

for (const f of ['test.db', 'test.db-wal', 'test.db-shm']) {
  const p = path.join(__dirname, f);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

const app = require('../server');

async function request(method, url, { token, body } = {}) {
  const port = app.__testPort;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`http://127.0.0.1:${port}${url}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}

let server;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      app.__testPort = server.address().port;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  for (const f of ['test.db', 'test.db-wal', 'test.db-shm']) {
    const p = path.join(__dirname, f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
});

test('health check responds ok', async () => {
  const { status, data } = await request('GET', '/api/health');
  assert.equal(status, 200);
  assert.equal(data.status, 'ok');
});

test('register rejects a short password', async () => {
  const { status, data } = await request('POST', '/api/auth/register', {
    body: { name: 'Jane Doe', email: 'jane@test.edu', password: 'short' },
  });
  assert.equal(status, 400);
  assert.match(data.error, /password/i);
});

test('register rejects an invalid email', async () => {
  const { status } = await request('POST', '/api/auth/register', {
    body: { name: 'Jane Doe', email: 'not-an-email', password: 'longenoughpw' },
  });
  assert.equal(status, 400);
});

let janeToken;

test('register creates a student account', async () => {
  const { status, data } = await request('POST', '/api/auth/register', {
    body: { name: 'Jane Doe', email: 'jane@test.edu', password: 'longenoughpw' },
  });
  assert.equal(status, 201);
  assert.equal(data.user.role, 'student');
  janeToken = data.token;
});

test('register rejects a duplicate email', async () => {
  const { status } = await request('POST', '/api/auth/register', {
    body: { name: 'Jane Again', email: 'jane@test.edu', password: 'longenoughpw' },
  });
  assert.equal(status, 409);
});

test('login rejects a wrong password', async () => {
  const { status } = await request('POST', '/api/auth/login', {
    body: { email: 'jane@test.edu', password: 'wrong-password' },
  });
  assert.equal(status, 401);
});

test('login succeeds with correct credentials', async () => {
  const { status, data } = await request('POST', '/api/auth/login', {
    body: { email: 'jane@test.edu', password: 'longenoughpw' },
  });
  assert.equal(status, 200);
  assert.ok(data.token);
});

test('admin can list and change a user role', async () => {
  const login = await request('POST', '/api/auth/login', {
    body: { email: 'admin@test.edu', password: 'admin-password-1' },
  });
  assert.equal(login.status, 200);
  const adminToken = login.data.token;

  const list = await request('GET', '/api/users', { token: adminToken });
  assert.equal(list.status, 200);
  const jane = list.data.users.find((u) => u.email === 'jane@test.edu');
  assert.ok(jane);

  const change = await request('PATCH', `/api/users/${jane.id}/role`, {
    token: adminToken,
    body: { role: 'faculty' },
  });
  assert.equal(change.status, 200);
  assert.equal(change.data.role, 'faculty');
});

test('a student cannot list users', async () => {
  const { status } = await request('GET', '/api/users', { token: janeToken });
  assert.equal(status, 403);
});

test('notifications: jane has unread welcome + role-change notifications', async () => {
  const { status, data } = await request('GET', '/api/notifications', { token: janeToken });
  assert.equal(status, 200);
  assert.ok(data.unreadCount >= 2);
});

test('notifications: mark-all-read clears the unread count', async () => {
  await request('POST', '/api/notifications/read-all', { token: janeToken });
  const { data } = await request('GET', '/api/notifications', { token: janeToken });
  assert.equal(data.unreadCount, 0);
});
