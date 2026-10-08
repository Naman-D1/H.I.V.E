// Increment 1: Lost & Found.
// Flow: a student reports a lost item or hands in a found item -> others browse/search ->
// someone claims a found item -> an admin verifies the claim before it's marked resolved.
const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { notify } = require('../services/notificationService');

const router = express.Router();
router.use(requireAuth);

const TYPES = ['lost', 'found'];
const CATEGORIES = ['electronics', 'documents', 'accessories', 'clothing', 'books', 'keys', 'other'];

const publicItem = (row) => ({
  id: row.id,
  type: row.type,
  title: row.title,
  description: row.description,
  category: row.category,
  location: row.location,
  dateOccurred: row.date_occurred,
  status: row.status,
  reportedBy: row.reported_by,
  reporterName: row.reporter_name,
  createdAt: row.created_at,
});

const findItem = db.prepare(
  `SELECT items.*, users.name AS reporter_name
   FROM items JOIN users ON users.id = items.reported_by
   WHERE items.id = ?`
);

// POST /api/items   body: { type, title, description, category, location, dateOccurred }
router.post('/', (req, res) => {
  const type = String(req.body.type || '');
  const title = String(req.body.title || '').trim();
  const description = String(req.body.description || '').trim();
  const category = String(req.body.category || 'other');
  const location = String(req.body.location || '').trim();
  const dateOccurred = req.body.dateOccurred ? String(req.body.dateOccurred) : null;

  if (!TYPES.includes(type)) return res.status(400).json({ error: `Type must be one of: ${TYPES.join(', ')}` });
  if (title.length < 3) return res.status(400).json({ error: 'Please give the item a title (3+ characters)' });
  if (!CATEGORIES.includes(category)) return res.status(400).json({ error: `Category must be one of: ${CATEGORIES.join(', ')}` });

  const info = db
    .prepare(
      `INSERT INTO items (type, title, description, category, location, date_occurred, reported_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(type, title, description, category, location, dateOccurred, req.user.id);

  res.status(201).json({ item: publicItem(findItem.get(info.lastInsertRowid)) });
});

// GET /api/items?type=lost|found&status=open&category=electronics&q=wallet
router.get('/', (req, res) => {
  const clauses = [];
  const params = [];

  if (req.query.type) {
    if (!TYPES.includes(req.query.type)) return res.status(400).json({ error: `Type must be one of: ${TYPES.join(', ')}` });
    clauses.push('items.type = ?');
    params.push(req.query.type);
  }
  if (req.query.status) {
    clauses.push('items.status = ?');
    params.push(req.query.status);
  } else {
    // Default view hides closed items so the board stays relevant.
    clauses.push("items.status != 'closed'");
  }
  if (req.query.category) {
    clauses.push('items.category = ?');
    params.push(req.query.category);
  }
  if (req.query.q) {
    clauses.push('(items.title LIKE ? OR items.description LIKE ?)');
    const like = `%${req.query.q}%`;
    params.push(like, like);
  }
  if (req.query.mine === '1') {
    clauses.push('items.reported_by = ?');
    params.push(req.user.id);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT items.*, users.name AS reporter_name
       FROM items JOIN users ON users.id = items.reported_by
       ${where}
       ORDER BY items.id DESC LIMIT 200`
    )
    .all(...params);

  res.json({ items: rows.map(publicItem) });
});

// GET /api/items/:id
router.get('/:id', (req, res) => {
  const row = findItem.get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Item not found' });
  res.json({ item: publicItem(row) });
});

// PATCH /api/items/:id/close   -> reporter withdraws their own post, or an admin closes it
router.patch('/:id/close', (req, res) => {
  const row = findItem.get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Item not found' });
  if (row.reported_by !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only the person who posted this (or an admin) can close it' });
  }
  db.prepare("UPDATE items SET status = 'closed' WHERE id = ?").run(row.id);
  res.json({ ok: true });
});

