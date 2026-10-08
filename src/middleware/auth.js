const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');

const findUser = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?');

// Rejects the request unless it carries a valid "Authorization: Bearer <token>" header.
// The user is re-loaded from the database every time, so a role change by an admin
// takes effect immediately instead of waiting for the old token to expire.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = findUser.get(payload.sub);
    if (!user) return res.status(401).json({ error: 'Account no longer exists' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Usage: router.get('/x', requireAuth, requireRole('admin', 'faculty'), handler)
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to do that' });
    }
    next();
  };
}

function signToken(user) {
  return jwt.sign({ sub: user.id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

module.exports = { requireAuth, requireRole, signToken };
