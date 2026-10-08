const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('./src/config');
const db = require('./src/db');

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/users', require('./src/routes/users'));
app.use('/api/notifications', require('./src/routes/notifications'));
app.use('/api/items', require('./src/routes/items'));                     // Increment 1: Lost & Found
app.use('/api/supplies', require('./src/routes/supplies'));               // Increment 2: Supplies Sharing
// Increment 3: app.use('/api/bookings', require('./src/routes/bookings')); // Reservations

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Last-resort error handler so a bug never leaks a stack trace to the client.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side' });
});

// Create the first admin from .env if there isn't one yet.
function seedAdmin() {
  if (!config.adminEmail || !config.adminPassword) return;
  const exists = db.prepare('SELECT 1 FROM users WHERE email = ?').get(config.adminEmail);
  if (exists) return;
  db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES ('Administrator', ?, ?, 'admin')")
    .run(config.adminEmail, bcrypt.hashSync(config.adminPassword, 10));
  console.log(`Seeded admin account: ${config.adminEmail}`);
}
seedAdmin();

if (require.main === module) {
  app.listen(config.port, () => console.log(`H.I.V.E. running at http://localhost:${config.port}`));
}

module.exports = app;