// POST /api/items/:id/claim   body: { message }   -> "this is mine" / "I think this is my item"
router.post('/:id/claim', (req, res) => {
  const item = findItem.get(Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'Item not found' });
  if (item.status !== 'open') return res.status(400).json({ error: 'This item is not open for claims right now' });
  if (item.reported_by === req.user.id) return res.status(400).json({ error: "You can't claim your own post" });

  const message = String(req.body.message || '').trim();

  const existing = db
    .prepare("SELECT 1 FROM claims WHERE item_id = ? AND claimant_id = ? AND status = 'pending'")
    .get(item.id, req.user.id);
  if (existing) return res.status(409).json({ error: 'You already have a pending claim on this item' });

  const info = db
    .prepare('INSERT INTO claims (item_id, claimant_id, message) VALUES (?, ?, ?)')
    .run(item.id, req.user.id, message);

  db.prepare("UPDATE items SET status = 'claim_pending' WHERE id = ?").run(item.id);

  // Notify every admin so one of them can verify the claim.
  const admins = db.prepare("SELECT id FROM users WHERE role = 'admin'").all();
  admins.forEach((a) => notify(a.id, 'claim_submitted', `New claim on "${item.title}" needs verification.`));
  notify(item.reported_by, 'claim_submitted', `Someone claimed your post "${item.title}". An admin will verify it.`);

  res.status(201).json({ claim: { id: info.lastInsertRowid, itemId: item.id, status: 'pending' } });
});

// GET /api/items/:id/claims   -> the reporter or an admin can see who claimed it
router.get('/:id/claims', (req, res) => {
  const item = findItem.get(Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'Item not found' });
  if (item.reported_by !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only the person who posted this (or an admin) can see its claims' });
  }

  const rows = db
    .prepare(
      `SELECT claims.*, users.name AS claimant_name, users.email AS claimant_email
       FROM claims JOIN users ON users.id = claims.claimant_id
       WHERE claims.item_id = ?
       ORDER BY claims.id DESC`
    )
    .all(item.id);

  res.json({
    claims: rows.map((c) => ({
      id: c.id,
      itemId: c.item_id,
      claimantId: c.claimant_id,
      claimantName: c.claimant_name,
      claimantEmail: c.claimant_email,
      message: c.message,
      status: c.status,
      createdAt: c.created_at,
      resolvedAt: c.resolved_at,
    })),
  });
});

// ---- Admin verification ----

const findClaim = db.prepare('SELECT * FROM claims WHERE id = ?');

// POST /api/items/claims/:id/approve   (admin only)
router.post('/claims/:id/approve', requireRole('admin'), (req, res) => {
  const claim = findClaim.get(Number(req.params.id));
  if (!claim) return res.status(404).json({ error: 'Claim not found' });
  if (claim.status !== 'pending') return res.status(400).json({ error: 'This claim has already been resolved' });

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(claim.item_id);

  db.prepare("UPDATE claims SET status = 'approved', resolved_by = ?, resolved_at = datetime('now') WHERE id = ?")
    .run(req.user.id, claim.id);
  // Any other still-pending claims on the same item are now moot.
  db.prepare(
    "UPDATE claims SET status = 'rejected', resolved_by = ?, resolved_at = datetime('now') WHERE item_id = ? AND id != ? AND status = 'pending'"
  ).run(req.user.id, claim.item_id, claim.id);
  db.prepare("UPDATE items SET status = 'resolved' WHERE id = ?").run(claim.item_id);

  notify(claim.claimant_id, 'claim_approved', `Your claim on "${item.title}" was approved. Please coordinate pickup.`);
  notify(item.reported_by, 'claim_approved', `A verified claim on "${item.title}" was approved.`);

  res.json({ ok: true });
});

// POST /api/items/claims/:id/reject   (admin only)
router.post('/claims/:id/reject', requireRole('admin'), (req, res) => {
  const claim = findClaim.get(Number(req.params.id));
  if (!claim) return res.status(404).json({ error: 'Claim not found' });
  if (claim.status !== 'pending') return res.status(400).json({ error: 'This claim has already been resolved' });

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(claim.item_id);

  db.prepare("UPDATE claims SET status = 'rejected', resolved_by = ?, resolved_at = datetime('now') WHERE id = ?")
    .run(req.user.id, claim.id);

  // If no other pending claims remain, reopen the item for new claims.
  const stillPending = db
    .prepare("SELECT 1 FROM claims WHERE item_id = ? AND status = 'pending'")
    .get(claim.item_id);
  if (!stillPending) {
    db.prepare("UPDATE items SET status = 'open' WHERE id = ?").run(claim.item_id);
  }

  notify(claim.claimant_id, 'claim_rejected', `Your claim on "${item.title}" was not verified.`);

  res.json({ ok: true });
});

module.exports = router;
