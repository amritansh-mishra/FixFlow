// Business logic and database access for tickets. Knows nothing about HTTP.

import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { tickets, type TicketStatus } from "../../db/schema.js";

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
