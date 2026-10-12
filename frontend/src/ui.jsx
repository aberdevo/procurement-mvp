import { STATUS_META, pipelineSteps } from './format.js';

export function StatusPill({ status }) {
  const meta = STATUS_META[status] ?? { label: status, tone: 'muted' };
  return <span className={`pill pill-${meta.tone}`}>{meta.label}</span>;
}

/** The approval route drawn as a ledger track: where the request has been and where it is now. */
export function Pipeline({ request }) {
  const steps = pipelineSteps(request);
  return (
    <ol className="track" aria-label="Approval progress">
      {steps.map((s) => (
        <li
          key={s.key}
          className={`track-step is-${s.state}`}
          aria-current={s.state === 'current' ? 'step' : undefined}
        >
          <span className="track-dot" aria-hidden="true" />
          <span className="track-label">{s.label}</span>
          {s.state === 'stopped' && <span className="sr-only"> (stopped here)</span>}
        </li>
      ))}
    </ol>
  );
}

export function Field({ label, htmlFor, hint, error, children }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <p className="field-error">{error}</p> : hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}
