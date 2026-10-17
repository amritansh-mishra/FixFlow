// Database schema, described in TypeScript. This file is the source of truth:
// change it, then run `npm run db:generate` to create a migration.
//
// Constraint and index names match the live database exactly. Column order
// inside composite keys matters: (id, organization_id), not the reverse.

import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const USER_ROLES = ["resident", "technician", "manager", "admin"] as const;
export const TICKET_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export const TICKET_STATUSES = ["open", "assigned", "in_progress", "resolved", "closed"] as const;

export type UserRole = (typeof USER_ROLES)[number];
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 150 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("organizations_slug_key").on(t.slug)],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    role: varchar("role", { length: 20, enum: USER_ROLES }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "users_organization_id_fkey",
      columns: [t.organizationId],
      foreignColumns: [organizations.id],
    }),
    check("users_role_check", sql`${t.role} IN ('resident', 'technician', 'manager', 'admin')`),
    unique("users_organization_id_email_key").on(t.organizationId, t.email),
    // Lets tickets reference (user, organization) pairs, so a ticket can never
    // point at a user from a different organization.
    unique("users_id_organization_id_key").on(t.id, t.organizationId),
  ],
);

export const properties = pgTable(
  "properties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    name: varchar("name", { length: 150 }).notNull(),
    address: text("address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "properties_organization_id_fkey",
      columns: [t.organizationId],
      foreignColumns: [organizations.id],
    }),
    unique("properties_id_organization_id_key").on(t.id, t.organizationId),
  ],
);

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    propertyId: uuid("property_id").notNull(),
    createdBy: uuid("created_by").notNull(),
    assignedTo: uuid("assigned_to"),
    title: varchar("title", { length: 200 }).notNull(),
    description: text("description"),
    priority: varchar("priority", { length: 20, enum: TICKET_PRIORITIES }).notNull().default("medium"),
    status: varchar("status", { length: 20, enum: TICKET_STATUSES }).notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Kept current by the tickets_set_updated_at trigger (see drizzle/0001).
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "tickets_organization_id_fkey",
      columns: [t.organizationId],
      foreignColumns: [organizations.id],
    }),
    // Composite foreign keys: the property and both users must belong to the
    // same organization as the ticket.
    foreignKey({
      name: "tickets_property_id_organization_id_fkey",
      columns: [t.propertyId, t.organizationId],
      foreignColumns: [properties.id, properties.organizationId],
    }),
    foreignKey({
      name: "tickets_created_by_organization_id_fkey",
      columns: [t.createdBy, t.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }),
    foreignKey({
      name: "tickets_assigned_to_organization_id_fkey",
      columns: [t.assignedTo, t.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }),
    check("tickets_priority_check", sql`${t.priority} IN ('low', 'medium', 'high', 'urgent')`),
    check(
      "tickets_status_check",
      sql`${t.status} IN ('open', 'assigned', 'in_progress', 'resolved', 'closed')`,
    ),
    unique("tickets_id_organization_id_key").on(t.id, t.organizationId),
    // Every query is scoped to one organization, so each index starts with it.
    index("idx_tickets_org_status").on(t.organizationId, t.status),
    index("idx_tickets_assigned_to").on(t.organizationId, t.assignedTo),
    index("idx_tickets_property").on(t.organizationId, t.propertyId),
  ],
);

export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;
export type Property = typeof properties.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
export type NewTicket = typeof tickets.$inferInsert;
