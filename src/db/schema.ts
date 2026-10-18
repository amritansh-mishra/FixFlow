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
  integer,
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

export const TICKET_EVENT_TYPES = ["created", "assigned", "status_changed", "commented", "edited"] as const;

export type UserRole = (typeof USER_ROLES)[number];
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export type TicketEventType = (typeof TICKET_EVENT_TYPES)[number];

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 150 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull(),
    // Code residents use to join (e.g. "K7QM-3XPA"). NULL until generated.
    joinCode: varchar("join_code", { length: 20 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("organizations_slug_key").on(t.slug),
    unique("organizations_join_code_key").on(t.joinCode),
  ],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    role: varchar("role", { length: 20, enum: USER_ROLES }).notNull(),
    // scrypt hash (see src/lib/passwords.ts). NULL means the user can't log in yet.
    passwordHash: text("password_hash"),
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

// Append-only history: one row per thing that happened to a ticket.
// Rows are only ever inserted, never updated or deleted.
export const ticketEvents = pgTable(
  "ticket_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    ticketId: uuid("ticket_id").notNull(),
    // The user who did it.
    actorId: uuid("actor_id").notNull(),
    type: varchar("type", { length: 20, enum: TICKET_EVENT_TYPES }).notNull(),
    fromStatus: varchar("from_status", { length: 20, enum: TICKET_STATUSES }),
    toStatus: varchar("to_status", { length: 20, enum: TICKET_STATUSES }),
    // Set on 'assigned' events: the technician the ticket was assigned to.
    assignedTo: uuid("assigned_to"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "ticket_events_organization_id_fkey",
      columns: [t.organizationId],
      foreignColumns: [organizations.id],
    }),
    // Same-organization guarantees, like on tickets.
    foreignKey({
      name: "ticket_events_ticket_id_organization_id_fkey",
      columns: [t.ticketId, t.organizationId],
      foreignColumns: [tickets.id, tickets.organizationId],
    }),
    foreignKey({
      name: "ticket_events_actor_id_organization_id_fkey",
      columns: [t.actorId, t.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }),
    foreignKey({
      name: "ticket_events_assigned_to_organization_id_fkey",
      columns: [t.assignedTo, t.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }),
    check(
      "ticket_events_type_check",
      sql`${t.type} IN ('created', 'assigned', 'status_changed', 'commented', 'edited')`,
    ),
    check(
      "ticket_events_from_status_check",
      sql`${t.fromStatus} IN ('open', 'assigned', 'in_progress', 'resolved', 'closed')`,
    ),
    check(
      "ticket_events_to_status_check",
      sql`${t.toStatus} IN ('open', 'assigned', 'in_progress', 'resolved', 'closed')`,
    ),
    // "Show the history of this ticket, oldest first"
    index("idx_ticket_events_ticket").on(t.organizationId, t.ticketId, t.createdAt),
  ],
);

// Discussion on a ticket. Like the history, comments are append-only:
// the app may add and read them, never edit or delete them.
export const ticketComments = pgTable(
  "ticket_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    ticketId: uuid("ticket_id").notNull(),
    authorId: uuid("author_id").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "ticket_comments_organization_id_fkey",
      columns: [t.organizationId],
      foreignColumns: [organizations.id],
    }),
    foreignKey({
      name: "ticket_comments_ticket_id_organization_id_fkey",
      columns: [t.ticketId, t.organizationId],
      foreignColumns: [tickets.id, tickets.organizationId],
    }),
    foreignKey({
      name: "ticket_comments_author_id_organization_id_fkey",
      columns: [t.authorId, t.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }),
    check("ticket_comments_body_check", sql`length(${t.body}) BETWEEN 1 AND 2000`),
    // "Show this ticket's comments, oldest first"
    index("idx_ticket_comments_ticket").on(t.organizationId, t.ticketId, t.createdAt),
  ],
);

export const ATTACHMENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5 MB

