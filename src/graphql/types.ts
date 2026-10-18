// GraphQL types and read-only queries. Every resolver calls the same
// services as the REST API, so organization isolation, visibility and
// permissions are reused, not reimplemented.

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import {
  ATTACHMENT_TYPES,
  TICKET_EVENT_TYPES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  USER_ROLES,
  ticketComments,
  users,
  type Ticket,
  type TicketAttachment,
  type TicketComment,
  type TicketEvent,
  type TicketPriority,
  type TicketStatus,
  type UserRole,
} from "../db/schema.js";
import { validate } from "../lib/validate.js";
import { addCommentBody, createTicketBody, editTicketBody } from "../modules/tickets/tickets.schemas.js";
import {
  addComment,
  assignTicket,
  changeTicketStatus,
  createTicket,
  editTicket,
  getTicket,
  listTickets,
} from "../modules/tickets/tickets.service.js";
import { HttpError } from "../middleware/errors.js";
import { withLink } from "../modules/attachments/attachments.routes.js";
import { builder, loadersOf, requireAuth } from "./builder.js";

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
    role: t.expose("role", { type: UserRoleEnum }),
    // Field-level authorization: an email address is shown only to the
    // person themselves and to managers/admins, like the REST API (comments
    // show names and roles; only managers list the team with emails).
    email: t.string({
      nullable: true,
      resolve: (user, _args, ctx) => {
        const viewer = requireAuth(ctx);
        return viewer.userId === user.id || viewer.role === "manager" || viewer.role === "admin" ? user.email : null;
      },
    }),
  }),
});

const PropertyType = builder.objectRef<{ id: string; name: string; address: string | null }>("Property").implement({
  fields: (t) => ({
    id: t.exposeID("id"),
    name: t.exposeString("name"),
    address: t.exposeString("address", { nullable: true }),
  }),
});

const CommentType = builder.objectRef<TicketComment>("Comment").implement({
  fields: (t) => ({
    id: t.exposeID("id"),
    body: t.exposeString("body"),
    createdAt: t.expose("createdAt", { type: "DateTime" }),
    author: t.field({ type: UserType, nullable: true, resolve: (c, _a, ctx) => loadersOf(ctx).user.load(c.authorId) }),
  }),
});

const EventTypeEnum = builder.enumType("TicketEventType", { values: TICKET_EVENT_TYPES });

const TicketEventType = builder.objectRef<TicketEvent>("TicketEvent").implement({
  fields: (t) => ({
    id: t.exposeID("id"),
    type: t.expose("type", { type: EventTypeEnum }),
    fromStatus: t.expose("fromStatus", { type: TicketStatusEnum, nullable: true }),
    toStatus: t.expose("toStatus", { type: TicketStatusEnum, nullable: true }),
    createdAt: t.expose("createdAt", { type: "DateTime" }),
    actor: t.field({ type: UserType, nullable: true, resolve: (e, _a, ctx) => loadersOf(ctx).user.load(e.actorId) }),
    assignedTo: t.field({
      type: UserType,
      nullable: true,
      resolve: (e, _a, ctx) => (e.assignedTo ? loadersOf(ctx).user.load(e.assignedTo) : null),
    }),
  }),
});

const PhotoTypeEnum = builder.enumType("PhotoType", {
  values: Object.fromEntries(ATTACHMENT_TYPES.map((t) => [t.replace("image/", "").toUpperCase(), { value: t }])),
});

