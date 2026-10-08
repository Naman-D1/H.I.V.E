// Increment 2: Supplies Sharing.
// Flow: a student lists something they can lend -> others browse/search -> someone requests to borrow
// it for N days -> the OWNER approves (it goes on loan, due date set) or rejects -> the owner marks it
// returned. Admins can moderate (remove listings, resolve requests) but peers handle the handover.
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { notify } = require('../services/notificationService');

const router = express.Router();
router.use(requireAuth);

const CATEGORIES = ['stationery', 'electronics', 'books', 'lab_equipment', 'tools', 'other'];
const MAX_DAYS = 30;
const MAX_ACTIVE_LOANS = 3; // per borrower, at once

const isAdmin = (req) => req.user.role === 'admin';

// A supply joined with its owner and (if on loan) the current borrower + due date.
const SUPPLY_SELECT = `
  SELECT supplies.*, owner.name AS owner_name,
         (SELECT COUNT(*) FROM borrow_requests br WHERE br.supply_id = supplies.id AND br.status = 'pending') AS pending_count,
         loan.id AS loan_id, loan.borrower_id AS loan_borrower_id, loan.due_date AS due_date,
         borrower.name AS loan_borrower_name,
         CASE WHEN loan.due_date IS NOT NULL AND loan.due_date < datetime('now') THEN 1 ELSE 0 END AS overdue
  FROM supplies
  JOIN users owner ON owner.id = supplies.owner_id
  LEFT JOIN borrow_requests loan ON loan.supply_id = supplies.id AND loan.status = 'approved'
  LEFT JOIN users borrower ON borrower.id = loan.borrower_id`;

const publicSupply = (r, viewerId) => ({
  id: r.id,
  title: r.title,
  description: r.description,
  category: r.category,
  status: r.status,
  ownerId: r.owner_id,
  ownerName: r.owner_name,
  pendingCount: r.pending_count,
  dueDate: r.due_date || null,
  overdue: !!r.overdue,
  // Only the owner and the borrower need to see who has it.
  borrowerName: r.loan_borrower_id && (r.owner_id === viewerId || r.loan_borrower_id === viewerId) ? r.loan_borrower_name : null,
  borrowedByMe: r.loan_borrower_id === viewerId,
  createdAt: r.created_at,
});

const findSupply = db.prepare(`${SUPPLY_SELECT} WHERE supplies.id = ?`);

const publicRequest = (r) => ({
  id: r.id,
  supplyId: r.supply_id,
  supplyTitle: r.supply_title,
  borrowerId: r.borrower_id,
  borrowerName: r.borrower_name,
  ownerName: r.owner_name,
  message: r.message,
  days: r.days,
  status: r.status,
  dueDate: r.due_date,
  overdue: r.status === 'approved' && !!r.overdue,
  createdAt: r.created_at,
  resolvedAt: r.resolved_at,
  returnedAt: r.returned_at,
});

const REQUEST_SELECT = `
  SELECT br.*, s.title AS supply_title, s.owner_id AS owner_id, s.status AS supply_status,
         b.name AS borrower_name, o.name AS owner_name,
         CASE WHEN br.due_date IS NOT NULL AND br.due_date < datetime('now') THEN 1 ELSE 0 END AS overdue
  FROM borrow_requests br
  JOIN supplies s ON s.id = br.supply_id
  JOIN users b ON b.id = br.borrower_id
  JOIN users o ON o.id = s.owner_id`;
const findRequest = db.prepare(`${REQUEST_SELECT} WHERE br.id = ?`);

const activeLoanCount = db.prepare(
  "SELECT COUNT(*) AS n FROM borrow_requests WHERE borrower_id = ? AND status = 'approved'"
);

// POST /api/supplies   body: { title, description, category }
router.post('/', (req, res) => {
  const title = String(req.body.title || '').trim();
  const description = String(req.body.description || '').trim();
  const category = String(req.body.category || 'other');

  if (title.length < 3) return res.status(400).json({ error: 'Please give the item a title (3+ characters)' });
  if (!CATEGORIES.includes(category)) return res.status(400).json({ error: `Category must be one of: ${CATEGORIES.join(', ')}` });

  const info = db
    .prepare('INSERT INTO supplies (owner_id, title, description, category) VALUES (?, ?, ?, ?)')
    .run(req.user.id, title, description, category);

  res.status(201).json({ supply: publicSupply(findSupply.get(info.lastInsertRowid), req.user.id) });
});

