import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Ban, Check, Download, FileText, Paperclip, RotateCcw, Send, Award } from 'lucide-react';
import { api, downloadFile } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../toast.jsx';
import { StatusPill, Pipeline, Field, Empty } from '../ui.jsx';
import { money, prLabel, dateOnly, dateTime, ACTION_LABEL } from '../format.js';

const STAGE_TEXT = {
  manager: 'Manager review',
  finance: 'Finance sign-off',
};

export default function RequestDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();

  const [r, setR] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [comments, setComments] = useState('');
  const [vendors, setVendors] = useState([]);
  const [quote, setQuote] = useState({ vendor_id: '', total_amount: '', delivery_terms: '' });
  const [quoteFile, setQuoteFile] = useState(null);

  const load = useCallback(
    () => api.get(`/requests/${id}`).then(setR).catch((e) => setLoadError(e.message)),
    [id]
  );

  useEffect(() => {
    load();
  }, [load]);

  const canAddQuote = r?.permissions?.add_quote;
  useEffect(() => {
    if (!canAddQuote) return;
    api
      .get('/vendors')
      .then((d) => setVendors(d.vendors.filter((v) => v.is_active)))
      .catch(() => {});
  }, [canAddQuote]);

  if (loadError) {
    return (
      <section>
        <Empty title="This request could not be opened.">
          <p>{loadError}</p>
        </Empty>
        <Link to="/requests">Back to requests</Link>
      </section>
    );
  }
  if (!r) return <p className="muted">Loading request…</p>;

  const perms = r.permissions;
  const lastApproval = r.approvals.at(-1);
  const showProcurement =
    user.role !== 'requester' && (perms.add_quote || r.quotations.length > 0 || ['in_procurement', 'approved', 'po_issued'].includes(r.status));
  const lowest = r.quotations.length ? Math.min(...r.quotations.map((q) => q.total_amount_cents)) : null;
  const requiredQuotes = r.required_quotes;

  // Runs an action. Actions that return the full request update in place; others trigger a reload.
  async function act(fn, message, tone = 'ok') {
    setBusy(true);
    try {
      const next = await fn();
      if (next?.permissions) setR(next);
      else await load();
      if (message) toast.push(message, tone);
    } catch (e) {
      toast.push(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  const decide = (action) => {
    if (action !== 'approve' && comments.trim().length < 5) {
      toast.push('Add a reason of at least 5 characters first.', 'bad');
      return;
    }
    const messages = { approve: 'Approved', reject: 'Request rejected', revise: 'Revision requested' };
    act(
      async () => {
        const next = await api.post(`/requests/${id}/decision`, { action, comments: comments.trim() });
        setComments('');
        return next;
      },
      messages[action],
      action === 'approve' ? 'ok' : 'bad'
    );
  };

  async function addQuote(e) {
    e.preventDefault();
    if (!quoteFile) {
      toast.push('Attach the vendor quote as a PDF.', 'bad');
      return;
    }
    const fd = new FormData();
    fd.append('vendor_id', quote.vendor_id);
    fd.append('total_amount', quote.total_amount);
    fd.append('delivery_terms', quote.delivery_terms);
    fd.append('file', quoteFile);
    await act(
      async () => {
        await api.upload(`/requests/${id}/quotations`, fd);
        setQuote({ vendor_id: '', total_amount: '', delivery_terms: '' });
        setQuoteFile(null);
        return null;
      },
      'Quote added'
    );
  }

  async function uploadAttachment(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    await act(() => api.upload(`/requests/${id}/attachments`, fd), 'File attached');
  }

  const download = (path, name) => downloadFile(path, name).catch((e) => toast.push(e.message, 'bad'));

  const decisionTitle = perms.decide
    ? 'Your decision'
    : perms.edit
    ? 'Your draft'
    : r.status === 'revision_requested'
    ? 'Revision requested'
    : 'Waiting on approval';

  return (
    <section className="detail">
      <header className="detail-head">
        <div className="detail-title">
          <p className="doc-id">{r.label}</p>
          <h1>{r.title}</h1>
          <p className="meta">
            Raised by {r.requester_name} · {r.department_name} · Created {dateTime(r.created_at)}
          </p>
        </div>
        <div className="detail-figures">
          <StatusPill status={r.status} />
          <p className="big num">{money(r.total_estimated_cents)}</p>
          <p className="muted">Needed by {dateOnly(r.target_delivery_date)}</p>
        </div>
      </header>

      <div className="track-wrap">
        <p className="route">
          Route for this amount: Manager{r.approval_stages.includes('finance') ? ', then finance' : ''}, then procurement.
        </p>
        <Pipeline request={r} />
      </div>

      {r.status === 'rejected' && lastApproval && (
        <p className="banner banner-bad" role="status">
          Rejected by {lastApproval.approver_name}. {lastApproval.comments}
        </p>
      )}
      {r.status === 'revision_requested' && lastApproval && (
        <p className="banner banner-warn" role="status">
          {lastApproval.approver_name} asked for changes: {lastApproval.comments}
        </p>
      )}

      {(perms.decide || perms.edit || perms.submit || r.waiting_on_stage) && (
        <section className="panel decision" aria-labelledby="decision-title">
          <h2 id="decision-title">{decisionTitle}</h2>

          {perms.decide && (
            <>
              <p className="muted">
                Step: {STAGE_TEXT[r.waiting_on_stage]}. Approve to move on, or send it back with a reason.
              </p>
              <Field label="Comments" htmlFor="comments" hint="Required to reject or request a revision. The requester sees this.">
                <textarea id="comments" rows={3} value={comments} onChange={(e) => setComments(e.target.value)} />
              </Field>
              <div className="row-end">
                <button className="btn btn-danger" disabled={busy} onClick={() => decide('reject')}>
                  <Ban size={16} aria-hidden="true" /> Reject
                </button>
                <button className="btn" disabled={busy} onClick={() => decide('revise')}>
                  <RotateCcw size={16} aria-hidden="true" /> Request revision
                </button>
                <button className="btn btn-primary" disabled={busy} onClick={() => decide('approve')}>
                  <Check size={16} aria-hidden="true" /> Approve
                </button>
              </div>
            </>
          )}

          {!perms.decide && r.waiting_on_stage && (
            <p className="muted">Waiting for {STAGE_TEXT[r.waiting_on_stage].toLowerCase()}.</p>
          )}

          {(perms.edit || perms.submit) && (
            <>
              <p className="muted">
                {r.status === 'revision_requested'
                  ? 'Update the request to address the feedback, then send it again.'
                  : 'Check the details, then send it for approval. You can edit until it is submitted.'}
              </p>
              <div className="row-end">
                {perms.edit && (
                  <Link className="btn" to={`/requests/${id}/edit`}>
                    Edit request
                  </Link>
                )}
                {perms.submit && (
                  <button
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => act(() => api.post(`/requests/${id}/submit`), `${r.label} sent for approval`)}
                  >
                    <Send size={16} aria-hidden="true" /> Submit for approval
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      )}

      <div className="detail-grid">
        <div className="col-main">
          <section className="block">
            <h2>Justification</h2>
            <p className="prose">{r.justification}</p>
          </section>

          <section className="block">
            <h2>Line items</h2>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="num">Qty</th>
                    <th className="num">Unit</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {r.items.map((it) => (
                    <tr key={it.id}>
                      <td>
                        <span className="row-title">{it.item_name}</span>
                        {it.description && <span className="cell-sub">{it.description}</span>}
                      </td>
                      <td className="num">{it.quantity}</td>
                      <td className="num">{money(it.estimated_unit_price_cents)}</td>
                      <td className="num">{money(it.quantity * it.estimated_unit_price_cents)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan={3} scope="row">
                      Estimated total
                    </th>
                    <td className="num big">{money(r.total_estimated_cents)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          {showProcurement && (
            <section className="block" aria-labelledby="sourcing-title">
              <div className="block-head">
                <h2 id="sourcing-title">Vendor quotes</h2>
                <p className="muted">
                  {r.quotations.length} of {requiredQuotes} required
                </p>
              </div>

              {r.quotations.length === 0 ? (
                <p className="muted">No quotes yet. {perms.add_quote ? 'Add the first one below.' : ''}</p>
              ) : (
                <div className="table-wrap">
                  <table className="table compare">
                    <thead>
                      <tr>
                        <th>Vendor</th>
                        <th className="num">Quoted total</th>
                        <th>Against estimate</th>
                        <th>Delivery terms</th>
                        <th>Quote</th>
                        <th>
                          <span className="sr-only">Action</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.quotations.map((q) => {
                        const diff = q.total_amount_cents - r.total_estimated_cents;
                        return (
                          <tr key={q.id} className={q.is_selected ? 'is-winner' : undefined}>
                            <td>
                              <span className="row-title">{q.vendor_name}</span>
                              {q.total_amount_cents === lowest && <span className="cell-sub">Lowest price</span>}
                            </td>
                            <td className="num">{money(q.total_amount_cents)}</td>
                            <td className={diff > 0 ? 'num warn-text' : 'num'}>
                              {diff === 0 ? 'Matches' : `${diff > 0 ? '+' : '−'}${money(Math.abs(diff))}`}
                            </td>
                            <td>{q.delivery_terms}</td>
                            <td>
                              <button className="link inline" onClick={() => download(`/files/quotations/${q.id}`, q.original_name)}>
                                <FileText size={14} aria-hidden="true" /> PDF
                              </button>
                            </td>
                            <td className="right">
                              {q.is_selected ? (
                                <span className="stamp">
                                  <Award size={14} aria-hidden="true" /> Selected
                                </span>
                              ) : (
                                perms.select_quote && (
                                  <button
                                    className="btn btn-small"
                                    disabled={busy}
                                    onClick={() =>
                                      act(() => api.post(`/requests/${id}/quotations/${q.id}/select`), `${q.vendor_name} selected`)
                                    }
                                  >
                                    Choose winner
                                  </button>
                                )
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {perms.add_quote && (
                <form className="quote-form" onSubmit={addQuote}>
                  <h3>Add a vendor quote</h3>
                  <div className="grid-3">
                    <Field label="Vendor" htmlFor="q-vendor">
                      <select id="q-vendor" required value={quote.vendor_id} onChange={(e) => setQuote({ ...quote, vendor_id: e.target.value })}>
                        <option value="">Choose a vendor</option>
                        {vendors.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Quoted total (USD)" htmlFor="q-total">
                      <input id="q-total" type="number" min="0.01" step="0.01" required value={quote.total_amount} onChange={(e) => setQuote({ ...quote, total_amount: e.target.value })} />
                    </Field>
                    <Field label="Delivery terms" htmlFor="q-terms">
                      <input id="q-terms" required value={quote.delivery_terms} placeholder="Net 30, 2 weeks" onChange={(e) => setQuote({ ...quote, delivery_terms: e.target.value })} />
                    </Field>
                  </div>
                  <div className="row-between">
                    <label className="btn btn-ghost file-pick">
                      <Paperclip size={16} aria-hidden="true" /> {quoteFile ? quoteFile.name : 'Attach quote PDF'}
                      <input type="file" accept="application/pdf" className="sr-only" onChange={(e) => setQuoteFile(e.target.files?.[0] ?? null)} />
                    </label>
                    <button className="btn btn-primary" disabled={busy}>
                      Add quote
                    </button>
                  </div>
                </form>
              )}
            </section>
          )}
        </div>

        <aside className="col-side">
          <section className="block">
            <h2>Attachments</h2>
            {r.attachments.length === 0 ? (
              <p className="muted">None.</p>
            ) : (
              <ul className="file-list">
                {r.attachments.map((a) => (
                  <li key={a.id}>
                    <button className="link inline" onClick={() => download(`/files/attachments/${a.id}`, a.original_name)}>
                      <Download size={14} aria-hidden="true" /> {a.original_name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {perms.attach && (
              <label className="btn btn-ghost file-pick">
                <Paperclip size={16} aria-hidden="true" /> Add file
                <input type="file" accept="application/pdf,image/png,image/jpeg" className="sr-only" onChange={uploadAttachment} />
              </label>
            )}
          </section>

          <section className="block">
            <h2>Approvals</h2>
            {r.approvals.length === 0 ? (
              <p className="muted">No decisions yet.</p>
            ) : (
              <ol className="log">
                {r.approvals.map((a) => (
                  <li key={a.id}>
                    <p>
                      <strong>{a.approver_name}</strong> {ACTION_LABEL[a.action].toLowerCase()} at {a.stage} stage
                    </p>
                    {a.comments && <p className="prose-sm">“{a.comments}”</p>}
                    <p className="cell-sub">{dateTime(a.timestamp)}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {r.purchase_order && (
            <section className="block po">
              <h2>Purchase order</h2>
              <p className="mono po-number">{r.purchase_order.po_number}</p>
              <p>
                {r.purchase_order.vendor_name} · <span className="num">{money(r.purchase_order.total_amount_cents)}</span>
              </p>
              <p className="cell-sub">Issued {dateTime(r.purchase_order.issued_at)}</p>
            </section>
          )}

          {perms.issue_po && (
            <section className="block">
              <h2>Next step</h2>
              <p className="muted">Issue the purchase order to the winning vendor.</p>
              <button className="btn btn-primary" disabled={busy} onClick={() => act(() => api.post(`/requests/${id}/purchase-order`), 'Purchase order issued')}>
                Issue purchase order
              </button>
            </section>
          )}

          <section className="block">
            <h2>Audit trail</h2>
            {r.audit_trail.length === 0 ? (
              <p className="muted">No activity yet.</p>
            ) : (
              <ol className="log log-scroll">
                {r.audit_trail.map((a, i) => (
                  <li key={i}>
                    <p>
                      <strong>{a.actor_name ?? 'System'}</strong> {a.action_description}
                    </p>
                    <p className="cell-sub">{dateTime(a.timestamp)}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}
