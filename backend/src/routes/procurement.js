import { Router } from 'express';
import fs from 'node:fs';
import { z } from 'zod';
import { db } from '../db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { upload, assertFileSignature, QUOTE_TYPES } from '../middleware/upload.js';
import { asyncHandler, HttpError, conflict } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { notify, usersByIds, usersByRole } from '../lib/notify.js';
import * as rules from '../rules.js';
import { parseId, findRequest, buildDetail, countQuotes, assertStatus } from '../lib/requests.js';

const router = Router();
const { STATUS } = rules;
const PROCUREMENT_VIEW = ['procurement', 'finance', 'admin'];

const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal(''))
    .transform((v) => v || null);

const vendorSchema = z.object({
  name: z.string().trim().min(2, 'Vendor name is required').max(120),
  email: z.string().trim().email().optional().or(z.literal('')).transform((v) => v || null),
  phone: optionalText(40),
  company_address: optionalText(300),
  category: z.string().trim().min(2, 'Choose a category').max(60),
  is_active: z.boolean().optional().default(true),
});

const quoteSchema = z.object({
  vendor_id: z.coerce.number().int().positive('Choose a vendor'),
  total_amount: z.coerce.number().positive('Enter the quoted total').max(10_000_000),
  delivery_terms: z.string().trim().min(3, 'Describe the delivery terms').max(300),
});

// ---- Vendors ---------------------------------------------------------------

router.get(
  '/vendors',
  authenticate,
  requireRole(...PROCUREMENT_VIEW),
  asyncHandler((_req, res) => {
    res.json({
      vendors: db
        .prepare('SELECT id, name, email, phone, company_address, category, is_active FROM vendors ORDER BY name')
        .all(),
    });
  })
);

router.post(
  '/vendors',
  authenticate,
  requireRole('procurement', 'admin'),
  asyncHandler((req, res) => {
    const body = vendorSchema.parse(req.body);
    const now = new Date().toISOString();
    const info = db
      .prepare(
        `INSERT INTO vendors (name, email, phone, company_address, category, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(body.name, body.email, body.phone, body.company_address, body.category, body.is_active ? 1 : 0, now);
    audit({ userId: req.user.id, description: `added vendor "${body.name}"`, ip: req.ip });
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  })
);

router.patch(
  '/vendors/:id',
  authenticate,
  requireRole('procurement', 'admin'),
  asyncHandler((req, res) => {
    const id = parseId(req.params.id);
    const existing = db.prepare('SELECT id, name FROM vendors WHERE id = ?').get(id);
    if (!existing) throw new HttpError(404, 'Vendor not found.');
    const body = vendorSchema.partial().parse(req.body);
    const entries = Object.entries(body).filter(([, v]) => v !== undefined);
    if (entries.length === 0) throw new HttpError(422, 'Nothing to update.');
    // Column names come from the zod schema keys only, never from user input.
    const sets = entries.map(([k]) => `${k} = ?`).join(', ');
    const values = entries.map(([, v]) => (typeof v === 'boolean' ? Number(v) : v));
    db.prepare(`UPDATE vendors SET ${sets} WHERE id = ?`).run(...values, id);
    audit({
      userId: req.user.id,
      description: `updated vendor "${existing.name}" (${entries.map(([k]) => k).join(', ')})`,
      ip: req.ip,
    });
    res.json({ ok: true });
  })
);

// ---- Quotations ------------------------------------------------------------

router.post(
  '/requests/:id/quotations',
  authenticate,
  requireRole('procurement'),
  upload.single('file'),
  asyncHandler((req, res) => {
    try {
      const id = parseId(req.params.id);
      const r = findRequest(id);
      const body = quoteSchema.parse(req.body);
      assertStatus(r, STATUS.IN_PROCUREMENT, 'Quotes can only be added while the request is in procurement.');
      if (!req.file) throw new HttpError(400, 'Attach the vendor quote as a PDF.');
      assertFileSignature(req.file, QUOTE_TYPES);

      const vendor = db.prepare('SELECT id, name, is_active FROM vendors WHERE id = ?').get(body.vendor_id);
      if (!vendor || !vendor.is_active) throw new HttpError(422, 'Choose an active vendor.');
      const duplicate = db
        .prepare('SELECT id FROM quotations WHERE request_id = ? AND vendor_id = ?')
        .get(id, body.vendor_id);
      if (duplicate) throw new HttpError(409, `${vendor.name} already has a quote on this request.`);

      const now = new Date().toISOString();
      const cents = rules.centsFromDollars(body.total_amount);
      const info = db
        .prepare(
          `INSERT INTO quotations
             (request_id, vendor_id, total_amount_cents, delivery_terms, original_name,
              quote_file_path, is_selected, uploaded_by, uploaded_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
        )
        .run(id, vendor.id, cents, body.delivery_terms, req.file.originalname, req.file.filename, req.user.id, now);
      audit({
        userId: req.user.id,
        requestId: id,
        description: `uploaded ${vendor.name} quote of ${rules.formatMoney(cents)}`,
        ip: req.ip,
      });
      res.status(201).json({ id: Number(info.lastInsertRowid) });
    } catch (err) {
      // Never leave an orphaned file behind when validation fails.
      if (req.file) fs.rmSync(req.file.path, { force: true });
      throw err;
    }
  })
);

