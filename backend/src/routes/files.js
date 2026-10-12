import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { config } from '../config.js';
import { asyncHandler, HttpError } from '../lib/errors.js';
import { findRequest, requireVisible } from '../lib/requests.js';

const router = Router();
router.use(authenticate);

function sendStoredFile(res, storedName, downloadName) {
  // basename() blocks path traversal; stored names are server-generated UUIDs.
  const absolute = path.join(config.uploadDir, path.basename(storedName));
  if (!fs.existsSync(absolute)) throw new HttpError(404, 'The file is missing from storage.');
  res.download(absolute, downloadName);
}

router.get(
  '/attachments/:id',
  asyncHandler((req, res) => {
    const row = db
      .prepare('SELECT request_id, file_path, original_name FROM request_attachments WHERE id = ?')
      .get(Number(req.params.id));
    if (!row) throw new HttpError(404, 'File not found.');
    requireVisible(req.user, findRequest(row.request_id));
    sendStoredFile(res, row.file_path, row.original_name);
  })
);

router.get(
  '/quotations/:id',
  asyncHandler((req, res) => {
    if (req.user.role === 'requester') throw new HttpError(403, 'Quotes are not shared with requesters.');
    const row = db
      .prepare('SELECT request_id, quote_file_path, original_name FROM quotations WHERE id = ?')
      .get(Number(req.params.id));
    if (!row) throw new HttpError(404, 'File not found.');
    requireVisible(req.user, findRequest(row.request_id));
    sendStoredFile(res, row.quote_file_path, row.original_name);
  })
);

export default router;
