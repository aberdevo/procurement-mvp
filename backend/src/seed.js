import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { config } from './config.js';

/** Creates departments, demo users, and vendors. Does nothing if users already exist. */
export function seed({ log = console.log } = {}) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (n > 0) {
    log('Database already has users. Skipping seed.');
    return false;
  }

  const now = new Date().toISOString();
  const hash = bcrypt.hashSync(config.seedPassword, 12);

  db.transaction(() => {
    const dept = db.prepare('INSERT INTO departments (name, budget_limit_cents) VALUES (?, ?)');
    const eng = Number(dept.run('Engineering', 25_000_000).lastInsertRowid);
    const ops = Number(dept.run('Operations', 12_000_000).lastInsertRowid);

    const user = db.prepare(
      `INSERT INTO users (name, email, role, department_id, password_hash, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`
    );
    user.run('Ada Admin', 'admin@corp.test', 'admin', null, hash, now);
    user.run('Fin Olu', 'finance@corp.test', 'finance', null, hash, now);
    user.run('Priya Procurement', 'procurement@corp.test', 'procurement', null, hash, now);
    user.run('Marcus Chen', 'marcus@corp.test', 'manager', eng, hash, now);
    user.run('Dev Rao', 'dev@corp.test', 'requester', eng, hash, now);
    user.run('Lena Park', 'lena@corp.test', 'manager', ops, hash, now);
    user.run('Sam Ortiz', 'sam@corp.test', 'requester', ops, hash, now);

    const vendor = db.prepare(
      `INSERT INTO vendors (name, email, phone, company_address, category, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    vendor.run('Northwind Office Supply', 'sales@northwind.test', '+1 555 0100', '12 Harbor Rd, Portland', 'Office supplies', 1, now);
    vendor.run('Lumen Tech Ltd', 'quotes@lumentech.test', '+1 555 0142', '88 Circuit Way, Austin', 'Hardware', 1, now);
    vendor.run('Halden Industrial', 'orders@halden.test', '+1 555 0199', '4 Foundry Ln, Akron', 'Industrial', 1, now);
    vendor.run('Old Supplier Co', 'info@oldsupplier.test', null, null, 'Office supplies', 0, now);
  })();

  log('Seeded demo data. Sign in with any account below; password is the SEED_PASSWORD value:');
  for (const u of ['admin', 'finance', 'procurement', 'marcus', 'dev', 'lena', 'sam']) {
    log(`  ${u}@corp.test`);
  }
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seed();
}
