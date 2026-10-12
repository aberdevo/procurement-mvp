# Requisitions: procurement and approval MVP

An internal app for purchase requests, multi-level approvals, vendor quotes, and purchase orders. It runs as a single Express server with a React front end. Data lives in SQLite, so there is nothing else to install.

## Quick start

You need Node.js 18.18 or later.

```bash
# 1. API
cd backend
cp .env.example .env          # set JWT_SECRET; SEED_PASSWORD is optional
npm install
npm run seed                  # creates departments, demo users and vendors
npm run dev                   # API on http://localhost:4000

# 2. Web app (second terminal)
cd frontend
npm install
npm run dev                   # http://localhost:5173 (proxies /api to :4000)
```

Demo sign-ins use the password `ChangeMe123!` unless you set `SEED_PASSWORD`:

| Email | Role | Department |
|---|---|---|
| admin@corp.test | Admin | none |
| finance@corp.test | Finance | none |
| procurement@corp.test | Procurement officer | none |
| marcus@corp.test | Department manager | Engineering |
| dev@corp.test | Requester | Engineering |
| lena@corp.test | Department manager | Operations |
| sam@corp.test | Requester | Operations |

For a single-process production run, build the front end (`npm run build` in `frontend/`) and start the API. Express then serves the UI and the API from one port.

```bash
cd backend && JWT_SECRET=... npm start   # http://localhost:4000
```

Run the tests with `cd backend && npm test`. There are 17 tests. They cover the approval routing, quote rules, role access, upload validation, the append-only audit log, and a full end-to-end workflow.

## Roles

| Capability | Requester | Manager | Procurement | Finance | Admin |
|---|:-:|:-:|:-:|:-:|:-:|
| Create, edit and submit own requests | ✓ | ✓ | | | |
| Approve or reject requests from own department | | ✓ | | | |
| Final sign-off on requests of $1,000+ | | | | ✓ | |
| Add and manage vendors | | | ✓ | | ✓ |
| Upload vendor quotes, choose winner, issue PO | | | ✓ | | |
| View vendor quotes | | ✓ | ✓ | ✓ | ✓ |
| View audit log and sent email | | | | ✓ | ✓ |
| Manage users and departments | | | | | ✓ |

Access is enforced on the server, not just hidden in the UI. Requesters cannot see vendor quotes. Managers see only their department. A request outside a user's reach returns 404, so its existence is not revealed.

## The workflow

```
Draft ─submit─▶ With manager ─approve─▶ (under $1,000) ──────────────────┐
  ▲                 │                                                    ▼
  │                 ├─revision─▶ Revision requested ─resubmit─▶ back     In procurement
  │                 └─reject──▶ Rejected (terminal)                      │  add quotes
  │                                                                      │  choose winner
  │          (≥ $1,000) ─▶ With finance ─approve─▶ ─────────────────────▶┘
  │                              ├─revision / reject (as above)           ▼
  └──────────────────────────────────────────────────────────────── Winner chosen ─issue PO─▶ PO issued
```

**Approval routing.** Each approval step is decided by the amount. Requests under $1,000 need manager approval only. Requests of $1,000 or more also need finance sign-off after the manager. The threshold is `APPROVAL_THRESHOLD_CENTS` in `backend/src/rules.js`.

**Decisions.** Approve, reject, or request a revision. Reject and revision require a written reason of at least 5 characters. A manager cannot decide on their own request. A manager can decide only within their own department.

**Quotes.** Procurement uploads one PDF per vendor. The minimum is 1 quote under $1,000, 2 for $1,000 and above, and 3 for $10,000 and above. Inactive vendors cannot be quoted. A winner cannot be chosen until the minimum is met, and each new winner replaces the previous one.

**Purchase orders.** A PO is issued only from the chosen winner. Numbers take the form `PO-2026-00001`, and each request can have only one PO.

## Audit trail and notifications

Every state change writes one row to `audit_logs`, with the user, request, action, IP address and UTC timestamp. Database triggers reject `UPDATE` and `DELETE` on that table, so the log is append-only even against direct database access. The per-request timeline is shown on each request, and the full log is at `/audit` for finance and admin.

Notifications are created in two places. Each one appears as a toast in the browser and in the bell menu, and each is also stored as a mock email. The mock emails are listed under "Sent email" on the audit page. To send real email, replace the `insertEmail` call in `backend/src/lib/notify.js` with an SMTP client such as nodemailer.

## API reference

