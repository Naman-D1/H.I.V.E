// Notification Service (from the architecture diagram).
// Every module (Lost & Found, Supplies, Reservations) calls notify() instead of
// sending messages itself, so formatting/delivery lives in exactly one place.
const db = require('../db');

const insertStmt = db.prepare(
  'INSERT INTO notifications (user_id, type, message) VALUES (?, ?, ?)'
);

function notify(userId, type, message) {
  const info = insertStmt.run(userId, type, message);
  // Later: hand off to an email / push gateway here (Nodemailer, Firebase, ...).
  return info.lastInsertRowid;
}

function listForUser(userId, { unreadOnly = false } = {}) {
  const sql =
    'SELECT id, type, message, is_read AS isRead, created_at AS createdAt ' +
    'FROM notifications WHERE user_id = ? ' +
    (unreadOnly ? 'AND is_read = 0 ' : '') +
    'ORDER BY id DESC LIMIT 100';
  return db.prepare(sql).all(userId).map((n) => ({ ...n, isRead: Boolean(n.isRead) }));
}

function markRead(userId, notificationId) {
  const info = db
    .prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?')
    .run(notificationId, userId);
  return info.changes > 0;
}

function markAllRead(userId) {
  return db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(userId).changes;
}

module.exports = { notify, listForUser, markRead, markAllRead };