const PhotoType = builder.objectRef<Awaited<ReturnType<typeof withLink>>>("Photo").implement({
  fields: (t) => ({
    id: t.exposeID("id"),
    fileName: t.exposeString("fileName"),
    contentType: t.expose("contentType", { type: PhotoTypeEnum }),
    sizeBytes: t.exposeInt("sizeBytes"),
    createdAt: t.expose("createdAt", { type: "DateTime" }),
    url: t.exposeString("url", { description: "Signed link to the full photo, valid for 5 minutes" }),
    thumbnailUrl: t.exposeString("thumbnailUrl", { description: "Signed link to a small preview, valid for 5 minutes" }),
    uploadedBy: t.field({ type: UserType, nullable: true, resolve: (p, _a, ctx) => loadersOf(ctx).user.load(p.uploadedBy) }),
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
    // Nested data, each fetched in batches across all tickets in the response.
    property: t.field({ type: PropertyType, nullable: true, resolve: (tk, _a, ctx) => loadersOf(ctx).property.load(tk.propertyId) }),
    createdBy: t.field({ type: UserType, nullable: true, resolve: (tk, _a, ctx) => loadersOf(ctx).user.load(tk.createdBy) }),
    assignedTo: t.field({
      type: UserType,
      nullable: true,
      resolve: (tk, _a, ctx) => (tk.assignedTo ? loadersOf(ctx).user.load(tk.assignedTo) : null),
    }),
    comments: t.field({ type: [CommentType], resolve: (tk, _a, ctx) => loadersOf(ctx).comments.load(tk.id) }),
    history: t.field({ type: [TicketEventType], resolve: (tk, _a, ctx) => loadersOf(ctx).history.load(tk.id) }),
    photos: t.field({
      type: [PhotoType],
      resolve: async (tk, _a, ctx) => Promise.all((await loadersOf(ctx).photos.load(tk.id)).map((p: TicketAttachment) => withLink(p))),
    }),
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

// ---------- Mutations ----------
// Each one validates with the same Zod schema as REST and calls the same
// service, so permissions, the workflow rules, race protection and
// notifications behave identically.

const CreateTicketInput = builder.inputType("CreateTicketInput", {
  fields: (t) => ({
    propertyId: t.id({ required: true }),
    title: t.string({ required: true }),
    description: t.string(),
    priority: t.field({ type: TicketPriorityEnum }),
  }),
});

const EditTicketInput = builder.inputType("EditTicketInput", {
  fields: (t) => ({
    title: t.string(),
    // Send null to clear the description.
    description: t.string(),
    priority: t.field({ type: TicketPriorityEnum }),
  }),
});

// GraphQL distinguishes "left out" (undefined) from "null"; keep only the
// fields that were actually sent, so the shared schemas see the same shape
// a REST body would have.
function sentFields<T extends Record<string, unknown>>(input: T, nullMeansOmit: readonly (keyof T)[] = []) {
  return Object.fromEntries(
    Object.entries(input).filter(([key, value]) => value !== undefined && !(value === null && nullMeansOmit.includes(key))),
  );
}

builder.mutationType({
  fields: (t) => ({
    createTicket: t.field({
      type: TicketType,
      args: { input: t.arg({ type: CreateTicketInput, required: true }) },
      resolve: (_root, { input }, ctx) =>
        createTicket(
          requireAuth(ctx),
          validate(createTicketBody, sentFields(input, ["description", "priority"]), "input"),
        ),
    }),

    editTicket: t.field({
      type: TicketType,
      args: { id: t.arg.id({ required: true }), input: t.arg({ type: EditTicketInput, required: true }) },
      resolve: (_root, { id, input }, ctx) =>
        editTicket(requireAuth(ctx), uuidArg(id, "id"), validate(editTicketBody, sentFields(input, ["title", "priority"]), "input")),
    }),

    assignTicket: t.field({
      type: TicketType,
      args: { id: t.arg.id({ required: true }), technicianId: t.arg.id({ required: true }) },
      resolve: (_root, args, ctx) =>
        assignTicket(requireAuth(ctx), uuidArg(args.id, "id"), uuidArg(args.technicianId, "technicianId")),
    }),

    changeTicketStatus: t.field({
      type: TicketType,
      args: { id: t.arg.id({ required: true }), status: t.arg({ type: TicketStatusEnum, required: true }) },
      resolve: (_root, args, ctx) =>
        changeTicketStatus(requireAuth(ctx), uuidArg(args.id, "id"), args.status as TicketStatus),
    }),

    addComment: t.field({
      type: CommentType,
      args: { ticketId: t.arg.id({ required: true }), body: t.arg.string({ required: true }) },
      resolve: async (_root, args, ctx) => {
        const auth = requireAuth(ctx);
        const { body } = validate(addCommentBody, { body: args.body }, "input");
        const created = await addComment(auth, uuidArg(args.ticketId, "ticketId"), body);
        const [row] = await db.select().from(ticketComments).where(eq(ticketComments.id, created.id));
        return row!;
      },
    }),
  }),
});
