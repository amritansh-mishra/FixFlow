import { useState, type FormEvent } from "react";
import { api, errorMessage } from "../api";
import { useAuth } from "../auth";
import { ErrorBox } from "../components/ui";

export function AccountPage() {
  const { user, token } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setDone(false);
    // Catch typos before sending: a mistyped new password would lock you out.
    if (next !== confirm) return setError("The new passwords don't match.");
    setBusy(true);
    try {
      await api("/api/auth/password", { method: "POST", token, body: { currentPassword: current, newPassword: next } });
      setDone(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!user) return null;

  return (
    <div className="page narrow">
      <div className="page-header">
        <div>
          <h1>Account</h1>
          <p className="muted">
            {user.name} · {user.email} · {user.role}
          </p>
        </div>
      </div>

      <form className="card form" onSubmit={submit}>
        <h2>Change password</h2>
        <p className="muted small form-intro">
          If you were given a temporary password, replace it here. Your other devices will be logged out.
        </p>
        <label>
          Current password
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" />
        </label>
        <label>
          New password <span className="muted small">(at least 12 characters)</span>
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={12} maxLength={128} autoComplete="new-password" />
        </label>
        <label>
          Repeat new password
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
        </label>
        <ErrorBox message={error} />
        {done && <div className="success">Password changed. Other devices have been logged out.</div>}
        <button className="button primary" disabled={busy}>
          {busy ? "Saving…" : "Change password"}
        </button>
      </form>
    </div>
  );
}
