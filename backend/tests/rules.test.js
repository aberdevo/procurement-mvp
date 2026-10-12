import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as rules from '../src/rules.js';

test('requests under $1,000 need only manager approval', () => {
  assert.deepEqual(rules.requiredApprovalStages(99_999), ['manager']);
});

test('requests of $1,000 or more need manager then finance', () => {
  assert.deepEqual(rules.requiredApprovalStages(100_000), ['manager', 'finance']);
});

test('manager approval routes under-threshold requests straight to procurement', () => {
  assert.equal(rules.statusAfterApproval('manager', 50_000), rules.STATUS.IN_PROCUREMENT);
});

test('manager approval routes large requests to finance', () => {
  assert.equal(rules.statusAfterApproval('manager', 250_000), rules.STATUS.PENDING_FINANCE);
});

test('quote requirements scale with the request total', () => {
  assert.equal(rules.requiredQuoteCount(50_000), 1);
  assert.equal(rules.requiredQuoteCount(100_000), 2);
  assert.equal(rules.requiredQuoteCount(1_000_000), 3);
});

test('a manager cannot approve their own request or another department', () => {
  const request = { department_id: 1, requester_id: 5 };
  assert.equal(rules.canDecide({ id: 5, role: 'manager', department_id: 1 }, request, 'manager'), false);
  assert.equal(rules.canDecide({ id: 9, role: 'manager', department_id: 2 }, request, 'manager'), false);
  assert.equal(rules.canDecide({ id: 9, role: 'manager', department_id: 1 }, request, 'manager'), true);
});

test('only finance can decide the finance stage', () => {
  const request = { department_id: 1, requester_id: 5 };
  assert.equal(rules.canDecide({ id: 3, role: 'manager', department_id: 1 }, request, 'finance'), false);
  assert.equal(rules.canDecide({ id: 4, role: 'finance', department_id: null }, request, 'finance'), true);
});

test('requesters only see their own requests', () => {
  const request = { department_id: 1, requester_id: 5 };
  assert.equal(rules.canViewRequest({ id: 5, role: 'requester', department_id: 1 }, request), true);
  assert.equal(rules.canViewRequest({ id: 6, role: 'requester', department_id: 1 }, request), false);
});

test('money is stored as integer cents', () => {
  assert.equal(rules.centsFromDollars(19.99), 1999);
  assert.equal(rules.centsFromDollars(0.1 * 3), 30);
  assert.equal(rules.formatMoney(1234567), '$12,345.67');
});
