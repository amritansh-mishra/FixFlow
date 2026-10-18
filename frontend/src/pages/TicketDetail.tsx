import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  api,
  ApiError,
  errorMessage,
  type Comment,
  type Property,
  type Stats,
  type Status,
  type Ticket,
  type TicketEvent,
  type User,
} from "../api";
import { isManager, useAuth } from "../auth";
import { TicketPhotos } from "../components/TicketPhotos";
import { ErrorBox, formatDate, PriorityBadge, Spinner, StatusBadge, statusLabel } from "../components/ui";

// The same rules the API enforces (tickets.policy.ts), used here only to
// decide which buttons to show. The server still checks every action.
function availableActions(user: User, ticket: Ticket): { to: Status; label: string }[] {
  const isAssignee = ticket.assignedTo === user.id;
  const isCreatorOrManager = ticket.createdBy === user.id || isManager(user);
  switch (ticket.status) {
    case "assigned":
      return isAssignee ? [{ to: "in_progress", label: "Start work" }] : [];
    case "in_progress":
      return isAssignee ? [{ to: "resolved", label: "Mark resolved" }] : [];
    case "resolved":
      return isCreatorOrManager
        ? [
            { to: "closed", label: "Confirm fixed & close" },
            { to: "in_progress", label: "Reopen" },
          ]
        : [];
    default:
      return [];
  }
}

export function TicketDetailPage({ id }: { id: string }) {
  const { token, user } = useAuth();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [events, setEvents] = useState<TicketEvent[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [technicians, setTechnicians] = useState<Stats["technicians"]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, h, c] = await Promise.all([
        api<{ data: Ticket }>(`/api/tickets/${id}`, { token }),
        api<{ data: TicketEvent[] }>(`/api/tickets/${id}/history`, { token }),
        api<{ data: Comment[] }>(`/api/tickets/${id}/comments`, { token }),
      ]);
      setTicket(t.data);
      setEvents(h.data);
      setComments(c.data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setNotFound(true);
      else setError(errorMessage(err));
    }
  }, [id, token]);

  useEffect(() => {
    void load();
    api<{ data: Property[] }>("/api/properties", { token })
      .then(({ data }) => setProperties(data))
      .catch(() => {});
    // Managers can see the technician list (used for assigning and names).
    if (isManager(user)) {
      api<{ data: Stats }>("/api/stats", { token })
        .then(({ data }) => setTechnicians(data.technicians))
        .catch(() => {});
    }
  }, [load, token, user]);

  // Best-effort names for people mentioned in the history.
  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of technicians) map.set(t.id, t.name);
    for (const c of comments) map.set(c.author.id, c.author.name);
    if (user) map.set(user.id, `${user.name} (you)`);
    return map;
  }, [technicians, comments, user]);
  const nameOf = (userId: string | null) => (userId ? (names.get(userId) ?? "a team member") : "nobody");

  async function act(run: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await run();
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (notFound) {
    return (
      <div className="page">
        <a href="#/tickets" className="back">← All tickets</a>
        <p className="empty">This ticket doesn't exist, or you don't have access to it.</p>
      </div>
    );
  }
  if (!ticket || !user) return <div className="page"><Spinner /></div>;

  const property = properties.find((p) => p.id === ticket.propertyId);
  const actions = availableActions(user, ticket);
  const canAssign = isManager(user) && (ticket.status === "open" || ticket.status === "assigned");

  return (
    <div className="page">
      <a href="#/tickets" className="back">← All tickets</a>

      <div className="detail-grid">
        <section className="card ticket-detail">
          <div className="ticket-badges">
            <StatusBadge status={ticket.status} />
            <PriorityBadge priority={ticket.priority} />
          </div>
          <h1>{ticket.title}</h1>
          {ticket.description && <p className="description">{ticket.description}</p>}
          <dl className="facts">
            <dt>Location</dt>
            <dd>{property?.name ?? "…"}</dd>
            <dt>Reported</dt>
            <dd>
              {formatDate(ticket.createdAt)} by {nameOf(ticket.createdBy)}
            </dd>
            <dt>Assigned to</dt>
            <dd>{ticket.assignedTo ? nameOf(ticket.assignedTo) : "Not assigned yet"}</dd>
          </dl>

          <ErrorBox message={error} />

          {(actions.length > 0 || canAssign) && (
            <div className="actions">
              {actions.map((action) => (
                <button
                  key={action.to}
                  className={`button ${action.to === "in_progress" && ticket.status === "resolved" ? "" : "primary"}`}
                  disabled={busy}
                  onClick={() =>
                    act(() => api(`/api/tickets/${id}/status`, { method: "PATCH", token, body: { status: action.to } }))
                  }
                >
                  {action.label}
                </button>
              ))}
              {canAssign && (
                <AssignControl
                  technicians={technicians}
                  current={ticket.assignedTo}
                  busy={busy}
                  onAssign={(technicianId) =>
                    act(() => api(`/api/tickets/${id}/assign`, { method: "PATCH", token, body: { technicianId } }))
                  }
                />
              )}
            </div>
          )}

          <TicketPhotos ticketId={id} />

          <CommentsSection
            comments={comments}
            onPost={(body) => act(() => api(`/api/tickets/${id}/comments`, { method: "POST", token, body: { body } }))}
            busy={busy}
          />
        </section>

        <aside className="card">
          <h2>History</h2>
          <ol className="timeline">
            {events.map((event) => (
              <li key={event.id}>
                <span className="timeline-text">{describeEvent(event, nameOf)}</span>
                <span className="muted small">{formatDate(event.createdAt)}</span>
              </li>
            ))}
            {events.length === 0 && <li className="muted">No history recorded.</li>}
          </ol>
        </aside>
      </div>
    </div>
  );
}

