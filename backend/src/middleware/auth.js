import jwt from 'jsonwebtoken';
import { db } from '../db.js';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';

const USER_SQL = `
  SELECT u.id, u.name, u.email, u.role, u.department_id, u.is_active, d.name AS department_name
  FROM users u LEFT JOIN departments d ON d.id = u.department_id
  WHERE u.id = ?`;

export const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  department_id: u.department_id,
  department_name: u.department_name ?? null,
});

export const signToken = (user) =>
  jwt.sign({ sub: user.id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });

export function loadUser(id) {
  return db.prepare(USER_SQL).get(id);
}

export function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Sign in to continue.'));

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return next(new HttpError(401, 'Your session has expired. Sign in again.'));
  }

  const user = loadUser(payload.sub);
  if (!user || !user.is_active) return next(new HttpError(401, 'This account is inactive.'));
  req.user = user; // role is read fresh from the DB on every request
  next();
}

export function requireRole(...roles) {
  return (req, _res, next) =>
    roles.includes(req.user.role) ? next() : next(new HttpError(403, 'Your role cannot do this.'));
}
