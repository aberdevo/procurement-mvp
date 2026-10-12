import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../toast.jsx';
import { ROLE_LABEL, dateTime, prLabel } from '../format.js';
import { Empty } from '../ui.jsx';

export default function Audit() {
  const toast = useToast();
  const [tab, setTab] = useState('activity');
  const [logs, setLogs] = useState(null);
  const [emails, setEmails] = useState(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    const requestId = filter.replace(/\D/g, '');
    const query = requestId ? `?request_id=${Number(requestId)}` : '';
    api
      .get(`/audit-logs${query}`)
      .then((d) => setLogs(d.logs))
      .catch((e) => toast.push(e.message, 'bad'));
  }, [filter, toast]);

  useEffect(() => {
    if (tab !== 'email' || emails) return;
    api
      .get('/email-outbox')
      .then((d) => setEmails(d.emails))
      .catch((e) => toast.push(e.message, 'bad'));
  }, [tab, emails, toast]);

  return (
    <section>
      <header className="page-head">
        <div>
          <h1>Audit log</h1>
          <p className="muted">Every change is recorded with who, what and when. Entries cannot be edited or deleted.</p>
        </div>
      </header>

      <div className="chips" role="tablist" aria-label="Audit views">
        <button role="tab" aria-selected={tab === 'activity'} className={`chip${tab === 'activity' ? ' is-on' : ''}`} onClick={() => setTab('activity')}>
          Activity
        </button>
        <button role="tab" aria-selected={tab === 'email'} className={`chip${tab === 'email' ? ' is-on' : ''}`} onClick={() => setTab('email')}>
          Sent email
        </button>
      </div>

      {tab === 'activity' && (
        <>
          <div className="filter-row">
            <label htmlFor="pr-filter">Show one request</label>
            <input id="pr-filter" placeholder="e.g. 0042" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          {logs === null ? (
            <p className="muted">Loading…</p>
          ) : logs.length === 0 ? (
            <Empty title="No activity matches." />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Who</th>
                    <th>What</th>
                    <th>Request</th>
                    <th>IP</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id}>
                      <td className="nowrap">{dateTime(l.timestamp)}</td>
                      <td>
                        {l.actor_name ?? 'Unknown'}
                        {l.actor_role && <div className="cell-sub">{ROLE_LABEL[l.actor_role]}</div>}
                      </td>
                      <td>{l.action_description}</td>
                      <td className="mono">{l.request_id ? <Link to={`/requests/${l.request_id}`}>{prLabel(l.request_id)}</Link> : '—'}</td>
                      <td className="mono cell-sub">{l.ip_address ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'email' && (
        <>
          <p className="hint">Email is logged here instead of being sent. Swap the outbox for SMTP to deliver it.</p>
          {emails === null ? (
            <p className="muted">Loading…</p>
          ) : emails.length === 0 ? (
            <Empty title="No email yet." />
          ) : (
            <ul className="mail-list">
              {emails.map((m) => (
                <li key={m.id} className="mail">
                  <p className="mail-subject">{m.subject}</p>
                  <p className="cell-sub">
                    To {m.to_email} · {dateTime(m.created_at)}
                  </p>
                  <pre className="mail-body">{m.body}</pre>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
