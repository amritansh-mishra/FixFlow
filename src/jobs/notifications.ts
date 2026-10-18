// Turns a notification job into notification rows: works out who should be
// told, writes the message, and saves it. Run by the worker; tests call it
// directly.

import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { notifications, tickets, users, type NotificationType, type TicketStatus } from "../db/schema.js";
import type { TicketNotificationJob } from "./queue.js";

const STATUS_LABELS: Record<TicketStatus, string> = {
  open: "Open",
  assigned: "Assigned",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};

// Returns the IDs of the notifications it created (none if they already
// existed from an earlier attempt of the same job).
export async function processNotificationJob(job: TicketNotificationJob): Promise<string[]> {
  const [ticket] = await db
    .select({ title: tickets.title, createdBy: tickets.createdBy, assignedTo: tickets.assignedTo })
    .from(tickets)
    .where(and(eq(tickets.id, job.ticketId), eq(tickets.organizationId, job.organizationId)));
  const [actor] = await db
    .select({ name: users.name })
    .from(users)
    .where(and(eq(users.id, job.actorId), eq(users.organizationId, job.organizationId)));
  // The ticket or person doesn't exist. Normally impossible (jobs are queued
  // after the change is saved), so say so loudly: it usually means this
  // worker is connected to a different database than the API that queued it.
  if (!ticket || !actor) {
    console.warn(
      `[worker] ${job.kind}: ${!ticket ? `ticket ${job.ticketId}` : `user ${job.actorId}`} not found ` +
        `in organization ${job.organizationId}; skipping. Is this worker using the same database as the API?`,
    );
    return [];
  }

  let type: NotificationType;
  let message: string;
  let recipients: (string | null)[];
  switch (job.kind) {
    case "ticket_assigned":
      type = "ticket_assigned";
      message = `${actor.name} assigned you "${ticket.title}"`;
      recipients = [job.technicianId];
      break;
    case "status_changed":
      type = "status_changed";
      message = `${actor.name} moved "${ticket.title}" to ${STATUS_LABELS[job.toStatus]}`;
      // The person who reported it, and the technician working on it.
      recipients = [ticket.createdBy, ticket.assignedTo];
      break;
    case "comment_added":
      type = "comment_added";
      message = `${actor.name} commented on "${ticket.title}"`;
      recipients = [ticket.createdBy, ticket.assignedTo];
      break;
  }

  // Never notify people about their own actions, and only once each.
  const userIds = [...new Set(recipients)].filter((id): id is string => !!id && id !== job.actorId);
  if (userIds.length === 0) return [];

  const inserted = await db
    .insert(notifications)
    .values(
      userIds.map((userId) => ({
        organizationId: job.organizationId,
        userId,
        actorId: job.actorId,
        ticketId: job.ticketId,
        type,
        message,
        // Same event + same person = same key. If BullMQ retries this job, the
        // rows already saved are skipped instead of duplicated (idempotency).
        dedupeKey: `${job.eventId}:${userId}`,
      })),
    )
    .onConflictDoNothing({ target: notifications.dedupeKey })
    .returning({ id: notifications.id });
  return inserted.map((row) => row.id);
}
