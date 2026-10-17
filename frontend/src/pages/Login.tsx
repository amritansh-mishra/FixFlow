import { useState, type FormEvent, type ReactNode } from "react";
import { errorMessage } from "../api";
import { useAuth } from "../auth";
import { ErrorBox } from "../components/ui";

type Mode = "login" | "signup" | "join";

const DEMO_ACCOUNTS = [
  { email: "manager@example.com", role: "Manager", hint: "sees everything, assigns work" },
  { email: "technician@example.com", role: "Technician", hint: "works on assigned tickets" },
  { email: "resident@example.com", role: "Resident", hint: "reports problems" },
];

// "Sunrise Hostel!" → "sunrise-hostel" (same rule as the API).
function slugify(text: string) {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

export function LoginPage() {
  const [mode, setMode] = useState<Mode>("login");

  return (
    <main className="login-page">
      <section className="login-card card">
        <div className="brand brand-large">
          <span className="brand-mark" aria-hidden="true">✓</span> FixFlow
        </div>
        <p className="muted">Maintenance requests, from report to resolved.</p>

        <div className="tabs" role="tablist">
          <Tab active={mode === "login"} onClick={() => setMode("login")}>Sign in</Tab>
          <Tab active={mode === "signup"} onClick={() => setMode("signup")}>Create organization</Tab>
          <Tab active={mode === "join"} onClick={() => setMode("join")}>Join with code</Tab>
        </div>

        {mode === "login" && <SignInForm />}
        {mode === "signup" && <SignupForm />}
        {mode === "join" && <JoinForm />}
      </section>
    </main>
  );
}

function Tab(props: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="tab" aria-selected={props.active} className={`tab ${props.active ? "active" : ""}`} onClick={props.onClick}>
      {props.children}
    </button>
  );
}

// Shared submit handling: busy state and error message.
function useSubmit(run: () => Promise<void>) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await run();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }
  return { submit, error, busy };
}

function SignInForm() {
  const { login } = useAuth();
  const [organization, setOrganization] = useState("demo");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { submit, error, busy } = useSubmit(() => login(organization.trim(), email.trim(), password));

  return (
    <>
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
        <button className="button primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>

      <div className="demo-box">
        <strong>Try the demo</strong> (organization <code>demo</code>, password from the README):
        <ul>
          {DEMO_ACCOUNTS.map((account) => (
            <li key={account.email}>
              <button type="button" className="link" onClick={() => { setOrganization("demo"); setEmail(account.email); }}>
                {account.email}
              </button>{" "}
              <span className="muted">· {account.role}: {account.hint}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function SignupForm() {
  const { signup } = useAuth();
  const [organizationName, setOrganizationName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { submit, error, busy } = useSubmit(() =>
    signup({ organizationName: organizationName.trim(), organizationSlug: slug, name: name.trim(), email: email.trim(), password }),
  );

  return (
    <form onSubmit={submit} className="form">
      <p className="muted small form-intro">Set up FixFlow for your building, hostel or campus. You'll be its admin.</p>
      <label>
        Organization name
        <input
          value={organizationName}
          onChange={(e) => {
            setOrganizationName(e.target.value);
            if (!slugEdited) setSlug(slugify(e.target.value));
          }}
          required
          minLength={2}
          maxLength={150}
          placeholder="e.g. Sunrise Hostel"
        />
      </label>
      <label>
        Organization ID <span className="muted small">(used to sign in)</span>
        <input
          value={slug}
          onChange={(e) => {
            setSlug(e.target.value.toLowerCase());
            setSlugEdited(true);
          }}
          required
          minLength={3}
          maxLength={50}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          title="Lowercase letters, numbers and single hyphens"
          placeholder="sunrise-hostel"
        />
      </label>
      <label>
        Your name
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoComplete="name" />
      </label>
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
      </label>
      <label>
        Password <span className="muted small">(at least 12 characters)</span>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} maxLength={128} autoComplete="new-password" />
      </label>
      <ErrorBox message={error} />
      <button className="button primary" disabled={busy}>{busy ? "Creating…" : "Create organization"}</button>
    </form>
  );
}

function JoinForm() {
  const { join } = useAuth();
  const [joinCode, setJoinCode] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { submit, error, busy } = useSubmit(() =>
    join({ joinCode: joinCode.trim().toUpperCase(), name: name.trim(), email: email.trim(), password }),
  );

  return (
    <form onSubmit={submit} className="form">
      <p className="muted small form-intro">
        Your manager shares a join code. You'll join as a resident and can report problems straight away. (Demo code: <code>DEMO-2026</code>)
      </p>
      <label>
        Join code
        <input
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
          required
          placeholder="K7QM-3XPA"
          pattern="[A-Za-z0-9]{4}-[A-Za-z0-9]{4}"
          title="Looks like K7QM-3XPA"
          className="code-input"
        />
      </label>
      <label>
        Your name
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoComplete="name" />
      </label>
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
      </label>
      <label>
        Password <span className="muted small">(at least 12 characters)</span>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} maxLength={128} autoComplete="new-password" />
      </label>
      <ErrorBox message={error} />
      <button className="button primary" disabled={busy}>{busy ? "Joining…" : "Join"}</button>
    </form>
  );
}
