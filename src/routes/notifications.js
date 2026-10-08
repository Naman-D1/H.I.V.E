const express = require('express');
const { requireAuth } = require('../middleware/auth');
const svc = require('../services/notificationService');

const router = express.Router();
router.use(requireAuth);

// GET /api/notifications?unread=1
router.get('/', (req, res) => {
  const notifications = svc.listForUser(req.user.id, { unreadOnly: req.query.unread === '1' });
  res.json({ notifications, unreadCount: notifications.filter((n) => !n.isRead).length });
});

// POST /api/notifications/read-all   (defined before "/:id/read" so "read-all" isn't treated as an id)
router.post('/read-all', (req, res) => {
  res.json({ updated: svc.markAllRead(req.user.id) });
});

// POST /api/notifications/:id/read
router.post('/:id/read', (req, res) => {
  const ok = svc.markRead(req.user.id, Number(req.params.id));
  if (!ok) return res.status(404).json({ error: 'Notification not found' });
  res.json({ ok: true });
});

module.exports = router;
