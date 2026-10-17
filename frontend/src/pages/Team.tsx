import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, errorMessage, type Property, type Role } from "../api";
import { useAuth } from "../auth";
import { ErrorBox, formatDate, Spinner } from "../components/ui";

interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
}

interface Organization {
  name: string;
  slug: string;
  joinCode?: string | null;
}

export function TeamPage() {
  const { token, user } = useAuth();
  const [org, setOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [o, m, p] = await Promise.all([
        api<{ data: Organization }>("/api/organization", { token }),
        api<{ data: Member[] }>("/api/users", { token }),
        api<{ data: Property[] }>("/api/properties", { token }),
      ]);
      setOrg(o.data);
      setMembers(m.data);
      setProperties(p.data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <div className="page"><ErrorBox message={error} /></div>;
  if (!org || !user) return <div className="page"><Spinner /></div>;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Team</h1>
          <p className="muted">
            {org.name} · sign-in ID <code>{org.slug}</code>
          </p>
        </div>
      </div>

      <JoinCodeCard code={org.joinCode ?? null} onChanged={(joinCode) => setOrg({ ...org, joinCode })} />

      <div className="detail-grid">
        <section className="card">
          <h2>People ({members.length})</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td>{m.name}{m.id === user.id && <span className="muted"> (you)</span>}</td>
                  <td className="muted">{m.email}</td>
                  <td><span className="badge">{m.role}</span></td>
                  <td className="muted small">{formatDate(m.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <div className="stack">
          <AddPersonForm myRole={user.role} onAdded={load} />
          <PropertiesCard properties={properties} onAdded={load} />
        </div>
      </div>
    </div>
  );
}

function JoinCodeCard({ code, onChanged }: { code: string | null; onChanged: (code: string) => void }) {
  const { token } = useAuth();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function regenerate() {
    if (code && !window.confirm("Make a new join code? The current one will stop working.")) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await api<{ data: { joinCode: string } }>("/api/organization/join-code", { method: "POST", token });
      onChanged(data.joinCode);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable: the code is visible to copy by hand.
    }
  }

  return (
    <section className="card join-card">
      <div>
        <h2>Join code</h2>
        <p className="muted small">Share it with residents so they can sign up and join your organization.</p>
      </div>
      <div className="join-actions">
        {code ? <code className="join-code">{code}</code> : <span className="muted">No code yet</span>}
        {code && (
          <button className="button small" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy"}
          </button>
        )}
        <button className="button small" onClick={() => void regenerate()} disabled={busy}>
          {code ? "New code" : "Create code"}
        </button>
      </div>
      <ErrorBox message={error} />
    </section>
  );
}

function AddPersonForm({ myRole, onAdded }: { myRole: Role; onAdded: () => Promise<void> }) {
  const { token } = useAuth();
  // Same rule as the API: managers add residents and technicians; admins add anyone.
  const roles: Role[] = myRole === "admin" ? ["resident", "technician", "manager", "admin"] : ["resident", "technician"];
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("technician");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setAdded(null);
    try {
      await api("/api/users", { method: "POST", token, body: { name: name.trim(), email: email.trim(), role, password } });
      setAdded(`${name.trim()} can now sign in with ${email.trim().toLowerCase()} and the temporary password.`);
      setName("");
      setEmail("");
      setPassword("");
      await onAdded();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h2>Add a person</h2>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
      </label>
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        Role
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {roles.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </label>
      <label>
        Temporary password <span className="muted small">(12+ characters, share it privately)</span>
        <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} maxLength={128} autoComplete="off" />
      </label>
      <ErrorBox message={error} />
      {added && <div className="success">{added}</div>}
      <button className="button primary" disabled={busy}>{busy ? "Adding…" : "Add person"}</button>
    </form>
  );
}

function PropertiesCard({ properties, onAdded }: { properties: Property[]; onAdded: () => Promise<void> }) {
  const { token } = useAuth();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/properties", {
        method: "POST",
        token,
        body: { name: name.trim(), ...(address.trim() && { address: address.trim() }) },
      });
      setName("");
      setAddress("");
      await onAdded();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Properties</h2>
      <ul className="plain-list">
        {properties.map((p) => (
          <li key={p.id}>
            <strong>{p.name}</strong>
            {p.address && <span className="muted small"> · {p.address}</span>}
          </li>
        ))}
      </ul>
      <form className="form" onSubmit={submit}>
        <div className="form-row">
          <input className="grow" value={name} onChange={(e) => setName(e.target.value)} placeholder="New property, e.g. Block B" required maxLength={150} aria-label="Property name" />
          <input className="grow" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address (optional)" maxLength={500} aria-label="Address" />
        </div>
        <ErrorBox message={error} />
        <button className="button" disabled={busy}>{busy ? "Adding…" : "Add property"}</button>
      </form>
    </section>
  );
}
