const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export const money = (cents) => usd.format((cents ?? 0) / 100);
export const prLabel = (id) => `PR-${String(id).padStart(4, '0')}`;

/** Timestamps from the API are UTC; show them as UTC so audit times match the server. */
export function dateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  return `${d.toLocaleString('en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })} UTC`;
}

export function dateOnly(isoDate) {
  if (!isoDate) return '';
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export const STATUS_META = {
  draft: { label: 'Draft', tone: 'muted' },
  pending_manager: { label: 'With manager', tone: 'warn' },
  pending_finance: { label: 'With finance', tone: 'warn' },
  revision_requested: { label: 'Revision requested', tone: 'bad' },
  in_procurement: { label: 'In procurement', tone: 'info' },
  approved: { label: 'Winner chosen', tone: 'info' },
  po_issued: { label: 'PO issued', tone: 'ok' },
  rejected: { label: 'Rejected', tone: 'bad' },
};

export const ROLE_LABEL = {
  requester: 'Requester',
  manager: 'Department manager',
  procurement: 'Procurement officer',
  finance: 'Finance',
  admin: 'Admin',
};

export const ACTION_LABEL = {
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  REVISION_REQUESTED: 'Revision requested',
};

/** Which statuses need action from each role, used by the "Needs my action" filter. */
export const NEEDS_ACTION = {
  requester: ['revision_requested'],
  manager: ['pending_manager'],
  finance: ['pending_finance'],
  procurement: ['in_procurement', 'approved'],
  admin: [],
};

/** Steps of the approval ledger for one request, with each step's state. */
export function pipelineSteps(r) {
  const steps = [
    { key: 'draft', label: 'Draft' },
    { key: 'pending_manager', label: 'Manager' },
  ];
  if (r.approval_stages?.includes('finance')) steps.push({ key: 'pending_finance', label: 'Finance' });
  steps.push(
    { key: 'in_procurement', label: 'Sourcing' },
    { key: 'approved', label: 'Winner chosen' },
    { key: 'po_issued', label: 'PO issued' }
  );

  const stopped = r.status === 'rejected' || r.status === 'revision_requested';
  let current;
  if (stopped) {
    const last = r.approvals?.at(-1)?.stage;
    current = last === 'finance' ? 'pending_finance' : 'pending_manager';
  } else {
    current = r.status;
  }
  const idx = Math.max(0, steps.findIndex((s) => s.key === current));

  return steps.map((s, i) => ({
    ...s,
    state: stopped && i === idx ? 'stopped' : i < idx ? 'done' : i === idx ? 'current' : 'todo',
  }));
}