router.post(
  '/requests/:id/quotations/:qid/select',
  authenticate,
  requireRole('procurement'),
  asyncHandler((req, res) => {
    const id = parseId(req.params.id);
    const qid = parseId(req.params.qid);
    const r = findRequest(id);
    assertStatus(r, STATUS.IN_PROCUREMENT, 'A winning quote can only be chosen while the request is in procurement.');

    const quote = db
      .prepare('SELECT id, vendor_id FROM quotations WHERE id = ? AND request_id = ?')
      .get(qid, id);
    if (!quote) throw new HttpError(404, 'Quote not found on this request.');

    const count = countQuotes(id);
    const required = rules.requiredQuoteCount(r.total_estimated_cents);
    if (count < required) {
      throw new HttpError(409, `Add ${required} quotes before choosing a winner. ${count} added so far.`);
    }

    const label = rules.formatPrNumber(id);
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare(
        'UPDATE quotations SET is_selected = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE request_id = ?'
      ).run(qid, id);
      const upd = db
        .prepare('UPDATE purchase_requests SET status = ?, updated_at = ? WHERE id = ? AND status = ?')
        .run(STATUS.APPROVED, now, id, r.status);
      if (upd.changes === 0) throw conflict();
      audit({ userId: req.user.id, requestId: id, description: `selected the winning quote for ${label}`, ip: req.ip });
      notify({
        recipients: usersByIds([r.requester_id]),
        requestId: id,
        title: `Quote selected: ${label}`,
        message: `Procurement chose a winning quote for "${r.title}". A purchase order is next.`,
      });
    })();
    res.json(buildDetail(id, req.user));
  })
);

// ---- Purchase orders -------------------------------------------------------

router.post(
  '/requests/:id/purchase-order',
  authenticate,
  requireRole('procurement'),
  asyncHandler((req, res) => {
    const id = parseId(req.params.id);
    const r = findRequest(id);
    assertStatus(r, STATUS.APPROVED, 'Choose a winning quote before issuing a purchase order.');

    const winner = db
      .prepare('SELECT id, total_amount_cents FROM quotations WHERE request_id = ? AND is_selected = 1')
      .get(id);
    if (!winner) throw new HttpError(409, 'No winning quote is selected for this request.');

    const label = rules.formatPrNumber(id);
    const now = new Date().toISOString();
    const year = new Date().getUTCFullYear();
    let poNumber;
    db.transaction(() => {
      const next = db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM purchase_orders').get().n;
      poNumber = `PO-${year}-${String(next).padStart(5, '0')}`;
      db.prepare(
        `INSERT INTO purchase_orders (request_id, quotation_id, po_number, total_amount_cents, issued_by, issued_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(id, winner.id, poNumber, winner.total_amount_cents, req.user.id, now);
      const upd = db
        .prepare('UPDATE purchase_requests SET status = ?, updated_at = ? WHERE id = ? AND status = ?')
        .run(STATUS.PO_ISSUED, now, id, r.status);
      if (upd.changes === 0) throw conflict();
      audit({ userId: req.user.id, requestId: id, description: `issued ${poNumber} for ${label}`, ip: req.ip });
      const recipients = [...usersByIds([r.requester_id]), ...usersByRole('finance')];
      notify({
        recipients,
        requestId: id,
        title: `Purchase order issued: ${poNumber}`,
        message: `${poNumber} was issued for "${r.title}" (${rules.formatMoney(winner.total_amount_cents)}).`,
      });
    })();
    res.status(201).json(buildDetail(id, req.user));
  })
);

export default router;
