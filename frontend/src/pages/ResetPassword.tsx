// Opened from the "reset your password" email: #/reset-password?token=...
// Works while logged out.

import { useState, type FormEvent } from "react";
import { api, errorMessage } from "../api";
import { ErrorBox } from "../components/ui";

export function ResetPasswordPage({ token }: { token: string | null }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirm) return setError("The passwords don't match.");
    setBusy(true);
    try {
      await api("/api/auth/reset-password", { method: "POST", body: { token, newPassword: password } });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card card">
        <div className="brand brand-large">
          <span className="brand-mark" aria-hidden="true">✓</span> FixFlow
        </div>
        <h2>Choose a new password</h2>

        {!token ? (
          <ErrorBox message="This link is missing its reset code. Open the link from the email again." />
        ) : done ? (
          <>
            <div className="success">Your password has been reset. You've been logged out everywhere.</div>
            <a className="button primary wide" href="#/">Go to sign in</a>
          </>
        ) : (
          <form className="form" onSubmit={submit}>
            <label>
              New password <span className="muted small">(at least 12 characters)</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} maxLength={128} autoComplete="new-password" />
            </label>
            <label>
              Repeat new password
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
            </label>
            <ErrorBox message={error} />
            <button className="button primary" disabled={busy}>
              {busy ? "Saving…" : "Reset password"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
