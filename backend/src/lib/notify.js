import { db } from '../db.js';

const insertNotification = db.prepare(
  'INSERT INTO notifications (user_id, request_id, title, message, created_at) VALUES (?, ?, ?, ?, ?)'
);
const insertEmail = db.prepare(
  'INSERT INTO email_outbox (to_email, subject, body, request_id, created_at) VALUES (?, ?, ?, ?, ?)'
);

export function usersByRole(role, departmentId = null) {
  if (departmentId !== null) {
    return db
      .prepare('SELECT id, name, email FROM users WHERE role = ? AND department_id = ? AND is_active = 1')
      .all(role, departmentId);
  }
  return db.prepare('SELECT id, name, email FROM users WHERE role = ? AND is_active = 1').all(role);
}

export function usersByIds(ids) {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(', ');
  return db
    .prepare(`SELECT id, name, email FROM users WHERE id IN (${placeholders}) AND is_active = 1`)
    .all(...ids);
}

/**
 * Creates an in-app notification (drives toasts and the bell) and a mock email.
 * To send real email, replace the outbox insert with an SMTP call (e.g. nodemailer).
 */
export function notify({ recipients, requestId = null, title, message }) {
  const now = new Date().toISOString();
  const seen = new Set();
  for (const r of recipients) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    insertNotification.run(r.id, requestId, title, message, now);
    insertEmail.run(r.email, `[Procurement] ${title}`, `Hi ${r.name},\n\n${message}\n\n— Procurement system`, requestId, now);
  }
}
