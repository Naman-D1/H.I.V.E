// Shared database layer. Increment 0 only needs "users" and "notifications".
// Later increments add their own tables (items, claims, supplies, bookings...) below.
const Database = require('better-sqlite3');
const config = require('./config');

const db = new Database(config.dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'student'
                  CHECK (role IN ('student', 'faculty', 'admin')),
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type       TEXT NOT NULL,
    message    TEXT NOT NULL,
    is_read    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_notifications_user
    ON notifications (user_id, is_read);

  -- Increment 1: Lost & Found
  CREATE TABLE IF NOT EXISTS items (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    type           TEXT NOT NULL CHECK (type IN ('lost', 'found')),
    title          TEXT NOT NULL,
    description    TEXT NOT NULL DEFAULT '',
    category       TEXT NOT NULL DEFAULT 'other',
    location       TEXT NOT NULL DEFAULT '',
    date_occurred  TEXT,
    status         TEXT NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'claim_pending', 'resolved', 'closed')),
    reported_by    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_items_status ON items (type, status);

  CREATE TABLE IF NOT EXISTS claims (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id      INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    claimant_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message      TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'approved', 'rejected')),
    resolved_by  INTEGER REFERENCES users(id),
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at  TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_claims_item ON claims (item_id, status);

  -- Increment 2: Supplies Sharing
  CREATE TABLE IF NOT EXISTS supplies (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    category     TEXT NOT NULL DEFAULT 'other',
    status       TEXT NOT NULL DEFAULT 'available'
                 CHECK (status IN ('available', 'on_loan', 'withdrawn')),
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_supplies_status ON supplies (status, category);

  CREATE TABLE IF NOT EXISTS borrow_requests (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    supply_id     INTEGER NOT NULL REFERENCES supplies(id) ON DELETE CASCADE,
    borrower_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message       TEXT NOT NULL DEFAULT '',
    days          INTEGER NOT NULL DEFAULT 3,
    status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'returned')),
    due_date      TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at   TEXT,
    returned_at   TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_borrow_supply ON borrow_requests (supply_id, status);
  CREATE INDEX IF NOT EXISTS idx_borrow_borrower ON borrow_requests (borrower_id, status);
`);

module.exports = db;
