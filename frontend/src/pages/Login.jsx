import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

const DEMO_ACCOUNTS = [
  { email: 'dev@corp.test', role: 'Requester' },
  { email: 'marcus@corp.test', role: 'Department manager' },
  { email: 'finance@corp.test', role: 'Finance' },
  { email: 'procurement@corp.test', role: 'Procurement' },
  { email: 'admin@corp.test', role: 'Admin' },
];

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email.trim(), password);
      navigate(location.state?.from ?? '/requests', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="login-card">
        <h1 className="login-title">Requisitions</h1>
        <p className="muted">Purchase requests, approvals and purchase orders in one ledger.</p>

        <form onSubmit={submit} className="stack">
          <div className="field">
            <label htmlFor="email">Work email</label>
            <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && <p className="field-error" role="alert">{error}</p>}
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {import.meta.env.DEV && (
          <div className="demo">
            <p className="hint">Demo accounts. Password is the one set by SEED_PASSWORD (default ChangeMe123!).</p>
            <ul className="demo-list">
              {DEMO_ACCOUNTS.map((a) => (
                <li key={a.email}>
                  <button className="link" type="button" onClick={() => setEmail(a.email)}>
                    {a.email}
                  </button>
                  <span className="muted"> {a.role}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
