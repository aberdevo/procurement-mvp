import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '../db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { ROLES } from '../rules.js';

const router = Router();
const adminOnly = [authenticate, requireRole('admin')];

const departmentSchema = z.object({
  name: z.string().trim().min(2).max(80),
  budget_limit: z.coerce.number().nonnegative().max(1_000_000_000),
});

const userSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(8, 'Password must be at least 8 characters').max(200),
    role: z.enum(ROLES),
    department_id: z.number().int().positive().nullable().optional(),
  })
  .refine((u) => !['requester', 'manager'].includes(u.role) || u.department_id, {
    message: 'Requesters and managers need a department',
    path: ['department_id'],
  });

const userPatchSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  role: z.enum(ROLES).optional(),
  department_id: z.number().int().positive().nullable().optional(),
  is_active: z.boolean().optional(),
});

router.get(
  '/departments',
  ...adminOnly,
  asyncHandler((_req, res) => {
    res.json({ departments: db.prepare('SELECT id, name, budget_limit_cents FROM departments ORDER BY name').all() });
  })
);

router.post(
  '/departments',
  ...adminOnly,
  asyncHandler((req, res) => {
    const body = departmentSchema.parse(req.body);
    const info = db
      .prepare('INSERT INTO departments (name, budget_limit_cents) VALUES (?, ?)')
      .run(body.name, Math.round(body.budget_limit * 100));
    audit({ userId: req.user.id, description: `created department "${body.name}"`, ip: req.ip });
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  })
);

router.get(
  '/users',
  ...adminOnly,
  asyncHandler((_req, res) => {
    res.json({
      users: db
        .prepare(
          `SELECT u.id, u.name, u.email, u.role, u.department_id, u.is_active, d.name AS department_name
           FROM users u LEFT JOIN departments d ON d.id = u.department_id ORDER BY u.name`
        )
        .all(),
    });
  })
);

router.post(
  '/users',
  ...adminOnly,
  asyncHandler(async (req, res) => {
    const body = userSchema.parse(req.body);
    const hash = await bcrypt.hash(body.password, 12);
    const now = new Date().toISOString();
    const info = db
      .prepare(
        `INSERT INTO users (name, email, role, department_id, password_hash, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, 1, ?)`
      )
      .run(body.name, body.email, body.role, body.department_id ?? null, hash, now);
    audit({ userId: req.user.id, description: `created user ${body.email} as ${body.role}`, ip: req.ip });
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  })
);

router.patch(
  '/users/:id',
  ...adminOnly,
  asyncHandler((req, res) => {
    const id = Number(req.params.id);
    const current = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!current) throw new HttpError(404, 'User not found.');
    const body = userPatchSchema.parse(req.body);
    if (id === req.user.id && body.is_active === false) {
      throw new HttpError(409, 'You cannot deactivate your own account.');
    }
    const next = { ...current, ...body };
    if (['requester', 'manager'].includes(next.role) && !next.department_id) {
      throw new HttpError(422, 'Requesters and managers need a department.');
    }
    db.prepare(
      'UPDATE users SET name = ?, role = ?, department_id = ?, is_active = ? WHERE id = ?'
    ).run(next.name, next.role, next.department_id ?? null, next.is_active ? 1 : 0, id);
    audit({
      userId: req.user.id,
      description: `updated user ${current.email} (role ${next.role}, active ${Boolean(next.is_active)})`,
      ip: req.ip,
    });
    res.json({ ok: true });
  })
);

export default router;
