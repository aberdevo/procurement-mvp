import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { ZodError } from 'zod';
import { config } from './config.js';
import { HttpError } from './lib/errors.js';
import authRoutes from './routes/auth.js';
import requestRoutes from './routes/requests.js';
import procurementRoutes from './routes/procurement.js';
import userRoutes from './routes/users.js';
import inboxRoutes from './routes/inbox.js';
import fileRoutes from './routes/files.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '200kb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes);
  app.use('/api/requests', requestRoutes);
  app.use('/api/files', fileRoutes);
  app.use('/api', procurementRoutes);
  app.use('/api', userRoutes);
  app.use('/api', inboxRoutes);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

  // Serve the built frontend in production.
  const dist = config.frontendDist;
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}

function errorHandler(err, _req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: err.issues[0]?.message ?? 'Some fields are invalid.',
      details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 10 MB).' : 'Upload failed.';
    return res.status(400).json({ error: message });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'The request body is not valid JSON.' });
  }
  if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return res.status(409).json({ error: 'That record already exists.' });
  }
  console.error(err);
  return res.status(500).json({ error: 'Something went wrong on our side. Try again.' });
}
