import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { upload, assertFileSignature, ATTACHMENT_TYPES } from '../middleware/upload.js';
import { asyncHandler, HttpError, conflict } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { notify, usersByRole, usersByIds } from '../lib/notify.js';
import * as rules from '../rules.js';
import {
  parseId,
  findRequest,
  requireVisible,
  assertOwnerEditable,
  buildDetail,
} from '../lib/requests.js';

const router = Router();
router.use(authenticate);

const { STATUS } = rules;
const todayIso = () => new Date().toISOString().slice(0, 10);

const itemSchema = z.object({
  item_name: z.string().trim().min(2, 'Item name is required').max(120),
  description: z.string().trim().max(500).optional().default(''),
  quantity: z.number().int().positive().max(100000),
  estimated_unit_price: z.number().nonnegative().max(10_000_000),
});

const requestSchema = z.object({
  title: z.string().trim().min(3).max(150),
  target_delivery_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date')
    .refine((d) => d >= todayIso(), 'Target delivery date cannot be in the past'),
  justification: z.string().trim().min(10, 'Explain why this is needed (10+ characters)').max(2000),
  items: z.array(itemSchema).min(1, 'Add at least one line item').max(100),
});

const decisionSchema = z
  .object({
    action: z.enum(['approve', 'reject', 'revise']),
    comments: z.string().trim().max(1000).optional().default(''),
  })
  .superRefine((val, ctx) => {
    if (val.action !== 'approve' && val.comments.length < 5) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['comments'],
        message: 'Give a reason of at least 5 characters',
      });
    }
  });

const insertItem = db.prepare(
  `INSERT INTO request_items (request_id, item_name, description, quantity, estimated_unit_price_cents)
   VALUES (?, ?, ?, ?, ?)`
);

/** Replaces all line items and recomputes the estimated total in one place. */
function replaceItems(requestId, items) {
  db.prepare('DELETE FROM request_items WHERE request_id = ?').run(requestId);
  for (const it of items) {
    insertItem.run(
      requestId,
      it.item_name,
      it.description ?? '',
      it.quantity,
      rules.centsFromDollars(it.estimated_unit_price)
    );
  }
  db.prepare(
    `UPDATE purchase_requests
     SET total_estimated_cents = (SELECT COALESCE(SUM(quantity * estimated_unit_price_cents), 0)
                                  FROM request_items WHERE request_id = ?)
     WHERE id = ?`
  ).run(requestId, requestId);
}

function resolveDecision(action, stage, totalCents) {
  if (action === 'approve') {
    return {
      nextStatus: rules.statusAfterApproval(stage, totalCents),
      recorded: 'APPROVED',
      verb: `approved at ${stage} stage`,
    };
  }
  if (action === 'reject') {
    return { nextStatus: STATUS.REJECTED, recorded: 'REJECTED', verb: `rejected at ${stage} stage` };
  }
  return {
    nextStatus: STATUS.REVISION_REQUESTED,
    recorded: 'REVISION_REQUESTED',
    verb: `requested revisions at ${stage} stage`,
  };
}

/** Routes notifications for each decision outcome to the right people. */
function notifyDecision({ request: r, action, nextStatus, comments, actor }) {
  const label = rules.formatPrNumber(r.id);
  const requester = usersByIds([r.requester_id]);
  const money = rules.formatMoney(r.total_estimated_cents);

  if (action === 'reject') {
    return notify({
      recipients: requester,
      requestId: r.id,
      title: `Rejected: ${label}`,
      message: `${actor.name} rejected "${r.title}" (${money}). Reason: ${comments}`,
    });
  }
  if (action === 'revise') {
    return notify({
      recipients: requester,
      requestId: r.id,
      title: `Revision requested: ${label}`,
      message: `${actor.name} asked for changes to "${r.title}": ${comments}`,
    });
  }
  if (nextStatus === STATUS.PENDING_FINANCE) {
    notify({
      recipients: usersByRole('finance'),
      requestId: r.id,
      title: `Finance approval needed: ${label}`,
      message: `"${r.title}" (${money}) cleared manager approval and needs your sign-off.`,
    });
    return notify({
      recipients: requester,
      requestId: r.id,
      title: `Manager approved: ${label}`,
      message: `Your request "${r.title}" is now with finance.`,
    });
  }
  if (nextStatus === STATUS.IN_PROCUREMENT) {
    notify({
      recipients: usersByRole('procurement'),
      requestId: r.id,
      title: `Ready for sourcing: ${label}`,
      message: `"${r.title}" (${money}) is fully approved. Add vendor quotes to continue.`,
    });
    return notify({
      recipients: requester,
      requestId: r.id,
      title: `Fully approved: ${label}`,
      message: `Your request "${r.title}" is approved and moving to procurement.`,
    });
  }
}

