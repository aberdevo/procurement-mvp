import { db } from '../db.js';

const insert = db.prepare(
  'INSERT INTO audit_logs (user_id, request_id, action_description, ip_address, timestamp) VALUES (?, ?, ?, ?, ?)'
);

/** Append one immutable entry. Every state change in the system goes through here. */
export function audit({ userId = null, requestId = null, description, ip = null }) {
  insert.run(userId, requestId, description, ip, new Date().toISOString());
}
