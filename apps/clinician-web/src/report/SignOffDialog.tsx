import { useId, useRef, useState, type FormEvent } from "react";
import "./report.css";

interface SignOffDialogProps {
  /** Resolves when backend-api has accepted the sign-off; rejects with a message otherwise. */
  onSubmit: (password: string) => Promise<void>;
  onCancel: () => void;
}

/**
 * Sign-off re-verifies the clinician's password (spec slice B). The request
 * is sent at most once per attempt: a ref guards against double submits that
 * arrive before React has re-rendered the disabled button.
 */
export function SignOffDialog({ onSubmit, onCancel }: SignOffDialogProps) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const titleId = useId();
  const inputId = useId();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || !password) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-off failed.");
      setPassword("");
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="report-dialog-backdrop">
      <div className="report-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>Sign off this report</h2>
        <p className="page-caption">
          Signing off releases this version to the patient exactly as shown. Excluded rows stay in the record
          with your reason. Enter your password to confirm.
        </p>
        <form className="report-form" onSubmit={handleSubmit}>
          <label htmlFor={inputId}>Your password</label>
          <input
            id={inputId}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus
          />
          {error && <p className="error-text">{error}</p>}
          <div className="report-actions">
            <button type="submit" className="report-button report-button--primary" disabled={submitting || !password}>
              {submitting ? "Signing off..." : "Sign off and release"}
            </button>
            <button type="button" className="report-button" onClick={onCancel} disabled={submitting}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
