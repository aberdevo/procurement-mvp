import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../toast.jsx';
import { Field, Empty } from '../ui.jsx';

const blank = { name: '', email: '', phone: '', company_address: '', category: '' };

export default function Vendors() {
  const { user } = useAuth();
  const toast = useToast();
  const canEdit = ['procurement', 'admin'].includes(user.role);
  const [vendors, setVendors] = useState(null);
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .get('/vendors')
      .then((d) => setVendors(d.vendors))
      .catch((e) => toast.push(e.message, 'bad'));
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function add(e) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      await api.post('/vendors', form);
      setForm(blank);
      toast.push(`${form.name.trim()} added to the vendor directory`);
      load();
    } catch (err) {
      if (err.details) {
        const map = {};
        for (const d of err.details) map[d.field] ??= d.message;
        setErrors(map);
      }
      toast.push(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(v) {
    try {
      await api.patch(`/vendors/${v.id}`, { is_active: !v.is_active });
      toast.push(v.is_active ? `${v.name} deactivated` : `${v.name} reactivated`);
      load();
    } catch (err) {
      toast.push(err.message, 'bad');
    }
  }

  return (
    <section>
      <header className="page-head">
        <div>
          <h1>Vendors</h1>
          <p className="muted">Suppliers that can be asked for quotes. Inactive vendors are kept on record but cannot be quoted.</p>
        </div>
      </header>

      {vendors === null ? (
        <p className="muted">Loading vendors…</p>
      ) : vendors.length === 0 ? (
        <Empty title="No vendors yet." />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Contact</th>
                <th>Address</th>
                <th>Status</th>
                {canEdit && <th />}
              </tr>
            </thead>
            <tbody>
              {vendors.map((v) => (
                <tr key={v.id}>
                  <td className="row-title">{v.name}</td>
                  <td>{v.category}</td>
                  <td>
                    {v.email && <div>{v.email}</div>}
                    {v.phone && <div className="cell-sub">{v.phone}</div>}
                  </td>
                  <td>{v.company_address || <span className="muted">—</span>}</td>
                  <td>
                    <span className={`pill pill-${v.is_active ? 'ok' : 'muted'}`}>{v.is_active ? 'Active' : 'Inactive'}</span>
                  </td>
                  {canEdit && (
                    <td className="right">
                      <button className="btn btn-small btn-ghost" onClick={() => toggle(v)}>
                        {v.is_active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && (
        <form className="panel stack-lg mt" onSubmit={add}>
          <h2>Add a vendor</h2>
          <div className="grid-2">
            <Field label="Company name" htmlFor="v-name" error={errors.name}>
              <input id="v-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Category" htmlFor="v-cat" error={errors.category}>
              <input id="v-cat" list="v-cats" required value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
              <datalist id="v-cats">
                <option value="Office supplies" />
                <option value="Hardware" />
                <option value="Industrial" />
                <option value="Software" />
                <option value="Services" />
              </datalist>
            </Field>
            <Field label="Contact email" htmlFor="v-email" error={errors.email}>
              <input id="v-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Phone" htmlFor="v-phone">
              <input id="v-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
          </div>
          <Field label="Company address" htmlFor="v-addr">
            <input id="v-addr" value={form.company_address} onChange={(e) => setForm({ ...form, company_address: e.target.value })} />
          </Field>
          <div className="row-end">
            <button className="btn btn-primary" disabled={busy}>
              Add vendor
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
