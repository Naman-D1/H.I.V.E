const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.DB_FILE = path.join(__dirname, 'test-supplies.db');
process.env.JWT_SECRET = 'test-secret-key-not-for-production';
process.env.ADMIN_EMAIL = 'admin@test.edu';
process.env.ADMIN_PASSWORD = 'admin-password-1';
delete process.env.ALLOWED_EMAIL_DOMAIN;

const files = ['test-supplies.db', 'test-supplies.db-wal', 'test-supplies.db-shm'];
const rm = () => files.forEach((f) => { const p = path.join(__dirname, f); if (fs.existsSync(p)) fs.unlinkSync(p); });
rm();

delete require.cache[require.resolve('../server')];
delete require.cache[require.resolve('../src/db')];
delete require.cache[require.resolve('../src/config')];
const app = require('../server');
const db = require('../src/db');

async function request(method, url, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`http://127.0.0.1:${app.__testPort}${url}`, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}

let server, adminToken, ownerToken, aToken, bToken;
const msgs = async (token) => (await request('GET', '/api/notifications', { token })).data.notifications.map((n) => n.message);

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, () => { app.__testPort = server.address().port; resolve(); }); });
  adminToken = (await request('POST', '/api/auth/login', { body: { email: 'admin@test.edu', password: 'admin-password-1' } })).data.token;
  const reg = async (name, email) => (await request('POST', '/api/auth/register', { body: { name, email, password: 'longenoughpw' } })).data.token;
  ownerToken = await reg('Owner Oli', 'owner@test.edu');
  aToken = await reg('Borrower Ana', 'ana@test.edu');
  bToken = await reg('Borrower Ben', 'ben@test.edu');
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  rm();
});

const list = (token, title, extra = {}) =>
  request('POST', '/api/supplies', { token, body: { title, description: 'good condition', category: 'stationery', ...extra } });

test('requires login', async () => {
  assert.equal((await request('GET', '/api/supplies')).status, 401);
});

test('listing validates title and category', async () => {
  assert.equal((await list(ownerToken, 'ab')).status, 400);
  assert.equal((await list(ownerToken, 'Calculator', { category: 'weapons' })).status, 400);
  const ok = await list(ownerToken, 'Casio calculator');
  assert.equal(ok.status, 201);
  assert.equal(ok.data.supply.status, 'available');
  assert.equal(ok.data.supply.ownerName, 'Owner Oli');
});

test('browse, search and filter', async () => {
  await list(ownerToken, 'Soldering iron', { category: 'tools' });
  const all = await request('GET', '/api/supplies', { token: aToken });
  assert.ok(all.data.supplies.length >= 2);
  const tools = await request('GET', '/api/supplies?category=tools', { token: aToken });
  assert.ok(tools.data.supplies.every((s) => s.category === 'tools'));
  const q = await request('GET', '/api/supplies?q=casio', { token: aToken });
  assert.equal(q.data.supplies.length, 1);
  const mine = await request('GET', '/api/supplies?mine=1', { token: aToken });
  assert.equal(mine.data.supplies.length, 0);
});

test('full borrow flow: request -> approve -> on loan -> return', async () => {
  const s = (await list(ownerToken, 'Drawing board')).data.supply;

  const own = await request('POST', `/api/supplies/${s.id}/borrow`, { token: ownerToken, body: { days: 2 } });
  assert.equal(own.status, 400);

  const req1 = await request('POST', `/api/supplies/${s.id}/borrow`, { token: aToken, body: { days: 2, message: 'for lab' } });
  assert.equal(req1.status, 201);
  assert.ok((await msgs(ownerToken)).some((m) => m.includes('Borrower Ana') && m.includes('Drawing board')));

  assert.equal((await request('POST', `/api/supplies/${s.id}/borrow`, { token: aToken, body: { days: 2 } })).status, 409);
  const req2 = await request('POST', `/api/supplies/${s.id}/borrow`, { token: bToken, body: { days: 5 } });
  assert.equal(req2.status, 201);

  // Only the owner/admin sees the requests; other students cannot approve.
  assert.equal((await request('GET', `/api/supplies/${s.id}/requests`, { token: aToken })).status, 403);
  assert.equal((await request('POST', `/api/supplies/requests/${req1.data.request.id}/approve`, { token: bToken })).status, 403);
  const seen = await request('GET', `/api/supplies/${s.id}/requests`, { token: ownerToken });
  assert.equal(seen.data.requests.length, 2);

  const ok = await request('POST', `/api/supplies/requests/${req1.data.request.id}/approve`, { token: ownerToken });
  assert.equal(ok.status, 200);

  const after = (await request('GET', `/api/supplies/${s.id}`, { token: aToken })).data.supply;
  assert.equal(after.status, 'on_loan');
  assert.ok(after.dueDate);
  assert.equal(after.overdue, false);
  assert.equal(after.borrowedByMe, true);
  // A third party does not see who has it.
  assert.equal((await request('GET', `/api/supplies/${s.id}`, { token: bToken })).data.supply.borrowerName, null);

  // Ben's competing request was auto-declined and he was told.
  assert.ok((await msgs(bToken)).some((m) => m.includes('lent to someone else')));
  assert.equal((await request('POST', `/api/supplies/requests/${req2.data.request.id}/approve`, { token: ownerToken })).status, 400);

  // Can't borrow or withdraw while on loan.
  assert.equal((await request('POST', `/api/supplies/${s.id}/borrow`, { token: bToken, body: { days: 1 } })).status, 400);
  assert.equal((await request('PATCH', `/api/supplies/${s.id}/withdraw`, { token: ownerToken })).status, 400);

  assert.ok((await msgs(aToken)).some((m) => m.includes('approved')));

  // Return
  assert.equal((await request('POST', `/api/supplies/requests/${req1.data.request.id}/return`, { token: aToken })).status, 403);
  assert.equal((await request('POST', `/api/supplies/requests/${req1.data.request.id}/return`, { token: ownerToken })).status, 200);
  assert.equal((await request('GET', `/api/supplies/${s.id}`, { token: aToken })).data.supply.status, 'available');
  assert.equal((await request('POST', `/api/supplies/requests/${req1.data.request.id}/return`, { token: ownerToken })).status, 400);
});