// Photos attached to a ticket. The file itself lives in object storage
// (Cloudflare R2 in production, SeaweedFS locally); this row is the record.
export const ticketAttachments = pgTable(
  "ticket_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    ticketId: uuid("ticket_id").notNull(),
    uploadedBy: uuid("uploaded_by").notNull(),
    // Where the file is in the bucket. Generated by the server, never taken
    // from the uploaded file's name.
    storageKey: varchar("storage_key", { length: 300 }).notNull(),
    // The original file name, for display only.
    fileName: varchar("file_name", { length: 255 }).notNull(),
    // Detected from the file's contents, not trusted from the client.
    contentType: varchar("content_type", { length: 50, enum: ATTACHMENT_TYPES }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "ticket_attachments_organization_id_fkey",
      columns: [t.organizationId],
      foreignColumns: [organizations.id],
    }),
    foreignKey({
      name: "ticket_attachments_ticket_id_organization_id_fkey",
      columns: [t.ticketId, t.organizationId],
      foreignColumns: [tickets.id, tickets.organizationId],
    }),
    foreignKey({
      name: "ticket_attachments_uploaded_by_organization_id_fkey",
      columns: [t.uploadedBy, t.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }),
    check(
      "ticket_attachments_content_type_check",
      sql`${t.contentType} IN ('image/jpeg', 'image/png', 'image/webp')`,
    ),
    check("ticket_attachments_size_check", sql`${t.sizeBytes} > 0 AND ${t.sizeBytes} <= 5242880`),
    unique("ticket_attachments_storage_key_key").on(t.storageKey),
    // "This ticket's photos, oldest first"
    index("idx_ticket_attachments_ticket").on(t.organizationId, t.ticketId, t.createdAt),
  ],
);

export const NOTIFICATION_TYPES =["ticket_assigned", "status_changed", "comment_added"] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

// In-app notifications, created by the background worker.
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    // Who the notification is for.
    userId: uuid("user_id").notNull(),
    // Who caused it (e.g. the manager who assigned the ticket).
    actorId: uuid("actor_id").notNull(),
    ticketId: uuid("ticket_id").notNull(),
    type: varchar("type", { length: 30, enum: NOTIFICATION_TYPES }).notNull(),
    message: text("message").notNull(),
    // NULL = unread.
    readAt: timestamp("read_at", { withTimezone: true }),
    // Unique per job and recipient, so a retried job can't notify someone twice.
    dedupeKey: varchar("dedupe_key", { length: 200 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "notifications_organization_id_fkey",
      columns: [t.organizationId],
      foreignColumns: [organizations.id],
    }),
    foreignKey({
      name: "notifications_user_id_organization_id_fkey",
      columns: [t.userId, t.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }),
    foreignKey({
      name: "notifications_actor_id_organization_id_fkey",
      columns: [t.actorId, t.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }),
    foreignKey({
      name: "notifications_ticket_id_organization_id_fkey",
      columns: [t.ticketId, t.organizationId],
      foreignColumns: [tickets.id, tickets.organizationId],
    }),
    check(
      "notifications_type_check",
      sql`${t.type} IN ('ticket_assigned', 'status_changed', 'comment_added')`,
    ),
    unique("notifications_dedupe_key_key").on(t.dedupeKey),
    // "My notifications, newest first"
    index("idx_notifications_user").on(t.organizationId, t.userId, t.createdAt),
  ],
);

// One row per logged-in device. Only a SHA-256 hash of the token is stored,
// so a leaked copy of this table can't be used to log in.
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    userId: uuid("user_id").notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    foreignKey({
      name: "sessions_organization_id_fkey",
      columns: [t.organizationId],
      foreignColumns: [organizations.id],
    }),
    foreignKey({
      name: "sessions_user_id_organization_id_fkey",
      columns: [t.userId, t.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }),
    // Every request looks a session up by its token hash.
    unique("sessions_token_hash_key").on(t.tokenHash),
    // "Log this user out everywhere"
    index("idx_sessions_user").on(t.organizationId, t.userId),
  ],
);

export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;
export type Property = typeof properties.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
export type NewTicket = typeof tickets.$inferInsert;
export type TicketEvent = typeof ticketEvents.$inferSelect;
export type TicketComment = typeof ticketComments.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type TicketAttachment = typeof ticketAttachments.$inferSelect;
