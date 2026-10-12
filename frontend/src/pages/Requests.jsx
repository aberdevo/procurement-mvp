import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../toast.jsx';
import { StatusPill, Empty } from '../ui.jsx';
import { money, prLabel, dateOnly, NEEDS_ACTION } from '../format.js';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'action', label: 'Needs my action' },
  { key: 'draft', label: 'Drafts' },
  { key: 'closed', label: 'Closed' },
];

export default function Requests() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [requests, setRequests] = useState(null);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    api
      .get('/requests')
      .then((d) => setRequests(d.requests))
      .catch((e) => toast.push(e.message, 'bad'));
  }, [toast]);

  const visible = useMemo(() => {
    if (!requests) return [];
    const mine = NEEDS_ACTION[user.role] ?? [];
    return requests.filter((r) => {
      if (filter === 'action') return mine.includes(r.status);
      if (filter === 'draft') return r.status === 'draft';
      if (filter === 'closed') return ['po_issued', 'rejected'].includes(r.status);
      return true;
    });
  }, [requests, filter, user.role]);

  const canCreate = ['requester', 'manager'].includes(user.role);

  return (
    <section>
      <header className="page-head">
        <div>
          <h1>Requests</h1>
          <p className="muted">
            {user.role === 'requester'
              ? 'Requests you have raised.'
              : user.role === 'manager'
              ? 'Requests from your department and your own.'
              : 'Every request in the system.'}
          </p>
        </div>
        {canCreate && (
          <button className="btn btn-primary" onClick={() => navigate('/requests/new')}>
            New request
          </button>
        )}
      </header>

      <div className="chips" role="tablist" aria-label="Filter requests">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            role="tab"
            aria-selected={filter === f.key}
            className={`chip${filter === f.key ? ' is-on' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {requests === null ? (
        <p className="muted">Loading requests…</p>
      ) : visible.length === 0 ? (
        <Empty title={filter === 'all' ? 'No requests yet.' : 'Nothing in this view.'}>
          {canCreate && filter === 'all' && (
            <Link className="btn btn-primary" to="/requests/new">
              Create your first request
            </Link>
          )}
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Title</th>
                <th>Requester</th>
                <th>Department</th>
                <th className="num">Estimate</th>
                <th>Needed by</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id}>
                  <td className="mono">
                    <Link to={`/requests/${r.id}`}>{prLabel(r.id)}</Link>
                  </td>
                  <td>
                    <Link to={`/requests/${r.id}`} className="row-title">
                      {r.title}
                    </Link>
                  </td>
                  <td>{r.requester_name}</td>
                  <td>{r.department_name}</td>
                  <td className="num">{money(r.total_estimated_cents)}</td>
                  <td>{dateOnly(r.target_delivery_date)}</td>
                  <td>
                    <StatusPill status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
