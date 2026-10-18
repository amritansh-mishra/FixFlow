// DataLoaders: batch the database lookups made while resolving one GraphQL
// request, to avoid the "N+1 queries" problem.
//
// Without them, listing 50 tickets with their reporter's name runs 1 query
// for the list plus 50 for the reporters. A DataLoader collects every ID
// requested during the same tick and fetches them in ONE query
// (WHERE id IN (...)), then hands each resolver its own result.
//
// A new set of loaders is created for EVERY request, scoped to the caller's
// organization, so cached results are never shared between users.

import DataLoader from "dataloader";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  properties,
  ticketAttachments,
  ticketComments,
  ticketEvents,
  users,
  type TicketAttachment,
  type TicketComment,
  type TicketEvent,
  type UserRole,
} from "../db/schema.js";
import type { AuthContext } from "../middleware/auth.js";

export interface UserRow {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  role: UserRole;
}

// Looks up rows by ID and returns them in the order DataLoader asked for.
function byId<T extends { id: string }>(ids: readonly string[], rows: T[]): (T | null)[] {
  const map = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => map.get(id) ?? null);
}

// Groups child rows (comments, events, photos) under their ticket.
function byTicket<T extends { ticketId: string }>(ticketIds: readonly string[], rows: T[]): T[][] {
  const groups = new Map<string, T[]>(ticketIds.map((id) => [id, []]));
  for (const row of rows) groups.get(row.ticketId)?.push(row);
  return ticketIds.map((id) => groups.get(id)!);
}

export function createLoaders(auth: AuthContext) {
  const org = auth.organizationId;
  return {
    user: new DataLoader<string, UserRow | null>(async (ids) =>
      byId(
        ids,
        await db
          .select({ id: users.id, organizationId: users.organizationId, name: users.name, email: users.email, role: users.role })
          .from(users)
          .where(and(eq(users.organizationId, org), inArray(users.id, [...ids]))),
      ),
    ),
    property: new DataLoader<string, { id: string; name: string; address: string | null } | null>(async (ids) =>
      byId(
        ids,
        await db
          .select({ id: properties.id, name: properties.name, address: properties.address })
          .from(properties)
          .where(and(eq(properties.organizationId, org), inArray(properties.id, [...ids]))),
      ),
    ),
    comments: new DataLoader<string, TicketComment[]>(async (ticketIds) =>
      byTicket(
        ticketIds,
        await db
          .select()
          .from(ticketComments)
          .where(and(eq(ticketComments.organizationId, org), inArray(ticketComments.ticketId, [...ticketIds])))
          .orderBy(asc(ticketComments.createdAt), asc(ticketComments.id)),
      ),
    ),
    history: new DataLoader<string, TicketEvent[]>(async (ticketIds) =>
      byTicket(
        ticketIds,
        await db
          .select()
          .from(ticketEvents)
          .where(and(eq(ticketEvents.organizationId, org), inArray(ticketEvents.ticketId, [...ticketIds])))
          .orderBy(asc(ticketEvents.createdAt), asc(ticketEvents.id)),
      ),
    ),
    photos: new DataLoader<string, TicketAttachment[]>(async (ticketIds) =>
      byTicket(
        ticketIds,
        await db
          .select()
          .from(ticketAttachments)
          .where(and(eq(ticketAttachments.organizationId, org), inArray(ticketAttachments.ticketId, [...ticketIds])))
          .orderBy(asc(ticketAttachments.createdAt), asc(ticketAttachments.id)),
      ),
    ),
  };
}

export type Loaders = ReturnType<typeof createLoaders>;
