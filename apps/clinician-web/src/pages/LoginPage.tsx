import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const redirectTo = (location.state as { from?: string } | null)?.from ?? "/";

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(username, password);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-brand">
        <img className="login-brand__emblem" src={`${import.meta.env.BASE_URL}emblem.png`} alt="" width="300" height="259" />
        <h2 className="login-brand__title">
          PosturePulse <span>Pro</span>
        </h2>
        <p className="login-brand__line">Clinician-supervised posture measurement. Every value comes with its uncertainty, and the interpretation is yours.</p>
      </div>
      <form className="login-form" onSubmit={handleSubmit}>
        <h1>Clinician login</h1>
        <p className="page-caption">Sign in with the account your clinic administrator created for you.</p>
        <label>
          Username
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoFocus autoComplete="username" />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
        </label>
        {error && <p className="error-text" role="alert">{error}</p>}
        <button type="submit" disabled={submitting || !username || !password}>
          {submitting ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}
