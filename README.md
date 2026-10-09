# H.I.V.E. (Unified Campus Utility System)

H.I.V.E. is a centralized campus utility platform designed for colleges and universities. It unifies essential campus operations into one secure, accessible, mobile-first ecosystem.

---

## 🏛️ System Overview

The system combines seven core operational modules:

1. **Authentication & Role Authorization**: Secure JWT authentication with strict role-based access for `STUDENT`, `FACULTY`, and `ADMIN`.
2. **Lost & Found System**: Full reporting, categorization, searching, and claim verification workflow with owner alerts.
3. **Supplies Sharing Marketplace**: Peer-to-peer sharing of academic books, scientific calculators, technical kits, and notes.
4. **Classroom & Lab Booking**: Schedule requests with live interval overlap conflict prevention and faculty/admin approval queue.
5. **Centralized Notification Engine**: Real-time event notifications for bookings, claims, and campus alerts.
6. **Faculty Dashboard**: Request lab reservations, review student requests, and broadcast academic items.
7. **Administrator Control Center**: Campus metrics analytics, user management, role promotion/demotion protections, and room status management.

---

## 🏗️ Architecture

```text
                  ┌──────────────────────────────────────────────┐
                  │          Android Mobile Application          │
                  │        (Jetpack Compose / React Native)      │
                  └──────────────────────┬───────────────────────┘
                                         │ HTTPS / REST API
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │             Node.js + Express API            │
                  │   (Auth, Items, Supplies, Bookings, Notifs)  │
                  └──────────────────────┬───────────────────────┘
                                         │ Parameterized Queries & Transactions
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │             SQLite Database (WAL)            │
                  │          (PostgreSQL Migration Ready)        │
                  └──────────────────────────────────────────────┘
```

---

## 🔐 Pre-seeded Credentials (Development)

| Persona | Email | Password | Role |
| :--- | :--- | :--- | :--- |
| **Administrator** | `admin@hive.local` | `Admin@123` | `ADMIN` |
| **Faculty Member** | `faculty@hive.local` | `Faculty@123` | `FACULTY` |
| **Student** | `student@hive.local` | `Student@123` | `STUDENT` |

*(Note: The Android app also includes a 1-tap Demo Role Switcher in the top bar and profile screen to instantly test all 3 personas.)*

---

## 🚀 Backend Setup & Execution

### Prerequisites
- Node.js 18+ (tested on Node.js v22 LTS)
- npm 9+

### Installation & Database Initialization
```bash
# 1. Install dependencies
npm install

# 2. Seed SQLite database with campus fixtures
npm run seed

# 3. Run automated backend test suite
npm test

# 4. Start the backend REST API
npm start
```
The backend server runs on `http://0.0.0.0:5000`.

---

## 📱 Android App Execution & Networking

### Android Emulator Loopback
When testing in the Android Emulator, the host machine is accessible via `http://10.0.2.2:5000` rather than `localhost`.
The Android app is pre-configured with `http://10.0.2.2:5000/` as the default API Base URL.

### Standalone & Offline Mode
The Android app is built with an **Offline-First Architecture** using **Room Database**. It pre-seeds realistic campus records locally and syncs with the REST API automatically when the backend server is reachable.

### Running with Gradle
```bash
# Compile and assemble debug APK
gradle assembleDebug

# Run unit tests
gradle :app:testDebugUnitTest
```

---

## 📡 API Endpoints Reference

### Authentication
- `POST /api/auth/register` - Create new student account (role locked to `STUDENT`)
- `POST /api/auth/login` - Authenticate and retrieve JWT
- `GET /api/auth/me` - Retrieve current session user profile
- `POST /api/auth/logout` - Logout session
- `POST /api/auth/change-password` - Update password

### Lost & Found (`/api/items`)
- `GET /api/items?search=&category=&status=` - Browse lost & found items
- `GET /api/items/:id` - Item details with claims count
- `POST /api/items` - Report lost or found item
- `PATCH /api/items/:id` - Edit item (owner or admin)
- `DELETE /api/items/:id` - Delete item (owner or admin)

### Claims (`/api/claims`)
- `GET /api/claims` - List claims (role filtered)
- `POST /api/items/:id/claims` - Submit claim with proof of ownership
- `PATCH /api/claims/:id` - Approve/reject claim with atomic item status update

### Supplies Sharing (`/api/supplies`)
- `GET /api/supplies?search=&category=&condition=&status=` - List supplies
- `POST /api/supplies` - Post supply listing
- `POST /api/supplies/:id/request` - Request supply from owner
- `PATCH /api/supplies/requests/:requestId` - Accept/reject request

### Classroom & Lab Bookings (`/api/bookings`)
- `GET /api/rooms` - List campus rooms and facilities
- `GET /api/rooms/:id/availability?date=YYYY-MM-DD` - Check bookings for a date
- `GET /api/bookings` - List user / all bookings
- `POST /api/bookings` - Request booking (validates interval overlaps)
- `PATCH /api/bookings/:id` - Approve, reject, or cancel booking

### Notifications & Admin
- `GET /api/notifications` - Retrieve notifications with unread count
- `PATCH /api/notifications/:id/read` - Mark notification as read
- `PATCH /api/notifications/read-all` - Mark all notifications read
- `GET /api/stats` - Admin metrics (users, bookings, lost items, supplies)
- `GET /api/users` - Admin user list with search & filter
- `PATCH /api/users/:id/role` - Admin role update (protected against removing last admin)
- `PATCH /api/users/:id/status` - Admin status update (ACTIVE / SUSPENDED)
