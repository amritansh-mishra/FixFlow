import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, errorMessage, PRIORITIES, STATUSES, type Priority, type Property, type Ticket } from "../api";
import { useAuth } from "../auth";
import { ErrorBox, PriorityBadge, Spinner, StatusBadge, statusLabel, timeAgo } from "../components/ui";
import { navigate } from "../router";

interface Filters {
  q: string;
  status: string;
  priority: string;
}

function queryString(filters: Filters, cursor?: string) {
  const params = new URLSearchParams({ limit: "20" });
  if (filters.q) params.set("q", filters.q);
  if (filters.status) params.set("status", filters.status);
  if (filters.priority) params.set("priority", filters.priority);
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

export function TicketsPage() {
  const { token, user } = useAuth();
  const [filters, setFilters] = useState<Filters>({ q: "", status: "", priority: "" });
  const [search, setSearch] = useState("");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await api<{ data: Ticket[]; nextCursor: string | null }>(
          `/api/tickets?${queryString(filters, cursor)}`,
          { token },
        );
        setTickets((current) => (cursor ? [...current, ...res.data] : res.data));
        setNextCursor(res.nextCursor);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoading(false);
      }
    },
    [filters, token],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const scopeText =
    user?.role === "resident"
      ? "Tickets you reported"
      : user?.role === "technician"
        ? "Tickets assigned to you"
        : "All tickets in your organization";

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Tickets</h1>
          <p className="muted">{scopeText}</p>
        </div>
        <button className="button primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ New ticket"}
        </button>
      </div>

      {showForm && (
        <NewTicketForm
          onCreated={(ticket) => {
            setShowForm(false);
            navigate(`/tickets/${ticket.id}`);
          }}
        />
      )}

      <form
        className="toolbar card"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters((f) => ({ ...f, q: search.trim() }));
        }}
      >
        <input
          className="grow"
          placeholder="Search title or description…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search"
        />
        <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} aria-label="Status">
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
        <select value={filters.priority} onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))} aria-label="Priority">
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button className="button">Search</button>
      </form>

      <ErrorBox message={error} />

      <ul className="ticket-list">
        {tickets.map((ticket) => (
          <li key={ticket.id}>
            <a className="ticket-row card" href={`#/tickets/${ticket.id}`}>
              <div className="ticket-main">
                <span className="ticket-title">{ticket.title}</span>
                <span className="muted small">Reported {timeAgo(ticket.createdAt)}</span>
              </div>
              <div className="ticket-badges">
                <PriorityBadge priority={ticket.priority} />
                <StatusBadge status={ticket.status} />
              </div>
            </a>
          </li>
        ))}
      </ul>

      {loading && <Spinner />}
      {!loading && tickets.length === 0 && !error && <p className="empty">No tickets match.</p>}
      {!loading && nextCursor && (
        <button className="button wide" onClick={() => void load(nextCursor)}>
          Load more
        </button>
      )}
    </div>
  );
}

function NewTicketForm({ onCreated }: { onCreated: (ticket: Ticket) => void }) {
  const { token } = useAuth();
  const [properties, setProperties] = useState<Property[]>([]);
  const [propertyId, setPropertyId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ data: Property[] }>("/api/properties", { token })
      .then(({ data }) => {
        setProperties(data);
        if (data[0]) setPropertyId(data[0].id);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data } = await api<{ data: Ticket }>("/api/tickets", {
        method: "POST",
        token,
        body: { propertyId, title, priority, ...(description.trim() && { description }) },
      });
      onCreated(data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form new-ticket" onSubmit={submit}>
      <h2>Report a problem</h2>
      <div className="form-row">
        <label className="grow">
          Where?
          <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)} required>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Priority
          <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        What's wrong?
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required placeholder="e.g. Leaking tap in Room 204" />
      </label>
      <label>
        Details (optional)
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} rows={3} />
      </label>
      <ErrorBox message={error} />
      <button className="button primary" disabled={busy || !propertyId}>
        {busy ? "Submitting…" : "Submit ticket"}
      </button>
    </form>
  );
}
