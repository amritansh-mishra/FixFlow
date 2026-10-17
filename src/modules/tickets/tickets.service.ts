// Business logic and database access for tickets. Knows nothing about HTTP
// requests, but throws HttpError for rule violations the caller should see.

import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  properties,
  ticketComments,
  ticketEvents,
  tickets,
  users,
  type Ticket,
  type TicketStatus,
} from "../../db/schema.js";
import type { AuthContext } from "../../middleware/auth.js";
import { HttpError } from "../../middleware/errors.js";
import { canAssign, findTransition, isAssignable, ticketScope } from "./tickets.policy.js";
import type { CreateTicketBody } from "./tickets.schemas.js";

export interface ListTicketsOptions {
  status?: TicketStatus | undefined;
  limit: number;
}

// SQL condition for "tickets this user may see": their organization, narrowed
// by role (see ticketScope in tickets.policy.ts). Every ticket query uses it.
function visibleTo(auth: AuthContext) {
  const scope = ticketScope(auth);
  return and(
    // Always scope to the caller's organization: this is the tenant boundary.
    eq(tickets.organizationId, auth.organizationId),
    scope === "all" ? undefined : eq(tickets[scope], auth.userId),
  );
}

export async function listTickets(auth: AuthContext, options: ListTicketsOptions) {
  return db
    .select()
    .from(tickets)
    .where(
      and(
        visibleTo(auth),
        // and() skips undefined, so the status filter is optional.
        options.status ? eq(tickets.status, options.status) : undefined,
      ),
    )
    // id breaks ties so the order is stable when two tickets share a timestamp.
    .orderBy(desc(tickets.createdAt), desc(tickets.id))
    .limit(options.limit);
}

// Returns null when the ticket doesn't exist OR the user may not see it
// (another organization, or outside their role's scope). Callers can't tell
// these apart, which is intentional.
export async function getTicket(auth: AuthContext, ticketId: string) {
  const [ticket] = await db
    .select()
    .from(tickets)
    .where(and(eq(tickets.id, ticketId), visibleTo(auth)));
  return ticket ?? null;
}

async function getTicketOr404(auth: AuthContext, ticketId: string): Promise<Ticket> {
  const ticket = await getTicket(auth, ticketId);
  if (!ticket) throw new HttpError(404, "TICKET_NOT_FOUND", "Ticket not found");
  return ticket;
}

export async function createTicket(auth: AuthContext, input: CreateTicketBody) {
  // The database's composite foreign key would also reject a property from
  // another organization, but checking here gives the client a clear 400
  // instead of a database error.
  const [property] = await db
    .select({ id: properties.id })
    .from(properties)
    .where(and(eq(properties.id, input.propertyId), eq(properties.organizationId, auth.organizationId)));
  if (!property) {
    throw new HttpError(400, "VALIDATION_ERROR", "Invalid request body", [
      { path: "propertyId", message: "Property not found" },
    ]);
  }

  // The ticket and its 'created' event are saved together or not at all.
  return db.transaction(async (tx) => {
    const [ticket] = await tx
      .insert(tickets)
      .values({
        organizationId: auth.organizationId,
        createdBy: auth.userId,
        propertyId: input.propertyId,
        title: input.title,
        description: input.description ?? null,
        // Omitted priority falls back to the database default ('medium').
        ...(input.priority && { priority: input.priority }),
      })
      .returning();
    await tx.insert(ticketEvents).values({
      organizationId: auth.organizationId,
      ticketId: ticket!.id,
      actorId: auth.userId,
      type: "created",
      toStatus: ticket!.status,
    });
    return ticket!;
  });
}

// Optimistic concurrency: the UPDATE only succeeds if the ticket still looks
// the way it did when we checked the rules. If someone changed it in between,
// zero rows match and we report a conflict instead of overwriting their change.
function unchangedSince(ticket: Ticket) {
  return and(
    eq(tickets.id, ticket.id),
    eq(tickets.organizationId, ticket.organizationId),
    eq(tickets.status, ticket.status),
    ticket.assignedTo === null ? isNull(tickets.assignedTo) : eq(tickets.assignedTo, ticket.assignedTo),
  );
}

const CONFLICT = () =>
  new HttpError(409, "CONFLICT", "The ticket was changed by someone else. Reload it and try again.");

