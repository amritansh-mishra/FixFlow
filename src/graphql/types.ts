// GraphQL types and read-only queries. Every resolver calls the same
// services as the REST API, so organization isolation, visibility and
// permissions are reused, not reimplemented.

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import {
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  USER_ROLES,
  users,
  type Ticket,
  type TicketPriority,
  type TicketStatus,
  type UserRole,
} from "../db/schema.js";
import { getTicket, listTickets } from "../modules/tickets/tickets.service.js";
import { HttpError } from "../middleware/errors.js";
import { builder, requireAuth } from "./builder.js";

// IDs are UUIDs; anything else is a client mistake (400), not a database error.
export function uuidArg(value: string | number, name: string): string {
  const parsed = z.uuid().safeParse(String(value));
  if (!parsed.success) throw new HttpError(400, "VALIDATION_ERROR", `${name} must be a valid ID`);
  return parsed.data;
}

export const TicketStatusEnum = builder.enumType("TicketStatus", { values: TICKET_STATUSES });
export const TicketPriorityEnum = builder.enumType("TicketPriority", { values: TICKET_PRIORITIES });
export const UserRoleEnum = builder.enumType("UserRole", { values: USER_ROLES });

export interface UserShape {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  role: UserRole;
}

export const UserType = builder.objectRef<UserShape>("User").implement({
  fields: (t) => ({
    id: t.exposeID("id"),
    name: t.exposeString("name"),
    email: t.exposeString("email"),
    role: t.expose("role", { type: UserRoleEnum }),
  }),
});

export const TicketType = builder.objectRef<Ticket>("Ticket").implement({
  fields: (t) => ({
    id: t.exposeID("id"),
    title: t.exposeString("title"),
    description: t.exposeString("description", { nullable: true }),
    status: t.expose("status", { type: TicketStatusEnum }),
    priority: t.expose("priority", { type: TicketPriorityEnum }),
    propertyId: t.exposeID("propertyId"),
    createdById: t.exposeID("createdBy"),
    assignedToId: t.exposeID("assignedTo", { nullable: true }),
    createdAt: t.expose("createdAt", { type: "DateTime" }),
    updatedAt: t.expose("updatedAt", { type: "DateTime" }),
  }),
});

// One page of tickets: pass nextCursor back as `after` for the next page.
const TicketPage = builder
  .objectRef<{ nodes: Ticket[]; nextCursor: string | null }>("TicketPage")
  .implement({
    fields: (t) => ({
      nodes: t.field({ type: [TicketType], resolve: (page) => page.nodes }),
      nextCursor: t.exposeID("nextCursor", { nullable: true }),
    }),
  });

builder.queryFields((t) => ({
  me: t.field({
    type: UserType,
    resolve: async (_root, _args, ctx) => {
      const auth = requireAuth(ctx);
      const [user] = await db
        .select({ id: users.id, organizationId: users.organizationId, name: users.name, email: users.email, role: users.role })
        .from(users)
        .where(and(eq(users.id, auth.userId), eq(users.organizationId, auth.organizationId)));
      return user!;
    },
  }),

  ticket: t.field({
    type: TicketType,
    args: { id: t.arg.id({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const ticket = await getTicket(requireAuth(ctx), uuidArg(args.id, "id"));
      // Same answer for "doesn't exist" and "not yours to see", as in REST.
      if (!ticket) throw new HttpError(404, "TICKET_NOT_FOUND", "Ticket not found");
      return ticket;
    },
  }),

  tickets: t.field({
    type: TicketPage,
    args: {
      status: t.arg({ type: TicketStatusEnum }),
      priority: t.arg({ type: TicketPriorityEnum }),
      q: t.arg.string(),
      first: t.arg.int({ defaultValue: 20 }),
      after: t.arg.id(),
    },
    resolve: async (_root, args, ctx) => {
      const auth = requireAuth(ctx);
      const first = args.first ?? 20;
      if (first < 1 || first > 50) throw new HttpError(400, "VALIDATION_ERROR", "first must be between 1 and 50");
      const { tickets, nextCursor } = await listTickets(auth, {
        status: (args.status ?? undefined) as TicketStatus | undefined,
        priority: (args.priority ?? undefined) as TicketPriority | undefined,
        q: args.q?.trim() || undefined,
        limit: first,
        cursor: args.after ? uuidArg(args.after, "after") : undefined,
      });
      return { nodes: tickets, nextCursor };
    },
  }),
}));
