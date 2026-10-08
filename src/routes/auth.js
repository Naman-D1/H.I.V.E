const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const config = require('../config');
const { requireAuth, signToken } = require('../middleware/auth');
const { notify } = require('../services/notificationService');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Used so that "unknown email" and "wrong password" take similar time (avoids leaking which emails exist).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

const findByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const insertUser = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)');

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });

// POST /api/auth/register  -> always creates a STUDENT. Admins promote people to faculty/admin later.
router.post('/register', (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (name.length < 2) return res.status(400).json({ error: 'Please enter your full name' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid email address' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  if (config.allowedEmailDomain && !email.endsWith('@' + config.allowedEmailDomain)) {
    return res.status(400).json({ error: `Please use your college email (@${config.allowedEmailDomain})` });
  }
  if (findByEmail.get(email)) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const id = insertUser.run(name, email, hash).lastInsertRowid;
  const user = findByEmail.get(email);

  notify(id, 'welcome', `Welcome to the Hive, ${name}!`);
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  const user = findByEmail.get(email);
  const ok = bcrypt.compareSync(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) return res.status(401).json({ error: 'Invalid email or password' });

  res.json({ token: signToken(user), user: publicUser(user) });
});

// GET /api/auth/me  -> who am I? (used by the frontend on page load)
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
