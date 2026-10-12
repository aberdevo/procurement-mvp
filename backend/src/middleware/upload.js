import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';

fs.mkdirSync(config.uploadDir, { recursive: true });

export const ATTACHMENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
export const QUOTE_TYPES = ['application/pdf'];

const EXTENSIONS = { 'application/pdf': '.pdf', 'image/png': '.png', 'image/jpeg': '.jpg' };
// Magic bytes so a renamed file cannot pass as a PDF or image.
const SIGNATURES = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46],
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/jpeg': [0xff, 0xd8, 0xff],
};

export const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    // Server-generated names: client filenames are never used on disk.
    filename: (_req, file, cb) => cb(null, crypto.randomUUID() + (EXTENSIONS[file.mimetype] ?? '')),
  }),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!EXTENSIONS[file.mimetype]) {
      return cb(new HttpError(415, 'Only PDF, PNG or JPG files are accepted.'));
    }
    cb(null, true);
  },
});

/** Confirms the file content matches its claimed type; deletes it if not. */
export function assertFileSignature(file, allowedTypes) {
  const signature = SIGNATURES[file.mimetype];
  let valid = allowedTypes.includes(file.mimetype) && Boolean(signature);
  if (valid) {
    const head = Buffer.alloc(signature.length);
    const fd = fs.openSync(file.path, 'r');
    fs.readSync(fd, head, 0, signature.length, 0);
    fs.closeSync(fd);
    valid = signature.every((byte, i) => head[i] === byte);
  }
  if (!valid) {
    fs.rmSync(file.path, { force: true });
    const label = allowedTypes.length === 1 ? 'PDF' : 'PDF, PNG or JPG';
    throw new HttpError(415, `That file is not a valid ${label}.`);
  }
}