// ---- Listing and reading ---------------------------------------------------

router.get(
  '/',
  asyncHandler((req, res) => {
    const u = req.user;
    const where = [];
    const params = [];
    if (u.role === 'requester') {
      where.push('pr.requester_id = ?');
      params.push(u.id);
    } else if (u.role === 'manager') {
      where.push('(pr.department_id = ? OR pr.requester_id = ?)');
      params.push(u.department_id, u.id);
    }
    if (req.query.status) {
      where.push('pr.status = ?');
      params.push(String(req.query.status));
    }
    const sql = `
      SELECT pr.id, pr.title, pr.status, pr.total_estimated_cents, pr.target_delivery_date,
             pr.created_at, pr.updated_at, u.name AS requester_name, d.name AS department_name
      FROM purchase_requests pr
      JOIN users u ON u.id = pr.requester_id
      JOIN departments d ON d.id = pr.department_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY pr.created_at DESC LIMIT 200`;
    res.json({ requests: db.prepare(sql).all(...params) });
  })
);

router.get(
  '/:id',
  asyncHandler((req, res) => {
    res.json(buildDetail(parseId(req.params.id), req.user));
  })
);

// ---- Create, edit, submit --------------------------------------------------

router.post(
  '/',
  requireRole('requester', 'manager'),
  asyncHandler((req, res) => {
    const body = requestSchema.parse(req.body);
    if (!req.user.department_id) {
      throw new HttpError(422, 'Your account has no department yet. Ask an admin to assign one.');
    }
    const now = new Date().toISOString();
    const id = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO purchase_requests
             (title, requester_id, department_id, justification, target_delivery_date,
              total_estimated_cents, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`
        )
        .run(body.title, req.user.id, req.user.department_id, body.justification,
          body.target_delivery_date, STATUS.DRAFT, now, now);
      const newId = Number(info.lastInsertRowid);
      replaceItems(newId, body.items);
      audit({
        userId: req.user.id,
        requestId: newId,
        description: `created ${rules.formatPrNumber(newId)} "${body.title}" as a draft`,
        ip: req.ip,
      });
      return newId;
    })();
    res.status(201).json(buildDetail(id, req.user));
  })
);

router.put(
  '/:id',
  asyncHandler((req, res) => {
    const id = parseId(req.params.id);
    const r = findRequest(id);
    requireVisible(req.user, r);
    assertOwnerEditable(req.user, r);
    const body = requestSchema.parse(req.body);
    const now = new Date().toISOString();
    db.transaction(() => {
      const upd = db
        .prepare(
          `UPDATE purchase_requests
           SET title = ?, justification = ?, target_delivery_date = ?, updated_at = ?
           WHERE id = ? AND status = ?`
        )
        .run(body.title, body.justification, body.target_delivery_date, now, id, r.status);
      if (upd.changes === 0) throw conflict();
      replaceItems(id, body.items);
      audit({ userId: req.user.id, requestId: id, description: `edited ${rules.formatPrNumber(id)}`, ip: req.ip });
    })();
    res.json(buildDetail(id, req.user));
  })
);

router.post(
  '/:id/submit',
  asyncHandler((req, res) => {
    const id = parseId(req.params.id);
    const r = findRequest(id);
    requireVisible(req.user, r);
    assertOwnerEditable(req.user, r);

    const itemCount = db.prepare('SELECT COUNT(*) AS n FROM request_items WHERE request_id = ?').get(id).n;
    if (itemCount === 0) throw new HttpError(422, 'Add at least one line item before submitting.');

    const managers = usersByRole('manager', r.department_id).filter((m) => m.id !== r.requester_id);
    if (managers.length === 0) {
      throw new HttpError(409, 'No other manager is assigned to this department. Ask an admin to add one.');
    }

    const label = rules.formatPrNumber(id);
    const now = new Date().toISOString();
    db.transaction(() => {
      const upd = db
        .prepare('UPDATE purchase_requests SET status = ?, updated_at = ? WHERE id = ? AND status = ?')
        .run(STATUS.PENDING_MANAGER, now, id, r.status);
      if (upd.changes === 0) throw conflict();
      audit({ userId: req.user.id, requestId: id, description: `submitted ${label} for manager approval`, ip: req.ip });
      notify({
        recipients: managers,
        requestId: id,
        title: `Approval needed: ${label}`,
        message: `${r.requester_name} submitted "${r.title}" (${rules.formatMoney(r.total_estimated_cents)}) for approval.`,
      });
    })();
    res.json(buildDetail(id, req.user));
  })
);

// ---- Approval engine -------------------------------------------------------

router.post(
  '/:id/decision',
  asyncHandler((req, res) => {
    const id = parseId(req.params.id);
    const r = findRequest(id);
    requireVisible(req.user, r);
    const body = decisionSchema.parse(req.body);

    const stage = rules.stageForStatus(r.status);
    if (!stage) throw new HttpError(409, 'This request is not waiting for an approval decision.');
    if (!rules.canDecide(req.user, r, stage)) {
      throw new HttpError(
        403,
        stage === 'manager'
          ? 'Only a manager in this department (not the requester) can decide at this step.'
          : 'Only a finance approver can decide at this step.'
      );
    }

    const { nextStatus, recorded, verb } = resolveDecision(body.action, stage, r.total_estimated_cents);
    const now = new Date().toISOString();
    const label = rules.formatPrNumber(id);

    db.transaction(() => {
      const upd = db
        .prepare('UPDATE purchase_requests SET status = ?, updated_at = ? WHERE id = ? AND status = ?')
        .run(nextStatus, now, id, r.status);
      if (upd.changes === 0) throw conflict();
      db.prepare(
        `INSERT INTO approval_logs (request_id, approver_id, stage, action, comments, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(id, req.user.id, stage, recorded, body.comments || null, now);
      audit({
        userId: req.user.id,
        requestId: id,
        description: `${verb} ${label}${body.comments ? ` — "${body.comments}"` : ''}`,
        ip: req.ip,
      });
      notifyDecision({ request: r, action: body.action, nextStatus, comments: body.comments, actor: req.user });
    })();
    res.json(buildDetail(id, req.user));
  })
);

// ---- Attachments -----------------------------------------------------------

/** Runs before multer so unauthorised uploads never reach disk. */
function ownerEditableGuard(req, _res, next) {
  try {
    const r = findRequest(parseId(req.params.id));
    requireVisible(req.user, r);
    assertOwnerEditable(req.user, r);
    next();
  } catch (err) {
    next(err);
  }
}

router.post(
  '/:id/attachments',
  ownerEditableGuard,
  upload.single('file'),
  asyncHandler((req, res) => {
    const id = parseId(req.params.id);
    if (!req.file) throw new HttpError(400, 'Choose a file to upload.');
    assertFileSignature(req.file, ATTACHMENT_TYPES);
    const now = new Date().toISOString();
    const info = db
      .prepare(
        `INSERT INTO request_attachments (request_id, original_name, file_path, uploaded_by, uploaded_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, req.file.originalname, req.file.filename, req.user.id, now);
    audit({
      userId: req.user.id,
      requestId: id,
      description: `attached "${req.file.originalname}" to ${rules.formatPrNumber(id)}`,
      ip: req.ip,
    });
    res.status(201).json({ id: Number(info.lastInsertRowid), original_name: req.file.originalname });
  })
);

export default router;