test('reject and cancel', async () => {
  const s = (await list(ownerToken, 'Stapler')).data.supply;
  const r1 = await request('POST', `/api/supplies/${s.id}/borrow`, { token: aToken, body: { days: 1 } });
  assert.equal((await request('POST', `/api/supplies/requests/${r1.data.request.id}/reject`, { token: ownerToken })).status, 200);
  assert.ok((await msgs(aToken)).some((m) => m.includes('declined')));
  // Still available after a rejection.
  assert.equal((await request('GET', `/api/supplies/${s.id}`, { token: aToken })).data.supply.status, 'available');
  assert.equal((await request('POST', `/api/supplies/requests/${r1.data.request.id}/reject`, { token: ownerToken })).status, 400);

  const r2 = await request('POST', `/api/supplies/${s.id}/borrow`, { token: aToken, body: { days: 1 } });
  assert.equal((await request('POST', `/api/supplies/requests/${r2.data.request.id}/cancel`, { token: bToken })).status, 403);
  assert.equal((await request('POST', `/api/supplies/requests/${r2.data.request.id}/cancel`, { token: aToken })).status, 200);
  assert.equal((await request('POST', `/api/supplies/requests/${r2.data.request.id}/cancel`, { token: aToken })).status, 400);
});

test('borrow period validation', async () => {
  const s = (await list(ownerToken, 'Ruler set')).data.supply;
  for (const days of [0, -1, 31, 1.5, 'abc']) {
    assert.equal((await request('POST', `/api/supplies/${s.id}/borrow`, { token: aToken, body: { days } })).status, 400, `days=${days}`);
  }
  const dflt = await request('POST', `/api/supplies/${s.id}/borrow`, { token: aToken, body: {} });
  assert.equal(dflt.status, 201);
  assert.equal(dflt.data.request.days, 3);
});

test('a borrower can hold at most 3 items at once', async () => {
  const ids = [];
  for (const t of ['Item one', 'Item two', 'Item three', 'Item four']) ids.push((await list(ownerToken, t)).data.supply.id);
  for (let i = 0; i < 3; i++) {
    const r = await request('POST', `/api/supplies/${ids[i]}/borrow`, { token: bToken, body: { days: 1 } });
    await request('POST', `/api/supplies/requests/${r.data.request.id}/approve`, { token: ownerToken });
  }
  const blocked = await request('POST', `/api/supplies/${ids[3]}/borrow`, { token: bToken, body: { days: 1 } });
  assert.equal(blocked.status, 400);
  assert.match(blocked.data.error, /at most 3/);
  const mine = await request('GET', '/api/supplies/requests/mine', { token: bToken });
  assert.equal(mine.data.requests.filter((r) => r.status === 'approved').length, 3);
});

test('overdue items are flagged', async () => {
  const s = (await list(ownerToken, 'Old textbook', { category: 'books' })).data.supply;
  const r = await request('POST', `/api/supplies/${s.id}/borrow`, { token: aToken, body: { days: 1 } });
  await request('POST', `/api/supplies/requests/${r.data.request.id}/approve`, { token: ownerToken });
  db.prepare("UPDATE borrow_requests SET due_date = datetime('now', '-2 days') WHERE id = ?").run(r.data.request.id);
  const view = (await request('GET', `/api/supplies/${s.id}`, { token: ownerToken })).data.supply;
  assert.equal(view.overdue, true);
  assert.equal(view.borrowerName, 'Borrower Ana');
  const mine = (await request('GET', '/api/supplies/requests/mine', { token: aToken })).data.requests.find((x) => x.id === r.data.request.id);
  assert.equal(mine.overdue, true);
});

test('withdrawing closes pending requests; admin can moderate', async () => {
  const s = (await list(ownerToken, 'Extension cord', { category: 'electronics' })).data.supply;
  await request('POST', `/api/supplies/${s.id}/borrow`, { token: aToken, body: { days: 2 } });
  assert.equal((await request('PATCH', `/api/supplies/${s.id}/withdraw`, { token: bToken })).status, 403);
  assert.equal((await request('PATCH', `/api/supplies/${s.id}/withdraw`, { token: adminToken })).status, 200);
  assert.ok((await msgs(aToken)).some((m) => m.includes('no longer available')));
  const listed = await request('GET', '/api/supplies?q=Extension', { token: aToken });
  assert.equal(listed.data.supplies.length, 0);
  assert.equal((await request('POST', `/api/supplies/${s.id}/borrow`, { token: bToken, body: { days: 1 } })).status, 400);
});
