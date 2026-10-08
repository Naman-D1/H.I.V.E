const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.DB_FILE = path.join(__dirname, 'test-items.db');
process.env.JWT_SECRET = 'test-secret-key-not-for-production';
process.env.ADMIN_EMAIL = 'admin@test.edu';
process.env.ADMIN_PASSWORD = 'admin-password-1';
delete process.env.ALLOWED_EMAIL_DOMAIN;

for (const f of ['test-items.db', 'test-items.db-wal', 'test-items.db-shm']) {
  const p = path.join(__dirname, f);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

// Fresh require cache so this file doesn't reuse a db connection opened by core.test.js.
delete require.cache[require.resolve('../server')];
delete require.cache[require.resolve('../src/db')];
delete require.cache[require.resolve('../src/config')];
const app = require('../server');

async function request(method, url, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`http://127.0.0.1:${app.__testPort}${url}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}

let server;
let adminToken, finderToken, ownerToken;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      app.__testPort = server.address().port;
      resolve();
    });
  });

  const admin = await request('POST', '/api/auth/login', { body: { email: 'admin@test.edu', password: 'admin-password-1' } });
  adminToken = admin.data.token;

  const owner = await request('POST', '/api/auth/register', { body: { name: 'Owner Oli', email: 'owner@test.edu', password: 'longenoughpw' } });
  ownerToken = owner.data.token;

  const finder = await request('POST', '/api/auth/register', { body: { name: 'Finder Fin', email: 'finder@test.edu', password: 'longenoughpw' } });
  finderToken = finder.data.token;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  for (const f of ['test-items.db', 'test-items.db-wal', 'test-items.db-shm']) {
    const p = path.join(__dirname, f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
});

test('reporting a lost item requires a title', async () => {
  const { status, data } = await request('POST', '/api/items', {
    token: ownerToken,
    body: { type: 'lost', title: 'hi' },
  });
  assert.equal(status, 400);
  assert.match(data.error, /title/i);
});

let itemId;

test('owner reports a lost wallet', async () => {
  const { status, data } = await request('POST', '/api/items', {
    token: ownerToken,
    body: { type: 'lost', title: 'Brown leather wallet', category: 'accessories', location: 'Canteen', description: 'Has my college ID inside' },
  });
  assert.equal(status, 201);
  assert.equal(data.item.status, 'open');
  itemId = data.item.id;
});

test('the item shows up in the browse list', async () => {
  const { data } = await request('GET', '/api/items?type=lost', { token: finderToken });
  assert.ok(data.items.some((i) => i.id === itemId));
});

test('search filters by keyword', async () => {
  const { data } = await request('GET', '/api/items?q=wallet', { token: finderToken });
  assert.ok(data.items.some((i) => i.id === itemId));
  const { data: miss } = await request('GET', '/api/items?q=nonexistentxyz', { token: finderToken });
  assert.equal(miss.items.length, 0);
});

test('the owner cannot claim their own post', async () => {
  const { status, data } = await request('POST', `/api/items/${itemId}/claim`, {
    token: ownerToken,
    body: { message: 'mine' },
  });
  assert.equal(status, 400);
  assert.match(data.error, /own post/i);
});

let claimId;

test('the finder claims the item, which moves it to claim_pending', async () => {
  const { status, data } = await request('POST', `/api/items/${itemId}/claim`, {
    token: finderToken,
    body: { message: 'Found it near the canteen cash counter' },
  });
  assert.equal(status, 201);
  claimId = data.claim.id;

  const item = await request('GET', `/api/items/${itemId}`, { token: ownerToken });
  assert.equal(item.data.item.status, 'claim_pending');
});

test('a non-owner, non-admin cannot view claims on the item', async () => {
  const stranger = await request('POST', '/api/auth/register', { body: { name: 'Stranger', email: 'stranger@test.edu', password: 'longenoughpw' } });
  const { status } = await request('GET', `/api/items/${itemId}/claims`, { token: stranger.data.token });
  assert.equal(status, 403);
});

test('the owner can see the claim', async () => {
  const { status, data } = await request('GET', `/api/items/${itemId}/claims`, { token: ownerToken });
  assert.equal(status, 200);
  assert.equal(data.claims.length, 1);
  assert.equal(data.claims[0].status, 'pending');
});

test('a non-admin cannot approve a claim', async () => {
  const { status } = await request('POST', `/api/items/claims/${claimId}/approve`, { token: ownerToken });
  assert.equal(status, 403);
});

test('an admin approves the claim, resolving the item and notifying both parties', async () => {
  const { status } = await request('POST', `/api/items/claims/${claimId}/approve`, { token: adminToken });
  assert.equal(status, 200);

  const item = await request('GET', `/api/items/${itemId}`, { token: ownerToken });
  assert.equal(item.data.item.status, 'resolved');

  const finderNotes = await request('GET', '/api/notifications', { token: finderToken });
  assert.ok(finderNotes.data.notifications.some((n) => n.type === 'claim_approved'));

  const ownerNotes = await request('GET', '/api/notifications', { token: ownerToken });
  assert.ok(ownerNotes.data.notifications.some((n) => n.type === 'claim_approved'));
});

test('approving the same claim twice is rejected', async () => {
  const { status } = await request('POST', `/api/items/claims/${claimId}/approve`, { token: adminToken });
  assert.equal(status, 400);
});

test('a rejected claim reopens the item for new claims', async () => {
  const report = await request('POST', '/api/items', {
    token: ownerToken,
    body: { type: 'found', title: 'Blue umbrella', category: 'other' },
  });
  const newItemId = report.data.item.id;

  const claim = await request('POST', `/api/items/${newItemId}/claim`, { token: finderToken, body: { message: 'that is mine' } });
  const newClaimId = claim.data.claim.id;

  const reject = await request('POST', `/api/items/claims/${newClaimId}/reject`, { token: adminToken });
  assert.equal(reject.status, 200);

  const item = await request('GET', `/api/items/${newItemId}`, { token: ownerToken });
  assert.equal(item.data.item.status, 'open');
});

test('the owner can withdraw their own post', async () => {
  const report = await request('POST', '/api/items', { token: ownerToken, body: { type: 'lost', title: 'Spare charger' } });
  const id = report.data.item.id;

  const close = await request('PATCH', `/api/items/${id}/close`, { token: ownerToken });
  assert.equal(close.status, 200);

  const item = await request('GET', `/api/items/${id}`, { token: ownerToken });
  assert.equal(item.data.item.status, 'closed');

  // Closed items are hidden from the default browse view.
  const list = await request('GET', '/api/items', { token: ownerToken });
  assert.ok(!list.data.items.some((i) => i.id === id));
});
