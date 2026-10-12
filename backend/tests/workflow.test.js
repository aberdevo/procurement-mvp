// End-to-end workflow test against a throwaway database.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'procure-test-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'test-secret';
process.env.SEED_PASSWORD = 'TestPass123!';

const { createApp } = await import('../src/app.js');
const { seed } = await import('../src/seed.js');
const { db } = await import('../src/db.js');

let server;
let base;
const tokens = {};
const PDF = Buffer.from('%PDF-1.4\n% test quote\n');

seed({ log: () => {} });

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
  for (const email of ['dev', 'marcus', 'lena', 'finance', 'procurement', 'admin']) {
    const res = await req('POST', '/auth/login', { email: `${email}@corp.test`, password: 'TestPass123!' });
    assert.equal(res.status, 200, `login failed for ${email}`);
    tokens[email] = res.body.token;
  }
});

after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function req(method, url, body, as) {
  const headers = {};
  if (as) headers.Authorization = `Bearer ${tokens[as]}`;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(base + url, { method, headers, body: payload });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

const pr = (unit, qty = 2) => ({
  title: 'Standing desks for the new team',
  target_delivery_date: '2099-01-15',
  justification: 'The current desks are unsafe and the team is growing.',
  items: [{ item_name: 'Standing desk', description: 'Electric', quantity: qty, estimated_unit_price: unit }],
});

function quoteForm(vendorId, total) {
  const f = new FormData();
  f.append('vendor_id', String(vendorId));
  f.append('total_amount', String(total));
  f.append('delivery_terms', 'Net 30, delivered in 2 weeks');
  f.append('file', new Blob([PDF], { type: 'application/pdf' }), 'quote.pdf');
  return f;
}

test('submitted large requests route through manager then finance', async () => {
  const created = await req('POST', '/requests', pr(800), 'dev');
  assert.equal(created.status, 201);
  assert.equal(created.body.total_estimated_cents, 160_000);
  assert.equal(created.body.status, 'draft');
  const id = created.body.id;

  const submitted = await req('POST', `/requests/${id}/submit`, undefined, 'dev');
  assert.equal(submitted.body.status, 'pending_manager');

  const selfDecide = await req('POST', `/requests/${id}/decision`, { action: 'approve' }, 'dev');
  assert.equal(selfDecide.status, 403);

  const wrongDept = await req('POST', `/requests/${id}/decision`, { action: 'approve' }, 'lena');
  assert.equal(wrongDept.status, 404, 'other department should not even see the request');

  const managerOk = await req('POST', `/requests/${id}/decision`, { action: 'approve' }, 'marcus');
  assert.equal(managerOk.status, 200);
  assert.equal(managerOk.body.status, 'pending_finance', '>= $1,000 must go to finance');

  const earlyQuote = await req('POST', `/requests/${id}/quotations`, quoteForm(1, 500), 'procurement');
  assert.equal(earlyQuote.status, 409, 'quotes cannot be added before finance approves');

  const finance = await req('POST', `/requests/${id}/decision`, { action: 'approve' }, 'finance');
  assert.equal(finance.body.status, 'in_procurement');
  globalThis.__prId = id;
});

test('procurement needs the minimum quotes before choosing a winner, then issues a PO', async () => {
  const id = globalThis.__prId;
  const vendors = (await req('GET', '/vendors', undefined, 'procurement')).body.vendors;
  const active = vendors.filter((v) => v.is_active);

  const q1 = await req('POST', `/requests/${id}/quotations`, quoteForm(active[0].id, 1500), 'procurement');
  assert.equal(q1.status, 201);

  const tooFew = await req('POST', `/requests/${id}/quotations/${q1.body.id}/select`, undefined, 'procurement');
  assert.equal(tooFew.status, 409, 'a $1,600 request needs 2 quotes');

  const inactive = await req('POST', `/requests/${id}/quotations`, quoteForm(vendors.find((v) => !v.is_active).id, 1400), 'procurement');
  assert.equal(inactive.status, 422, 'inactive vendors cannot quote');

  const q2 = await req('POST', `/requests/${id}/quotations`, quoteForm(active[1].id, 1400), 'procurement');
  assert.equal(q2.status, 201);

  const select = await req('POST', `/requests/${id}/quotations/${q2.body.id}/select`, undefined, 'procurement');
  assert.equal(select.status, 200);
  assert.equal(select.body.status, 'approved');
  const winner = select.body.quotations.find((q) => q.is_selected);
  assert.equal(winner.id, q2.body.id);

  const quotesForDev = await req('GET', `/requests/${id}`, undefined, 'dev');
  assert.equal(quotesForDev.body.quotations.length, 0, 'requesters must not see vendor quotes');

  const po = await req('POST', `/requests/${id}/purchase-order`, undefined, 'procurement');
  assert.equal(po.status, 201);
  assert.equal(po.body.status, 'po_issued');
  assert.match(po.body.purchase_order.po_number, /^PO-\d{4}-\d{5}$/);
});

test('small requests skip finance and rejection needs a reason', async () => {
  const id = (await req('POST', '/requests', pr(40, 5), 'dev')).body.id;
  await req('POST', `/requests/${id}/submit`, undefined, 'dev');

  const noReason = await req('POST', `/requests/${id}/decision`, { action: 'reject', comments: '' }, 'marcus');
  assert.equal(noReason.status, 400, 'rejecting without a reason must fail');

  const revise = await req('POST', `/requests/${id}/decision`, { action: 'revise', comments: 'Add a supplier link' }, 'marcus');
  assert.equal(revise.body.status, 'revision_requested');

  const locked = await req('PUT', `/requests/${id}`, { ...pr(40, 5), title: 'Desks v2 for team' }, 'dev');
  assert.equal(locked.status, 200, 'owner can edit while revision is requested');

  await req('POST', `/requests/${id}/submit`, undefined, 'dev');
  const approve = await req('POST', `/requests/${id}/decision`, { action: 'approve' }, 'marcus');
  assert.equal(approve.body.status, 'in_procurement', 'under $1,000 goes straight to procurement');
});

test('a request cannot be edited once it is under review', async () => {
  const id = (await req('POST', '/requests', pr(10, 3), 'dev')).body.id;
  await req('POST', `/requests/${id}/submit`, undefined, 'dev');
  const edit = await req('PUT', `/requests/${id}`, pr(10, 4), 'dev');
  assert.equal(edit.status, 409);
});

test('uploads are validated by content, not just extension', async () => {
  const id = (await req('POST', '/requests', pr(10, 1), 'dev')).body.id;
  const fake = new FormData();
  fake.append('file', new Blob(['not really a pdf'], { type: 'application/pdf' }), 'evil.pdf');
  const bad = await req('POST', `/requests/${id}/attachments`, fake, 'dev');
  assert.equal(bad.status, 415);

  const good = new FormData();
  good.append('file', new Blob([PDF], { type: 'application/pdf' }), 'spec.pdf');
  const ok = await req('POST', `/requests/${id}/attachments`, good, 'dev');
  assert.equal(ok.status, 201);
});

test('audit log is append-only at the database level', () => {
  const row = db.prepare('SELECT id FROM audit_logs LIMIT 1').get();
  assert.ok(row, 'audit log should have entries');
  assert.throws(() => db.prepare('UPDATE audit_logs SET action_description = ? WHERE id = ?').run('x', row.id), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM audit_logs WHERE id = ?').run(row.id), /append-only/);
});

test('requesters cannot reach admin or finance-only endpoints', async () => {
  assert.equal((await req('GET', '/audit-logs', undefined, 'dev')).status, 403);
  assert.equal((await req('GET', '/users', undefined, 'dev')).status, 403);
  assert.equal((await req('GET', '/audit-logs', undefined, 'finance')).status, 200);
  assert.equal((await req('GET', '/users', undefined, 'admin')).status, 200);
});

test('notifications and mock emails are created for the workflow', async () => {
  const inbox = await req('GET', '/notifications', undefined, 'dev');
  assert.ok(inbox.body.unread > 0);
  const emails = db.prepare('SELECT COUNT(*) AS n FROM email_outbox').get().n;
  assert.ok(emails > 0);
});
