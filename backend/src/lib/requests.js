// Shared request queries and the detail view used by several routers.
import { db } from '../db.js';
import * as rules from '../rules.js';
import { HttpError, conflict } from './errors.js';

export function parseId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(404, 'Purchase request not found.');
  return id;
}

export function findRequest(id) {
  const row = db
    .prepare(
      `SELECT pr.*, u.name AS requester_name, u.email AS requester_email, d.name AS department_name
       FROM purchase_requests pr
       JOIN users u ON u.id = pr.requester_id
       JOIN departments d ON d.id = pr.department_id
       WHERE pr.id = ?`
    )
    .get(id);
  if (!row) throw new HttpError(404, 'Purchase request not found.');
  return row;
}

/** Hides requests a user may not see behind a 404 so existence is not leaked. */
export function requireVisible(user, request) {
  if (!rules.canViewRequest(user, request)) throw new HttpError(404, 'Purchase request not found.');
}

export function assertOwnerEditable(user, request) {
  if (request.requester_id !== user.id) {
    throw new HttpError(403, 'Only the requester can change this request.');
  }
  if (!rules.EDITABLE_STATUSES.includes(request.status)) {
    throw new HttpError(409, 'This request is locked while it is being reviewed.');
  }
}

export function countQuotes(requestId) {
  return db.prepare('SELECT COUNT(*) AS n FROM quotations WHERE request_id = ?').get(requestId).n;
}

export function assertStatus(request, expected, message) {
  if (request.status !== expected) throw conflict(message);
}

/** Full detail payload for one request, tailored to the viewer's role. */
export function buildDetail(id, user) {
  const r = findRequest(id);
  requireVisible(user, r);

  const stage = rules.stageForStatus(r.status);
  const isOwner = r.requester_id === user.id;
  const canSeeQuotes = user.role !== 'requester';
  const requiredQuotes = rules.requiredQuoteCount(r.total_estimated_cents);

  const items = db
    .prepare(
      'SELECT id, item_name, description, quantity, estimated_unit_price_cents FROM request_items WHERE request_id = ? ORDER BY id'
    )
    .all(id);
  const attachments = db
    .prepare('SELECT id, original_name, uploaded_at FROM request_attachments WHERE request_id = ? ORDER BY id')
    .all(id);
  const approvals = db
    .prepare(
      `SELECT al.id, al.stage, al.action, al.comments, al.timestamp, u.name AS approver_name
       FROM approval_logs al JOIN users u ON u.id = al.approver_id
       WHERE al.request_id = ? ORDER BY al.id`
    )
    .all(id);
  const quotations = canSeeQuotes
    ? db
        .prepare(
          `SELECT q.id, q.total_amount_cents, q.delivery_terms, q.is_selected, q.original_name,
                  q.uploaded_at, v.id AS vendor_id, v.name AS vendor_name
           FROM quotations q JOIN vendors v ON v.id = q.vendor_id
           WHERE q.request_id = ? ORDER BY q.total_amount_cents ASC`
        )
        .all(id)
    : [];
  const purchaseOrder =
    db
      .prepare(
        `SELECT po.id, po.po_number, po.total_amount_cents, po.issued_at, v.name AS vendor_name
         FROM purchase_orders po
         JOIN quotations q ON q.id = po.quotation_id
         JOIN vendors v ON v.id = q.vendor_id
         WHERE po.request_id = ?`
      )
      .get(id) ?? null;
  const auditTrail = db
    .prepare(
      `SELECT a.action_description, a.timestamp, u.name AS actor_name
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.request_id = ? ORDER BY a.id DESC LIMIT 200`
    )
    .all(id);

  const isProcurement = user.role === 'procurement';
  const inProcurement = r.status === rules.STATUS.IN_PROCUREMENT;
  const editable = isOwner && rules.EDITABLE_STATUSES.includes(r.status);

  return {
    ...r,
    label: rules.formatPrNumber(r.id),
    approval_stages: rules.requiredApprovalStages(r.total_estimated_cents),
    waiting_on_stage: stage,
    required_quotes: requiredQuotes,
    items,
    attachments,
    approvals,
    quotations,
    purchase_order: purchaseOrder,
    audit_trail: auditTrail,
    permissions: {
      edit: editable,
      submit: editable && items.length > 0,
      attach: editable,
      decide: stage !== null && rules.canDecide(user, r, stage),
      add_quote: isProcurement && inProcurement,
      select_quote: isProcurement && inProcurement && quotations.length >= requiredQuotes,
      issue_po: isProcurement && r.status === rules.STATUS.APPROVED,
    },
  };
}
