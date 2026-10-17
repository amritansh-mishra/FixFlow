// Business logic and database access for tickets. Knows nothing about HTTP.

import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { properties, tickets, type TicketStatus } from "../../db/schema.js";
import { HttpError } from "../../middleware/errors.js";
import type { CreateTicketBody } from "./tickets.schemas.js";

export interface ListTicketsOptions {
  status?: TicketStatus | undefined;
  limit: number;
}

export async function listTickets(organizationId: string, options: ListTicketsOptions) {
  return db
    .select()
    .from(tickets)
    .where(
      and(
        // Always scope to the caller's organization: this is the tenant boundary.
        eq(tickets.organizationId, organizationId),
        // and() skips undefined, so the status filter is optional.
        options.status ? eq(tickets.status, options.status) : undefined,
      ),
    )
    // id breaks ties so the order is stable when two tickets share a timestamp.
    .orderBy(desc(tickets.createdAt), desc(tickets.id))
    .limit(options.limit);
}

// Returns null when the ticket doesn't exist OR belongs to another
// organization. Callers can't tell the two apart, which is intentional.
export async function getTicket(organizationId: string, ticketId: string) {
  const [ticket] = await db
    .select()
    .from(tickets)
    .where(and(eq(tickets.id, ticketId), eq(tickets.organizationId, organizationId)));
  return ticket ?? null;
}

export async function createTicket(
  organizationId: string,
  createdBy: string,
  input: CreateTicketBody,
) {
  // The database's composite foreign key would also reject a property from
  // another organization, but checking here gives the client a clear 400
  // instead of a database error.
  const [property] = await db
    .select({ id: properties.id })
    .from(properties)
    .where(and(eq(properties.id, input.propertyId), eq(properties.organizationId, organizationId)));
  if (!property) {
    throw new HttpError(400, "VALIDATION_ERROR", "Invalid request body", [
      { path: "propertyId", message: "Property not found" },
    ]);
  }

  const [ticket] = await db
    .insert(tickets)
    .values({
      organizationId,
      createdBy,
      propertyId: input.propertyId,
      title: input.title,
      description: input.description ?? null,
      // Omitted priority falls back to the database default ('medium').
      ...(input.priority && { priority: input.priority }),
    })
    .returning();
  return ticket!;
}