function describeEvent(event: TicketEvent, nameOf: (id: string | null) => string) {
  const who = nameOf(event.actorId);
  switch (event.type) {
    case "created":
      return `${who} reported the problem`;
    case "assigned":
      return `${who} assigned it to ${nameOf(event.assignedTo)}`;
    case "commented":
      return `${who} commented`;
    case "status_changed":
      return `${who} moved it from ${statusLabel(event.fromStatus!)} to ${statusLabel(event.toStatus!)}`;
  }
}

function AssignControl(props: {
  technicians: Stats["technicians"];
  current: string | null;
  busy: boolean;
  onAssign: (technicianId: string) => void;
}) {
  const [choice, setChoice] = useState(props.current ?? props.technicians[0]?.id ?? "");
  useEffect(() => {
    if (!choice && props.technicians[0]) setChoice(props.technicians[0].id);
  }, [props.technicians, choice]);

  return (
    <div className="assign">
      <select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Technician">
        {props.technicians.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} · {t.active} active
          </option>
        ))}
      </select>
      <button className="button primary" disabled={props.busy || !choice} onClick={() => props.onAssign(choice)}>
        {props.current ? "Reassign" : "Assign"}
      </button>
    </div>
  );
}

function CommentsSection(props: { comments: Comment[]; onPost: (body: string) => Promise<void>; busy: boolean }) {
  const [body, setBody] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    await props.onPost(body.trim());
    setBody("");
  }

  return (
    <section className="comments">
      <h2>Comments</h2>
      {props.comments.length === 0 && <p className="muted">No comments yet.</p>}
      <ul>
        {props.comments.map((c) => (
          <li key={c.id} className="comment">
            <div className="comment-head">
              <strong>{c.author.name}</strong> <span className="muted small">· {c.author.role} · {formatDate(c.createdAt)}</span>
            </div>
            <p>{c.body}</p>
          </li>
        ))}
      </ul>
      <form onSubmit={submit} className="comment-form">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write a comment…"
          maxLength={2000}
          rows={2}
          aria-label="Comment"
        />
        <button className="button" disabled={props.busy || !body.trim()}>
          Post
        </button>
      </form>
    </section>
  );
}
