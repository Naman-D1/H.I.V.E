# H.I.V.E. — Hub for Items, Venues & Exchange

A unified campus platform combining **Digital Lost & Found**, **Stationery/Supplies Sharing**,
and **Lab/Classroom Reservation** into one app, built using an Incremental software process model.

This repo contains **Increment 0: the core platform** — accounts, roles, and notifications —
that every later increment (Lost & Found, Supplies, Bookings) will plug into.

## Tech stack
- Node.js + Express
- SQLite via `better-sqlite3` (no separate database server to install)
- JWT authentication, bcrypt password hashing
- Vanilla HTML/CSS/JS frontend (dark theme, neon green/yellow, hexagon UI)

## Running it

1. **Install dependencies**
   ```
   npm install
   ```

2. **Create your `.env` file**
   ```
   cp .env.example .env
   ```
   Then open `.env` and fill in at least:
   - `JWT_SECRET` — any long random string (the comment in the file shows a command to generate one)
   - `ADMIN_EMAIL` / `ADMIN_PASSWORD` — the first admin account gets created automatically on first run

3. **Start the server**
   ```
   npm start
   ```
   You should see:
   ```
   Seeded admin account: you@yourcollege.edu
   H.I.V.E. running at http://localhost:3000
   ```

4. Open **http://localhost:3000** in your browser — that's the whole app, frontend and backend served from the same place.

## Running the tests

```
npm test
```

This runs 11 automated tests covering registration, login, role changes, and notifications,
using a throwaway test database (your real `hive.db` is never touched).

## Project structure

```
server.js              Express app entry point
src/config.js          reads .env, exposes config values
src/db.js               SQLite connection + schema
src/middleware/auth.js  JWT auth + role-check middleware
src/routes/             auth, users (admin), notifications
src/services/           notification helper used by every module
public/                 frontend (index.html = login/register, dashboard.html = main app)
tests/core.test.js      automated test suite
```

## A note for Windows users

If `npm start` crashes with a native-module error mentioning `better-sqlite3` or
`RemoveEnvironmentCleanupHook`, it means your Node.js version is newer than the
`better-sqlite3` build you have installed. This is already fixed in `package.json`
(pinned to `better-sqlite3@^13.0.3`, which supports Node 22+), but if you installed
dependencies before this fix, just do a clean reinstall:

```
rmdir /s /q node_modules
del package-lock.json
npm install
```

## Increment 1: Lost & Found

Live now. From the dashboard, click the **Lost & Found** module card (or go to
`lost-found.html` directly).

- **Report** a lost or found item (title, category, location, date, description)
- **Browse & search** open items, filter by lost/found, category, or "my posts only"
- **Claim** an open item you believe is yours — this moves it to "pending" and notifies
  the original poster and every admin
- **Admin verification** — an admin reviews the claim's note and approves or rejects it
  from the "View claims" panel on that item. Approving resolves the item and auto-rejects
  any other pending claims on it; rejecting reopens the item for new claims.

New tables: `items`, `claims` (see `src/db.js`). New route file: `src/routes/items.js`.
Covered by `tests/items.test.js` (report validation, search, claim/approve/reject flow,
permission checks, withdraw).

## Increment 2: Supplies Sharing

Students lend and borrow stationery, books, lab equipment and tools. The owner handles the handover; admins can moderate.

- **List** something you can lend (`POST /api/supplies`), **browse/search/filter** (`GET /api/supplies?q=&category=&mine=1`).
- **Request to borrow** for 1-30 days (`POST /api/supplies/:id/borrow`). Rules: not your own item, one pending request per item, at most **3 items on loan** per borrower.
- The **owner approves or declines** (`POST /api/supplies/requests/:id/approve|reject`). Approving puts the item on loan, sets the due date, and auto-declines everyone else waiting.
- The owner **marks it returned** (`.../return`), which makes it available again. Borrowers can **cancel** a pending request (`.../cancel`).
- **Overdue** loans are flagged (computed from the due date; no background job, no automatic reminders yet).
- Owners/admins can **withdraw** a listing unless it is on loan. Pending requests are closed with a notification.
- Every step notifies the people involved through the Increment 0 notification service.

Fixes shipped with this increment: notification timestamps now read SQLite's UTC times correctly (no more "5h ago"), user-supplied text on the dashboard is HTML-escaped, and cancelling the Lost & Found claim prompt no longer submits the claim.

## Roadmap (future increments)

- **Increment 3** — Lab & Classroom Booking (reserve rooms/labs for a time slot)

Each increment adds its own route file under `src/routes/` and reuses the
auth, roles, and notification system already built here.
