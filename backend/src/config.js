import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

export const config = {
  port: Number(process.env.PORT) || 4000,
  env: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-change-me',
  jwtExpiresIn: '8h',
  dbPath: process.env.DB_PATH || path.join(root, 'data', 'procurement.db'),
  uploadDir: process.env.UPLOAD_DIR || path.join(root, 'uploads'),
  maxUploadBytes: 10 * 1024 * 1024,
  seedPassword: process.env.SEED_PASSWORD || 'ChangeMe123!',
  // Built React app, served by Express when it exists
  frontendDist: path.resolve(root, '..', 'frontend', 'dist'),
};

// Refuse to run in production with the development signing key.
if (config.env === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set when NODE_ENV=production.');
}
