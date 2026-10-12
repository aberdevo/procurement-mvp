import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../toast.jsx';
import { Field } from '../ui.jsx';
import { ROLE_LABEL, money } from '../format.js';

const ROLES = ['requester', 'manager', 'procurement', 'finance', 'admin'];
const blankUser = { name: '', email: '', password: '', role: 'requester', department_id: '' };

export default function Admin() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [newUser, setNewUser] = useState(blankUser);
  const [newDept, setNewDept] = useState({ name: '', budget_limit: '' });
  const [errors, setErrors] = useState({});

  const load = useCallback(async () => {
    try {
      const [u, d] = await Promise.all([api.get('/users'), api.get('/departments')]);
      setUsers(u.users);
      setDepartments(d.departments);
    } catch (e) {
      toast.push(e.message, 'bad');
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function patchUser(u, changes, message) {
    try {
      await api.patch(`/users/${u.id}`, changes);
      toast.push(message);
      load();
    } catch (e) {
      toast.push(e.message, 'bad');
    }
  }

  async function createUser(e) {
    e.preventDefault();
    setErrors({});
    try {
      await api.post('/users', {
        ...newUser,
        department_id: newUser.department_id ? Number(newUser.department_id) : null,
      });
      toast.push(`${newUser.name} can now sign in`);
      setNewUser(blankUser);
      load();
    } catch (err) {
      const map = {};
      for (const d of err.details ?? []) map[d.field] ??= d.message;
      setErrors(map);
      toast.push(err.message, 'bad');
    }
  }

  async function createDept(e) {
    e.preventDefault();
    try {
      await api.post('/departments', { name: newDept.name, budget_limit: Number(newDept.budget_limit || 0) });
      toast.push(`${newDept.name} created`);
      setNewDept({ name: '', budget_limit: '' });
      load();
    } catch (err) {
      toast.push(err.message, 'bad');
    }
  }

  return (
    <section>
      <header className="page-head">
        <div>
          <h1>Users and departments</h1>
          <p className="muted">Requesters and managers must belong to a department. Managers approve for their own department only.</p>
        </div>
      </header>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Department</th>
              <th>Access</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <span className="row-title">{u.name}</span>
                  <span className="cell-sub">{u.email}</span>
                </td>
                <td>
                  <select
                    aria-label={`Role for ${u.name}`}
                    value={u.role}
                    onChange={(e) => patchUser(u, { role: e.target.value }, `${u.name} is now ${ROLE_LABEL[e.target.value]}`)}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    aria-label={`Department for ${u.name}`}
                    value={u.department_id ?? ''}
                    onChange={(e) =>
                      patchUser(u, { department_id: e.target.value ? Number(e.target.value) : null }, `${u.name} moved`)
                    }
                  >
                    <option value="">None</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    className={`btn btn-small ${u.is_active ? 'btn-ghost' : ''}`}
                    disabled={u.id === me.id}
                    onClick={() => patchUser(u, { is_active: !u.is_active }, `${u.name} ${u.is_active ? 'deactivated' : 'reactivated'}`)}
                  >
                    {u.is_active ? 'Active · deactivate' : 'Inactive · reactivate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid-2 mt">
        <form className="panel stack" onSubmit={createUser}>
          <h2>Add a user</h2>
          <Field label="Full name" htmlFor="u-name" error={errors.name}>
            <input id="u-name" required value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} />
          </Field>
          <Field label="Email" htmlFor="u-email" error={errors.email}>
            <input id="u-email" type="email" required value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} />
          </Field>
          <Field label="Temporary password" htmlFor="u-pass" hint="At least 8 characters." error={errors.password}>
            <input id="u-pass" type="password" minLength={8} required value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} />
          </Field>
          <div className="grid-2">
            <Field label="Role" htmlFor="u-role">
              <select id="u-role" value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Department" htmlFor="u-dept" error={errors.department_id}>
              <select id="u-dept" value={newUser.department_id} onChange={(e) => setNewUser({ ...newUser, department_id: e.target.value })}>
                <option value="">None</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="row-end">
            <button className="btn btn-primary">Create user</button>
          </div>
        </form>

        <div className="stack-lg">
          <form className="panel stack" onSubmit={createDept}>
            <h2>Departments</h2>
            <ul className="dept-list">
              {departments.map((d) => (
                <li key={d.id}>
                  <span>{d.name}</span>
                  <span className="num muted">Budget {money(d.budget_limit_cents)}</span>
                </li>
              ))}
            </ul>
            <div className="grid-2">
              <Field label="New department" htmlFor="d-name">
                <input id="d-name" required value={newDept.name} onChange={(e) => setNewDept({ ...newDept, name: e.target.value })} />
              </Field>
              <Field label="Budget (USD)" htmlFor="d-budget">
                <input id="d-budget" type="number" min="0" step="1" value={newDept.budget_limit} onChange={(e) => setNewDept({ ...newDept, budget_limit: e.target.value })} />
              </Field>
            </div>
            <div className="row-end">
              <button className="btn">Add department</button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
