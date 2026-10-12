import { Router } from 'express';
import { db } from '../db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../lib/errors.js';

const router = Router();

// ---- Notifications (toasts and bell) ---------------------------------------

router.get(
  '/notifications',
  authenticate,
  asyncHandler((req, res) => {
    const rows = db
      .prepare(
        `SELECT id, request_id, title, message, read_at, created_at
         FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50`
      )
      .all(req.user.id);
    const { unread } = db
      .prepare('SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND read_at IS NULL')
      .get(req.user.id);
    res.json({ notifications: rows, unread });
  })
);

router.post(
  '/notifications/read-all',
  authenticate,
  asyncHandler((req, res) => {
    db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(
      new Date().toISOString(),
      req.user.id
    );
    res.json({ ok: true });
  })
);

router.post(
  '/notifications/:id/read',
  authenticate,
  asyncHandler((req, res) => {
    db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL').run(
      new Date().toISOString(),
      Number(req.params.id),
      req.user.id
    );
    res.json({ ok: true });
  })
);

// ---- Audit trail and mock email (finance and admin) ------------------------

router.get(
  '/audit-logs',
  authenticate,
  requireRole('finance', 'admin'),
  asyncHandler((req, res) => {
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const requestId = req.query.request_id ? Number(req.query.request_id) : null;
    if (req.query.request_id && !Number.isInteger(requestId)) throw new HttpError(400, 'request_id must be a number.');
    const rows = db
      .prepare(
        `SELECT a.id, a.action_description, a.ip_address, a.timestamp, a.request_id,
                u.name AS actor_name, u.role AS actor_role
         FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
         ${requestId ? 'WHERE a.request_id = ?' : ''}
         ORDER BY a.id DESC LIMIT ?`
      )
      .all(...(requestId ? [requestId, limit] : [limit]));
    res.json({ logs: rows });
  })
);

router.get(
  '/email-outbox',
  authenticate,
  requireRole('finance', 'admin'),
  asyncHandler((_req, res) => {
    res.json({
      emails: db
        .prepare(
          'SELECT id, to_email, subject, body, request_id, created_at FROM email_outbox ORDER BY id DESC LIMIT 100'
        )
        .all(),
    });
  })
);

export default router;
