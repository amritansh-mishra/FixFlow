import { useState, type FormEvent } from "react";
import { api, errorMessage, PRIORITIES, type Priority, type Ticket, type User } from "../api";
import { isManager, useAuth } from "../auth";
import { ErrorBox } from "./ui";

// Same rule as the API (tickets.policy.ts), used only to decide whether to
// show the Edit button. The server checks again.
export function canEditTicket(user: User | null, ticket: Ticket): boolean {
  if (!user) return false;
  if (isManager(user)) return ticket.status !== "closed";
  return ticket.createdBy === user.id && (ticket.status === "open" || ticket.status === "assigned");
}

export function EditTicketForm(props: { ticket: Ticket; onCancel: () => void; onSaved: () => Promise<void> }) {
  const { token } = useAuth();
  const [title, setTitle] = useState(props.ticket.title);
  const [description, setDescription] = useState(props.ticket.description ?? "");
  const [priority, setPriority] = useState<Priority>(props.ticket.priority);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    // Send only what changed.
    const changes: Record<string, unknown> = {};
    if (title.trim() !== props.ticket.title) changes.title = title.trim();
    if (description.trim() !== (props.ticket.description ?? "")) changes.description = description.trim() || null;
    if (priority !== props.ticket.priority) changes.priority = priority;
    if (Object.keys(changes).length === 0) return props.onCancel();

    setBusy(true);
    setError(null);
    try {
      await api(`/api/tickets/${props.ticket.id}`, { method: "PATCH", token, body: changes });
      await props.onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form className="form edit-form" onSubmit={submit}>
      <label>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
      </label>
      <label>
        Details
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} rows={4} />
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
      <ErrorBox message={error} />
      <div className="edit-actions">
        <button className="button primary" disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </button>
        <button type="button" className="button" onClick={props.onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
