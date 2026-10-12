import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  budget_limit_cents INTEGER NOT NULL DEFAULT 0 CHECK (budget_limit_cents >= 0)
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role IN ('requester','manager','procurement','finance','admin')),
  department_id INTEGER REFERENCES departments(id),
  password_hash TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  requester_id INTEGER NOT NULL REFERENCES users(id),
  department_id INTEGER NOT NULL REFERENCES departments(id),
  justification TEXT NOT NULL,
  target_delivery_date TEXT NOT NULL,
  total_estimated_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN (
    'draft','pending_manager','pending_finance','revision_requested',
    'in_procurement','approved','po_issued','rejected')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pr_status ON purchase_requests(status);
CREATE INDEX IF NOT EXISTS idx_pr_requester ON purchase_requests(requester_id);
CREATE INDEX IF NOT EXISTS idx_pr_department ON purchase_requests(department_id);

CREATE TABLE IF NOT EXISTS request_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  estimated_unit_price_cents INTEGER NOT NULL CHECK (estimated_unit_price_cents >= 0)
);

CREATE TABLE IF NOT EXISTS request_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  uploaded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT,
  phone TEXT,
  company_address TEXT,
  category TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id),
  total_amount_cents INTEGER NOT NULL CHECK (total_amount_cents > 0),
  delivery_terms TEXT NOT NULL,
  original_name TEXT NOT NULL,
  quote_file_path TEXT NOT NULL,
  is_selected INTEGER NOT NULL DEFAULT 0,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  uploaded_at TEXT NOT NULL,
  UNIQUE (request_id, vendor_id)
);

CREATE TABLE IF NOT EXISTS approval_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  approver_id INTEGER NOT NULL REFERENCES users(id),
  stage TEXT NOT NULL CHECK (stage IN ('manager','finance')),
  action TEXT NOT NULL CHECK (action IN ('APPROVED','REJECTED','REVISION_REQUESTED')),
  comments TEXT,
  timestamp TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL UNIQUE REFERENCES purchase_requests(id),
  quotation_id INTEGER NOT NULL REFERENCES quotations(id),
  po_number TEXT NOT NULL UNIQUE,
  total_amount_cents INTEGER NOT NULL,
  issued_by INTEGER NOT NULL REFERENCES users(id),
  issued_at TEXT NOT NULL
);

-- Append-only audit trail. Triggers block edits and deletes at the database level.
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  request_id INTEGER REFERENCES purchase_requests(id),
  action_description TEXT NOT NULL,
  ip_address TEXT,
  timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_request ON audit_logs(request_id);
CREATE TRIGGER IF NOT EXISTS audit_logs_no_update BEFORE UPDATE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_logs_no_delete BEFORE DELETE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  request_id INTEGER REFERENCES purchase_requests(id),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read_at);

-- Mock email: every outgoing message is stored here instead of being sent.
CREATE TABLE IF NOT EXISTS email_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  request_id INTEGER,
  created_at TEXT NOT NULL
);
`;

db.exec(SCHEMA);
