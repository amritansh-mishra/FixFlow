import { useState, type FormEvent } from "react";
import { errorMessage } from "../api";
import { useAuth } from "../auth";
import { ErrorBox } from "../components/ui";

const DEMO_ACCOUNTS = [
  { email: "manager@example.com", role: "Manager", hint: "sees everything, assigns work" },
  { email: "technician@example.com", role: "Technician", hint: "works on assigned tickets" },
  { email: "resident@example.com", role: "Resident", hint: "reports problems" },
];

export function LoginPage() {
  const { login } = useAuth();
  const [organization, setOrganization] = useState("demo");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(organization.trim(), email.trim(), password);
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
        <p className="muted">Maintenance requests, from report to resolved.</p>

        <form onSubmit={submit} className="form">
          <label>
            Organization
            <input value={organization} onChange={(e) => setOrganization(e.target.value)} required autoComplete="organization" />
          </label>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          </label>
          <ErrorBox message={error} />
          <button className="button primary" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="demo-box">
          <strong>Try the demo</strong> (organization <code>demo</code>, password from the README):
          <ul>
            {DEMO_ACCOUNTS.map((account) => (
              <li key={account.email}>
                <button type="button" className="link" onClick={() => setEmail(account.email)}>
                  {account.email}
                </button>{" "}
                <span className="muted">· {account.role}: {account.hint}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
