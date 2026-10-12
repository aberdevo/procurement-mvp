// Business rules live here as pure functions so they can be tested in isolation.

export const APPROVAL_THRESHOLD_CENTS = 100_000; // $1,000.00

// Minimum vendor quotes needed before a winner can be chosen.
export const QUOTE_RULES = [
  { minCents: 1_000_000, requiredQuotes: 3 }, // $10,000 and above
  { minCents: 100_000, requiredQuotes: 2 },   // $1,000 and above
  { minCents: 0, requiredQuotes: 1 },
];

export const STATUS = Object.freeze({
  DRAFT: 'draft',
  PENDING_MANAGER: 'pending_manager',
  PENDING_FINANCE: 'pending_finance',
  REVISION_REQUESTED: 'revision_requested',
  IN_PROCUREMENT: 'in_procurement',
  APPROVED: 'approved',
  PO_ISSUED: 'po_issued',
  REJECTED: 'rejected',
});

export const ROLES = ['requester', 'manager', 'procurement', 'finance', 'admin'];
export const EDITABLE_STATUSES = [STATUS.DRAFT, STATUS.REVISION_REQUESTED];

/** Approval stages a request must pass, in order, for its total. */
export function requiredApprovalStages(totalCents) {
  return totalCents >= APPROVAL_THRESHOLD_CENTS ? ['manager', 'finance'] : ['manager'];
}

export function requiredQuoteCount(totalCents) {
  return QUOTE_RULES.find((rule) => totalCents >= rule.minCents).requiredQuotes;
}

/** Which approval stage a status is waiting on, or null. */
export function stageForStatus(status) {
  if (status === STATUS.PENDING_MANAGER) return 'manager';
  if (status === STATUS.PENDING_FINANCE) return 'finance';
  return null;
}

/** Where a request goes after an approval at the given stage. */
export function statusAfterApproval(stage, totalCents) {
  if (stage === 'manager') {
    return totalCents >= APPROVAL_THRESHOLD_CENTS ? STATUS.PENDING_FINANCE : STATUS.IN_PROCUREMENT;
  }
  if (stage === 'finance') return STATUS.IN_PROCUREMENT;
  throw new Error(`Unknown approval stage: ${stage}`);
}

/** A manager may decide only for their own department and never on their own request. */
export function canDecide(user, request, stage) {
  if (stage === 'manager') {
    return (
      user.role === 'manager' &&
      user.department_id === request.department_id &&
      user.id !== request.requester_id
    );
  }
  if (stage === 'finance') return user.role === 'finance';
  return false;
}

export function canViewRequest(user, request) {
  switch (user.role) {
    case 'requester':
      return request.requester_id === user.id;
    case 'manager':
      return request.department_id === user.department_id || request.requester_id === user.id;
    default:
      return true; // procurement, finance, admin
  }
}

export const formatPrNumber = (id) => `PR-${String(id).padStart(4, '0')}`;
export const centsFromDollars = (amount) => Math.round(Number(amount) * 100);
export const formatMoney = (cents) =>
  `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