export async function assignTicket(auth: AuthContext, ticketId: string, technicianId: string) {
  const ticket = await getTicketOr404(auth, ticketId);
  if (!canAssign(auth)) {
    throw new HttpError(403, "FORBIDDEN", "Only managers and admins can assign tickets");
  }

  const [technician] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, technicianId),
        eq(users.organizationId, auth.organizationId),
        eq(users.role, "technician"),
      ),
    );
  if (!technician) {
    throw new HttpError(400, "VALIDATION_ERROR", "Invalid request body", [
      { path: "technicianId", message: "Technician not found" },
    ]);
  }

  if (!isAssignable(ticket.status)) {
    throw new HttpError(409, "INVALID_TRANSITION", `Cannot assign a ticket that is ${ticket.status}`);
  }

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(tickets)
      .set({ assignedTo: technicianId, status: "assigned" })
      .where(unchangedSince(ticket))
      .returning();
    if (!updated) throw CONFLICT();

    await tx.insert(ticketEvents).values({
      organizationId: auth.organizationId,
      ticketId: ticket.id,
      actorId: auth.userId,
      type: "assigned",
      fromStatus: ticket.status,
      toStatus: "assigned",
      assignedTo: technicianId,
    });
    return updated;
  });
}

export async function changeTicketStatus(auth: AuthContext, ticketId: string, to: TicketStatus) {
  const ticket = await getTicketOr404(auth, ticketId);

  const rule = findTransition(ticket.status, to);
  if (!rule) {
    throw new HttpError(409, "INVALID_TRANSITION", `Cannot change status from ${ticket.status} to ${to}`);
  }
  if (!rule(auth, ticket)) {
    throw new HttpError(403, "FORBIDDEN", "You are not allowed to make this change");
  }

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(tickets)
      .set({ status: to })
      .where(unchangedSince(ticket))
      .returning();
    if (!updated) throw CONFLICT();

    await tx.insert(ticketEvents).values({
      organizationId: auth.organizationId,
      ticketId: ticket.id,
      actorId: auth.userId,
      type: "status_changed",
      fromStatus: ticket.status,
      toStatus: to,
    });
    return updated;
  });
}

export async function getTicketHistory(auth: AuthContext, ticketId: string) {
  await getTicketOr404(auth, ticketId);
  return db
    .select()
    .from(ticketEvents)
    .where(and(eq(ticketEvents.organizationId, auth.organizationId), eq(ticketEvents.ticketId, ticketId)))
    .orderBy(asc(ticketEvents.createdAt), asc(ticketEvents.id));
}

const commentFields = {
  id: ticketComments.id,
  ticketId: ticketComments.ticketId,
  body: ticketComments.body,
  createdAt: ticketComments.createdAt,
  author: { id: users.id, name: users.name, role: users.role },
};

export async function listComments(auth: AuthContext, ticketId: string) {
  await getTicketOr404(auth, ticketId);
  return db
    .select(commentFields)
    .from(ticketComments)
    .innerJoin(users, and(eq(users.id, ticketComments.authorId), eq(users.organizationId, ticketComments.organizationId)))
    .where(and(eq(ticketComments.organizationId, auth.organizationId), eq(ticketComments.ticketId, ticketId)))
    .orderBy(asc(ticketComments.createdAt), asc(ticketComments.id));
}

// Anyone who can see the ticket can comment on it. The comment and its
// history entry are saved together.
export async function addComment(auth: AuthContext, ticketId: string, body: string) {
  await getTicketOr404(auth, ticketId);
  const id = await db.transaction(async (tx) => {
    const [comment] = await tx
      .insert(ticketComments)
      .values({ organizationId: auth.organizationId, ticketId, authorId: auth.userId, body })
      .returning({ id: ticketComments.id });
    await tx.insert(ticketEvents).values({
      organizationId: auth.organizationId,
      ticketId,
      actorId: auth.userId,
      type: "commented",
    });
    return comment!.id;
  });
  const [comment] = await db
    .select(commentFields)
    .from(ticketComments)
    .innerJoin(users, eq(users.id, ticketComments.authorId))
    .where(eq(ticketComments.id, id));
  return comment!;
}