// GET /api/supplies?category=&status=&q=&mine=1
router.get('/', (req, res) => {
  const clauses = [];
  const params = [];

  if (req.query.status) {
    clauses.push('supplies.status = ?');
    params.push(req.query.status);
  } else {
    clauses.push("supplies.status != 'withdrawn'");
  }
  if (req.query.category) {
    clauses.push('supplies.category = ?');
    params.push(req.query.category);
  }
  if (req.query.q) {
    clauses.push('(supplies.title LIKE ? OR supplies.description LIKE ?)');
    const like = `%${req.query.q}%`;
    params.push(like, like);
  }
  if (req.query.mine === '1') {
    clauses.push('supplies.owner_id = ?');
    params.push(req.user.id);
  }

  const rows = db
    .prepare(`${SUPPLY_SELECT} WHERE ${clauses.join(' AND ')} ORDER BY supplies.id DESC LIMIT 200`)
    .all(...params);

  res.json({ supplies: rows.map((r) => publicSupply(r, req.user.id)) });
});

// GET /api/supplies/requests/mine   -> everything I have asked to borrow
router.get('/requests/mine', (req, res) => {
  const rows = db
    .prepare(`${REQUEST_SELECT} WHERE br.borrower_id = ? ORDER BY br.id DESC LIMIT 100`)
    .all(req.user.id);
  res.json({ requests: rows.map(publicRequest) });
});

// GET /api/supplies/:id
router.get('/:id', (req, res) => {
  const row = findSupply.get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Supply not found' });
  res.json({ supply: publicSupply(row, req.user.id) });
});

// POST /api/supplies/:id/borrow   body: { days, message }
router.post('/:id/borrow', (req, res) => {
  const supply = findSupply.get(Number(req.params.id));
  if (!supply) return res.status(404).json({ error: 'Supply not found' });
  if (supply.owner_id === req.user.id) return res.status(400).json({ error: "You can't borrow your own item" });
  if (supply.status !== 'available') return res.status(400).json({ error: 'This item is not available to borrow right now' });

  const days = req.body.days === undefined || req.body.days === '' ? 3 : Number(req.body.days);
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    return res.status(400).json({ error: `Borrow period must be a whole number of days between 1 and ${MAX_DAYS}` });
  }

  const dup = db
    .prepare("SELECT 1 FROM borrow_requests WHERE supply_id = ? AND borrower_id = ? AND status = 'pending'")
    .get(supply.id, req.user.id);
  if (dup) return res.status(409).json({ error: 'You already have a pending request for this item' });

  if (activeLoanCount.get(req.user.id).n >= MAX_ACTIVE_LOANS) {
    return res.status(400).json({ error: `You can have at most ${MAX_ACTIVE_LOANS} items on loan at once. Return one first.` });
  }

  const message = String(req.body.message || '').trim();
  const info = db
    .prepare('INSERT INTO borrow_requests (supply_id, borrower_id, message, days) VALUES (?, ?, ?, ?)')
    .run(supply.id, req.user.id, message, days);

  notify(supply.owner_id, 'borrow_requested', `${req.user.name} wants to borrow "${supply.title}" for ${days} day${days === 1 ? '' : 's'}.`);

  res.status(201).json({ request: { id: info.lastInsertRowid, supplyId: supply.id, status: 'pending', days } });
});

// GET /api/supplies/:id/requests   -> the owner (or an admin) sees who asked
router.get('/:id/requests', (req, res) => {
  const supply = findSupply.get(Number(req.params.id));
  if (!supply) return res.status(404).json({ error: 'Supply not found' });
  if (supply.owner_id !== req.user.id && !isAdmin(req)) {
    return res.status(403).json({ error: 'Only the owner (or an admin) can see requests for this item' });
  }
  const rows = db
    .prepare(`${REQUEST_SELECT} WHERE br.supply_id = ? ORDER BY br.id DESC`)
    .all(supply.id);
  res.json({ requests: rows.map(publicRequest) });
});

// PATCH /api/supplies/:id/withdraw   -> owner (or admin) removes the listing
router.patch('/:id/withdraw', (req, res) => {
  const supply = findSupply.get(Number(req.params.id));
  if (!supply) return res.status(404).json({ error: 'Supply not found' });
  if (supply.owner_id !== req.user.id && !isAdmin(req)) {
    return res.status(403).json({ error: 'Only the owner (or an admin) can withdraw this item' });
  }
  if (supply.status === 'on_loan') {
    return res.status(400).json({ error: 'This item is on loan. Mark it returned before withdrawing it.' });
  }

  const pending = db.prepare("SELECT * FROM borrow_requests WHERE supply_id = ? AND status = 'pending'").all(supply.id);
  db.prepare("UPDATE borrow_requests SET status = 'rejected', resolved_at = datetime('now') WHERE supply_id = ? AND status = 'pending'").run(supply.id);
  db.prepare("UPDATE supplies SET status = 'withdrawn' WHERE id = ?").run(supply.id);
  pending.forEach((r) => notify(r.borrower_id, 'borrow_rejected', `"${supply.title}" is no longer available, so your request was closed.`));

  res.json({ ok: true });
});

