import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FileText, Paperclip, Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '../api.js';
import { useToast } from '../toast.jsx';
import { useAuth } from '../auth.jsx';
import { Field } from '../ui.jsx';
import { money, prLabel } from '../format.js';

const blankItem = () => ({ item_name: '', description: '', quantity: 1, estimated_unit_price: '' });
const today = () => new Date().toISOString().slice(0, 10);

export default function RequestForm() {
  const { id } = useParams();
  const editing = Boolean(id);
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [form, setForm] = useState({ title: '', target_delivery_date: '', justification: '', items: [blankItem()] });
  const [files, setFiles] = useState([]);
  const [existing, setExisting] = useState([]);
  const [draftId, setDraftId] = useState(null); // set after first save so retries never create a duplicate
  const [loading, setLoading] = useState(editing);
  const [busy, setBusy] = useState(null);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!editing) return;
    api
      .get(`/requests/${id}`)
      .then((r) => {
        if (!r.permissions.edit) {
          toast.push('This request can no longer be edited.', 'bad');
          navigate(`/requests/${id}`, { replace: true });
          return;
        }
        setForm({
          title: r.title,
          target_delivery_date: r.target_delivery_date,
          justification: r.justification,
          items: r.items.map((i) => ({
            item_name: i.item_name,
            description: i.description,
            quantity: i.quantity,
            estimated_unit_price: (i.estimated_unit_price_cents / 100).toFixed(2),
          })),
        });
        setExisting(r.attachments);
      })
      .catch((e) => setFormError(e.message))
      .finally(() => setLoading(false));
  }, [id, editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = useMemo(
    () => form.items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.estimated_unit_price) || 0), 0),
    [form.items]
  );
  const needsFinance = total >= 1000;

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const setItem = (index, key, value) =>
    setForm((f) => ({ ...f, items: f.items.map((it, i) => (i === index ? { ...it, [key]: value } : it)) }));
  const removeItem = (index) => setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== index) }));

  function applyServerError(err) {
    if (err instanceof ApiError && err.details) {
      const map = {};
      for (const d of err.details) map[d.field] ??= d.message;
      setErrors(map);
    }
    setFormError(err.message);
  }

  async function save(mode) {
    setBusy(mode);
    setErrors({});
    setFormError('');
    const body = {
      title: form.title.trim(),
      target_delivery_date: form.target_delivery_date,
      justification: form.justification.trim(),
      items: form.items.map((i) => ({
        item_name: i.item_name.trim(),
        description: i.description.trim(),
        quantity: Number(i.quantity),
        estimated_unit_price: Number(i.estimated_unit_price),
      })),
    };
    try {
      const targetId = editing ? id : draftId;
      const saved = targetId ? await api.put(`/requests/${targetId}`, body) : await api.post('/requests', body);
      setDraftId(saved.id);

      for (const file of files) {
        const fd = new FormData();
        fd.append('file', file);
        await api.upload(`/requests/${saved.id}/attachments`, fd);
      }
      if (mode === 'submit') await api.post(`/requests/${saved.id}/submit`);

      toast.push(mode === 'submit' ? `${prLabel(saved.id)} sent for approval` : `${prLabel(saved.id)} saved as a draft`);
      navigate(`/requests/${saved.id}`);
    } catch (err) {
      applyServerError(err);
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <p className="muted">Loading request…</p>;

  const heading = editing ? `Edit ${prLabel(Number(id))}` : 'New purchase request';

  return (
    <section className="form-page">
      <header className="page-head">
        <div>
          <h1>{heading}</h1>
          <p className="muted">Describe what you need. Your manager is notified when you send it for approval.</p>
        </div>
      </header>

      {formError && (
        <p className="banner banner-bad" role="alert">
          {formError}
        </p>
      )}

      <form
        className="stack-lg"
        onSubmit={(e) => {
          e.preventDefault();
          save('submit');
        }}
      >
        <fieldset className="panel">
          <legend>The request</legend>
          <div className="grid-2">
            <Field label="Title" htmlFor="title" error={errors.title}>
              <input id="title" value={form.title} onChange={(e) => setField('title', e.target.value)} placeholder="Standing desks for the platform team" required />
            </Field>
            <Field label="Needed by" htmlFor="target" error={errors.target_delivery_date}>
              <input
                id="target"
                type="date"
                min={today()}
                value={form.target_delivery_date}
                onChange={(e) => setField('target_delivery_date', e.target.value)}
                required
              />
            </Field>
            <Field label="Department" htmlFor="dept" hint="Set by your account.">
              <input id="dept" value={user.department_name ?? 'Not assigned'} disabled />
            </Field>
          </div>
          <Field label="Justification" htmlFor="why" error={errors.justification} hint="What problem does this solve, and what happens without it?">
            <textarea id="why" rows={4} value={form.justification} onChange={(e) => setField('justification', e.target.value)} required />
          </Field>
        </fieldset>

        <fieldset className="panel">
          <legend>Line items</legend>
          <div className="items">
            <div className="items-head" aria-hidden="true">
              <span>Item</span>
              <span>Description</span>
              <span>Qty</span>
              <span>Unit price</span>
              <span className="num">Line total</span>
              <span />
            </div>
            {form.items.map((it, i) => {
              const line = (Number(it.quantity) || 0) * (Number(it.estimated_unit_price) || 0);
              return (
                <div className="items-row" key={i}>
                  <div className="cell-stack">
                    <input aria-label={`Item ${i + 1} name`} value={it.item_name} onChange={(e) => setItem(i, 'item_name', e.target.value)} placeholder="Item name" required />
                    {errors[`items.${i}.item_name`] && <p className="field-error">{errors[`items.${i}.item_name`]}</p>}
                  </div>
                  <input aria-label={`Item ${i + 1} description`} value={it.description} onChange={(e) => setItem(i, 'description', e.target.value)} placeholder="Optional detail" />
                  <input aria-label={`Item ${i + 1} quantity`} type="number" min="1" step="1" value={it.quantity} onChange={(e) => setItem(i, 'quantity', e.target.value)} required />
                  <input aria-label={`Item ${i + 1} estimated unit price in dollars`} type="number" min="0" step="0.01" value={it.estimated_unit_price} onChange={(e) => setItem(i, 'estimated_unit_price', e.target.value)} placeholder="0.00" required />
                  <span className="num">{money(Math.round(line * 100))}</span>
                  <button type="button" className="icon-btn" onClick={() => removeItem(i)} disabled={form.items.length === 1} aria-label={`Remove item ${i + 1}`}>
                    <Trash2 size={16} />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="row-between">
            <button type="button" className="btn btn-ghost" onClick={() => setForm((f) => ({ ...f, items: [...f.items, blankItem()] }))}>
              <Plus size={16} aria-hidden="true" /> Add line item
            </button>
            <div className="estimate">
              <span className="muted">Estimated total</span>
              <strong className="num big">{money(Math.round(total * 100))}</strong>
            </div>
          </div>
          {needsFinance && (
            <p className="banner banner-info">Requests of $1,000 or more also need finance approval after your manager.</p>
          )}
          {errors.items && <p className="field-error">{errors.items}</p>}
        </fieldset>

        <fieldset className="panel">
          <legend>Attachments</legend>
          <p className="hint">Quotes, specs or photos. PDF, PNG or JPG, up to 10 MB each.</p>
          {existing.length > 0 && (
            <ul className="file-list">
              {existing.map((a) => (
                <li key={a.id} className="file-chip">
                  <FileText size={14} aria-hidden="true" /> {a.original_name}
                </li>
              ))}
            </ul>
          )}
          <label className="btn btn-ghost file-pick">
            <Paperclip size={16} aria-hidden="true" /> Choose files
            <input
              type="file"
              multiple
              accept="application/pdf,image/png,image/jpeg"
              className="sr-only"
              onChange={(e) => setFiles((prev) => [...prev, ...Array.from(e.target.files)])}
            />
          </label>
          {files.length > 0 && (
            <ul className="file-list">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="file-chip">
                  <FileText size={14} aria-hidden="true" /> {f.name}
                  <button type="button" className="link" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </fieldset>

        <footer className="form-footer">
          <Link to={editing ? `/requests/${id}` : '/requests'} className="btn btn-ghost">
            Cancel
          </Link>
          <div className="row-end">
            <button type="button" className="btn" disabled={busy !== null} onClick={() => save('draft')}>
              {busy === 'draft' ? 'Saving…' : 'Save draft'}
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy !== null}>
              {busy === 'submit' ? 'Sending…' : 'Submit for approval'}
            </button>
          </div>
        </footer>
      </form>
    </section>
  );
}
