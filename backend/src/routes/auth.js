import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '../db.js';
import { authenticate, publicUser, signToken, loadUser } from '../middleware/auth.js';
import { HttpError, asyncHandler } from '../lib/errors.js';
import { audit } from '../lib/audit.js';

const router = Router();

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const row = db.prepare('SELECT id, password_hash, is_active FROM users WHERE email = ?').get(email);
    const valid = row && row.is_active && (await bcrypt.compare(password, row.password_hash));
    if (!valid) {
      audit({ description: `failed sign-in attempt for ${email}`, ip: req.ip });
      throw new HttpError(401, 'Email or password is incorrect.');
    }
    const user = loadUser(row.id);
    audit({ userId: user.id, description: 'signed in', ip: req.ip });
    res.json({ token: signToken(user), user: publicUser(user) });
  })
);

router.get('/me', authenticate, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

export default router;