// ---- Request handling ----

// Owner (or admin) must be the one acting on a request.
function loadForOwner(req, res) {
  const r = findRequest.get(Number(req.params.id));
  if (!r) { res.status(404).json({ error: 'Request not found' }); return null; }
  if (r.owner_id !== req.user.id && !isAdmin(req)) {
    res.status(403).json({ error: 'Only the owner of this item (or an admin) can do that' });
    return null;
  }
  return r;
}

// POST /api/supplies/requests/:id/approve
router.post('/requests/:id/approve', (req, res) => {
  const r = loadForOwner(req, res);
  if (!r) return;
  if (r.status !== 'pending') return res.status(400).json({ error: 'This request has already been handled' });
  if (r.supply_status !== 'available') return res.status(400).json({ error: 'This item is not available to lend right now' });
  if (activeLoanCount.get(r.borrower_id).n >= MAX_ACTIVE_LOANS) {
    return res.status(400).json({ error: `${r.borrower_name} already has ${MAX_ACTIVE_LOANS} items on loan` });
  }

  db.prepare(
    "UPDATE borrow_requests SET status = 'approved', resolved_at = datetime('now'), due_date = datetime('now', ?) WHERE id = ?"
  ).run(`+${r.days} days`, r.id);
  db.prepare("UPDATE supplies SET status = 'on_loan' WHERE id = ?").run(r.supply_id);

  // Everyone else waiting on this item is turned down.
  const others = db
    .prepare("SELECT * FROM borrow_requests WHERE supply_id = ? AND id != ? AND status = 'pending'")
    .all(r.supply_id, r.id);
  db.prepare(
    "UPDATE borrow_requests SET status = 'rejected', resolved_at = datetime('now') WHERE supply_id = ? AND id != ? AND status = 'pending'"
  ).run(r.supply_id, r.id);

  notify(r.borrower_id, 'borrow_approved', `Your request for "${r.supply_title}" was approved. Please return it within ${r.days} day${r.days === 1 ? '' : 's'}.`);
  others.forEach((o) => notify(o.borrower_id, 'borrow_rejected', `"${r.supply_title}" has been lent to someone else.`));

  res.json({ ok: true });
});

// POST /api/supplies/requests/:id/reject
router.post('/requests/:id/reject', (req, res) => {
  const r = loadForOwner(req, res);
  if (!r) return;
  if (r.status !== 'pending') return res.status(400).json({ error: 'This request has already been handled' });

  db.prepare("UPDATE borrow_requests SET status = 'rejected', resolved_at = datetime('now') WHERE id = ?").run(r.id);
  notify(r.borrower_id, 'borrow_rejected', `Your request for "${r.supply_title}" was declined.`);
  res.json({ ok: true });
});

// POST /api/supplies/requests/:id/return   -> owner confirms they got it back
router.post('/requests/:id/return', (req, res) => {
  const r = loadForOwner(req, res);
  if (!r) return;
  if (r.status !== 'approved') return res.status(400).json({ error: 'This item is not currently on loan to this person' });

  db.prepare("UPDATE borrow_requests SET status = 'returned', returned_at = datetime('now') WHERE id = ?").run(r.id);
  db.prepare("UPDATE supplies SET status = 'available' WHERE id = ?").run(r.supply_id);
  notify(r.borrower_id, 'borrow_returned', `"${r.supply_title}" was marked as returned. Thanks!`);
  res.json({ ok: true });
});

// POST /api/supplies/requests/:id/cancel   -> borrower withdraws a request that's still pending
router.post('/requests/:id/cancel', (req, res) => {
  const r = findRequest.get(Number(req.params.id));
  if (!r) return res.status(404).json({ error: 'Request not found' });
  if (r.borrower_id !== req.user.id) return res.status(403).json({ error: 'You can only cancel your own requests' });
  if (r.status !== 'pending') return res.status(400).json({ error: 'Only pending requests can be cancelled' });

  db.prepare("UPDATE borrow_requests SET status = 'cancelled', resolved_at = datetime('now') WHERE id = ?").run(r.id);
  res.json({ ok: true });
});

module.exports = router;