All routes except sign-in require `Authorization: Bearer <token>`.

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/api/auth/login` | public | Sign in, returns JWT |
| GET | `/api/auth/me` | any | Current user |
| GET | `/api/requests` | scoped | List, filter with `?status=` |
| POST | `/api/requests` | requester, manager | Create draft with line items |
| GET | `/api/requests/:id` | scoped | Full detail, timeline, permissions |
| PUT | `/api/requests/:id` | owner | Edit while draft or revision requested |
| POST | `/api/requests/:id/submit` | owner | Send for manager approval |
| POST | `/api/requests/:id/decision` | stage approver | `{action: approve\|reject\|revise, comments}` |
| POST | `/api/requests/:id/attachments` | owner | Upload PDF, PNG or JPG |
| POST | `/api/requests/:id/quotations` | procurement | Upload vendor quote PDF |
| POST | `/api/requests/:id/quotations/:qid/select` | procurement | Choose winning quote |
| POST | `/api/requests/:id/purchase-order` | procurement | Issue PO |
| GET/POST/PATCH | `/api/vendors` | procurement, admin | Vendor directory |
| GET/POST/PATCH | `/api/users`, `/api/departments` | admin | User and department admin |
| GET | `/api/audit-logs` | finance, admin | Audit trail, filter by `request_id` |
| GET | `/api/email-outbox` | finance, admin | Mock email log |
| GET | `/api/notifications` | any | Own notifications and unread count |
| GET | `/api/files/attachments/:id`, `/api/files/quotations/:id` | scoped | Protected file download |

## Schema

The tables follow the brief, with a few additions needed by the workflow. Money is stored as integer cents to avoid floating-point error.

| Table | Notes |
|---|---|
| `users`, `departments` | `users.role` is one of requester, manager, procurement, finance, admin |
| `purchase_requests` | `status` is constrained to the pipeline states |
| `request_items` | `estimated_unit_price_cents` |
| `request_attachments` | Files on the request itself |
| `vendors` | `is_active` flag |
| `quotations` | Unique per (request, vendor); `is_selected` marks the winner |
| `approval_logs` | Stage, action, comments, timestamp |
| `purchase_orders` | Added. One per request; `po_number` is unique |
| `audit_logs` | Append-only; `request_id` added for the per-request timeline |
| `notifications`, `email_outbox` | Added for in-app alerts and mock email |

## Security

Passwords are hashed with bcrypt at cost 12. Sign-in tokens last eight hours, and the role is re-read from the database on every request, so a demotion or deactivation takes effect immediately. Uploads are checked by content signature, not just the declared MIME type, and each file is stored under a random UUID. Client filenames are never used on disk. File downloads check access to the owning request. Validation uses zod on every write.

## Before production

- Set `JWT_SECRET` to a long random value. The server refuses to start in production without it.
- Put the app behind HTTPS and set the token to an `httpOnly` cookie if you want stronger protection against XSS. The MVP keeps the token in `localStorage` for simplicity.
- Add login rate limiting (for example `express-rate-limit`) and a password reset flow.
- Replace the local `uploads/` directory with S3 or similar, and run regular backups of `data/procurement.db`.
- Swap the mock email for SMTP and add a retry queue.
- Add pagination to the request list (currently capped at 200 rows).
- Enforce department budgets. The `budget_limit_cents` column exists, but the MVP does not block over-budget requests yet.
- Consider PostgreSQL if you need several API instances. The schema is portable, but the code uses `better-sqlite3` directly.

## Project layout

```
backend/
  src/
    config.js          environment and paths
    db.js              SQLite connection and schema
    rules.js           thresholds, status machine, permission rules (pure, tested)
    seed.js            demo data
    app.js, server.js  Express setup
    middleware/        JWT auth, role checks, safe uploads
    lib/               errors, audit, notifications, shared request queries
    routes/            auth, requests, procurement, users, inbox, files
  tests/               rules unit tests and end-to-end workflow test
frontend/
  src/
    App.jsx            routes and role gates
    api.js, auth.jsx   API client and session
    components/Shell.jsx   top bar, notifications, polling
    pages/             request list, form, detail, vendors, audit, admin
    ui.jsx, format.js  shared components and formatting
    styles.css         the ledger design system
```

## Design notes

The interface is meant to read like a purchasing ledger, not a generic dashboard. Hairline rules replace cards, and there is one accent colour, a deep harbour blue, used for actions. Status colours are kept for status only. Document numbers are set in a monospace face, as they are on printed forms. The approval route is drawn as a line with ticks, showing where a request has been and where it is now. The chosen winner in the quote comparison is marked with a stamp.
