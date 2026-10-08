// Admin-only user management (Admin actor in the use case diagram).
const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { notify } = require('../services/notificationService');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

const ROLES = ['student', 'faculty', 'admin'];

// GET /api/users
router.get('/', (req, res) => {
  const users = db
    .prepare('SELECT id, name, email, role, created_at AS createdAt FROM users ORDER BY id')
    .all();
  res.json({ users });
});

// PATCH /api/users/:id/role   body: { "role": "faculty" }
router.patch('/:id/role', (req, res) => {
  const id = Number(req.params.id);
  const role = String(req.body.role || '');

  if (!ROLES.includes(role)) return res.status(400).json({ error: `Role must be one of: ${ROLES.join(', ')}` });
  if (id === req.user.id) return res.status(400).json({ error: "You can't change your own role" });

  const target = db.prepare('SELECT id, name FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'User not found' });

  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  notify(id, 'role_changed', `Your role was changed to ${role}.`);
  res.json({ ok: true, id, role });
});

module.exports = router;
