// OpenAPI 3.1 description of the API, served at /openapi.json and shown as
// interactive docs at /docs.
//
// Request schemas are generated from the same Zod schemas the API validates
// with, so the docs can't drift from the real rules.

import { z } from "zod";
import { TICKET_EVENT_TYPES, TICKET_PRIORITIES, TICKET_STATUSES, USER_ROLES } from "../db/schema.js";
import { loginBody } from "../modules/auth/auth.schemas.js";
import {
  addCommentBody,
  assignTicketBody,
  changeStatusBody,
  createTicketBody,
  listTicketsQuery,
} from "../modules/tickets/tickets.schemas.js";

type JsonSchema = Record<string, unknown>;

// Zod → JSON Schema, minus noise that doesn't help readers ($schema, and long
// regex patterns where `format` already says "uuid" or "email").
function fromZod(schema: z.ZodType): JsonSchema {
  const json = z.toJSONSchema(schema, { io: "input" }) as JsonSchema;
  delete json.$schema;
  const strip = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const obj = node as JsonSchema;
    if (obj.format === "uuid" || obj.format === "email") delete obj.pattern;
    Object.values(obj).forEach(strip);
  };
  strip(json);
  return json;
}

// Query-string schema → OpenAPI parameter list.
function queryParameters(schema: z.ZodType) {
  const json = fromZod(schema) as { properties: Record<string, JsonSchema>; required?: string[] };
  return Object.entries(json.properties).map(([name, s]) => ({
    name,
    in: "query",
    required: json.required?.includes(name) ?? false,
    schema: s,
  }));
}

const uuid = { type: "string", format: "uuid" };
const timestamp = { type: "string", format: "date-time" };
const nullable = (s: JsonSchema) => ({ oneOf: [s, { type: "null" }] });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: JsonSchema) => ({ "application/json": { schema } });
const dataOf = (schema: JsonSchema) => json({ type: "object", properties: { data: schema } });

const errorResponse = (description: string) => ({ description, content: json(ref("Error")) });
const commonErrors = {
  "400": errorResponse("Invalid input; `details` lists each problem"),
  "401": errorResponse("Not logged in, or the session expired"),
};
const ticketErrors = { ...commonErrors, "404": errorResponse("No such ticket, or you may not see it") };

const ticketIdParam = { name: "id", in: "path", required: true, schema: uuid };

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "FixFlow API",
    version: "1.0.0",
    license: { name: "MIT", identifier: "MIT" },
    description: [
      "Multi-tenant maintenance and work-order management.",
      "",
      "**Try it:** call `POST /api/auth/login` with the demo organization `demo` (see the README for accounts),",
      "copy the `token`, click **Authorize**, and paste it. Every other endpoint then works in this page.",
      "",
      "Users only ever see their own organization's data. Within it, residents see tickets they created,",
      "technicians see tickets assigned to them, and managers and admins see everything.",
    ].join("\n"),
  },
  servers: [{ url: "/" }],
  tags: [
    { name: "Auth", description: "Log in and out" },
    { name: "Tickets", description: "Report, assign and track maintenance tickets" },
    { name: "Organization", description: "Properties and statistics" },
    { name: "System", description: "Service status" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", description: "The token from POST /api/auth/login" },
    },
    schemas: {
      Error: {
        type: "object",
        properties: {
          error: {
            type: "object",
            properties: {
              code: { type: "string", examples: ["VALIDATION_ERROR", "TICKET_NOT_FOUND", "FORBIDDEN"] },
              message: { type: "string" },
              details: {
                type: "array",
                items: { type: "object", properties: { path: { type: "string" }, message: { type: "string" } } },
              },
            },
          },
        },
      },
      User: {
        type: "object",
        properties: {
          id: uuid,
          organizationId: uuid,
          name: { type: "string" },
          email: { type: "string", format: "email" },
          role: { type: "string", enum: USER_ROLES },
        },
      },
      Ticket: {
        type: "object",
        properties: {
          id: uuid,
          organizationId: uuid,
          propertyId: uuid,
          createdBy: uuid,
          assignedTo: nullable(uuid),
          title: { type: "string" },
          description: nullable({ type: "string" }),
          priority: { type: "string", enum: TICKET_PRIORITIES },
          status: { type: "string", enum: TICKET_STATUSES },
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      },
      TicketEvent: {
        type: "object",
        properties: {
          id: uuid,
          ticketId: uuid,
          actorId: uuid,
          type: { type: "string", enum: TICKET_EVENT_TYPES },
          fromStatus: nullable({ type: "string", enum: TICKET_STATUSES }),
          toStatus: nullable({ type: "string", enum: TICKET_STATUSES }),
          assignedTo: nullable(uuid),
          createdAt: timestamp,
        },
      },
      Comment: {
        type: "object",
        properties: {
          id: uuid,
          ticketId: uuid,
          body: { type: "string" },
          createdAt: timestamp,
          author: {
            type: "object",
            properties: { id: uuid, name: { type: "string" }, role: { type: "string", enum: USER_ROLES } },
          },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    "/health": {
      get: {
        tags: ["System"],
        operationId: "getHealth",
        summary: "Service and database status",
        security: [],
        responses: { "200": { description: "Healthy" }, "503": { description: "Database unreachable" } },
      },
    },
    "/api/auth/login": {
      post: {
        tags: ["Auth"],
        operationId: "login",
        summary: "Log in with organization slug, email and password",
        description: "Rate-limited: 5 failed attempts per account, or 20 attempts per IP, per 15 minutes.",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: fromZod(loginBody),
              example: { organization: "demo", email: "manager@example.com", password: "<demo password>" },
            },
          },
        },
        responses: {
          "200": {
            description: "Logged in",
            content: dataOf({
              type: "object",
              properties: { token: { type: "string" }, expiresAt: timestamp, user: ref("User") },
            }),
          },
          "400": commonErrors["400"],
          "401": errorResponse("Incorrect organization, email or password (always the same message)"),
          "429": errorResponse("Too many attempts; see the Retry-After header"),
        },
      },
    },
    "/api/auth/logout": {
      post: {
        tags: ["Auth"],
        operationId: "logout",
        summary: "End the current session",
        responses: { "204": { description: "Logged out" }, "401": commonErrors["401"] },
      },
    },
    "/api/auth/me": {
      get: {
        tags: ["Auth"],
        operationId: "getCurrentUser",
        summary: "The logged-in user",
        responses: { "200": { description: "OK", content: dataOf(ref("User")) }, "401": commonErrors["401"] },
      },
    },
    "/api/properties": {
      get: {
        tags: ["Organization"],
        operationId: "listProperties",
        summary: "The organization's properties (needed to create tickets)",
        responses: {
          "200": {
            description: "OK",
            content: dataOf({
              type: "array",
              items: {
                type: "object",
                properties: { id: uuid, name: { type: "string" }, address: nullable({ type: "string" }) },
              },
            }),
          },
          "401": commonErrors["401"],
        },
      },
    },
    "/api/stats": {
      get: {
        tags: ["Organization"],
        operationId: "getStats",
        summary: "Ticket statistics (managers and admins)",
        responses: {
          "200": {
            description: "OK",
            content: dataOf({
              type: "object",
              properties: {
                total: { type: "integer" },
                byStatus: { type: "object", additionalProperties: { type: "integer" } },
                byPriority: { type: "object", additionalProperties: { type: "integer" } },
                averageResolutionHours: nullable({ type: "number" }),
                resolvedTickets: { type: "integer" },
                technicians: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: uuid,
                      name: { type: "string" },
                      active: { type: "integer" },
                      completed: { type: "integer" },
                    },
                  },
                },
              },
            }),
          },
          "401": commonErrors["401"],
          "403": errorResponse("Not a manager or admin"),
        },
      },
    },
    "/api/tickets": {
      get: {
        tags: ["Tickets"],
        operationId: "listTickets",
        summary: "List visible tickets, newest first",
        description: "Pass the returned `nextCursor` as `cursor` to get the next page.",
        parameters: queryParameters(listTicketsQuery),
        responses: {
          "200": {
            description: "One page of tickets",
            content: json({
              type: "object",
              properties: { data: { type: "array", items: ref("Ticket") }, nextCursor: nullable(uuid) },
            }),
          },
          ...commonErrors,
        },
      },
      post: {
        tags: ["Tickets"],
        operationId: "createTicket",
        summary: "Report a new ticket (residents, managers and admins)",
        requestBody: { required: true, content: json(fromZod(createTicketBody)) },
        responses: {
          "201": { description: "Created", content: dataOf(ref("Ticket")) },
          ...commonErrors,
          "403": errorResponse("Technicians can't report tickets"),
        },
      },
    },
    "/api/tickets/{id}": {
      get: {
        tags: ["Tickets"],
        operationId: "getTicket",
        summary: "One ticket",
        parameters: [ticketIdParam],
        responses: { "200": { description: "OK", content: dataOf(ref("Ticket")) }, ...ticketErrors },
      },
    },
    "/api/tickets/{id}/history": {
      get: {
        tags: ["Tickets"],
        operationId: "getTicketHistory",
        summary: "Everything that happened to a ticket, oldest first",
        parameters: [ticketIdParam],
        responses: {
          "200": { description: "OK", content: dataOf({ type: "array", items: ref("TicketEvent") }) },
          ...ticketErrors,
        },
      },
    },
    "/api/tickets/{id}/comments": {
      get: {
        tags: ["Tickets"],
        operationId: "listComments",
        summary: "A ticket's comments, oldest first",
        parameters: [ticketIdParam],
        responses: {
          "200": { description: "OK", content: dataOf({ type: "array", items: ref("Comment") }) },
          ...ticketErrors,
        },
      },
      post: {
        tags: ["Tickets"],
        operationId: "addComment",
        summary: "Comment on a ticket",
        parameters: [ticketIdParam],
        requestBody: { required: true, content: json(fromZod(addCommentBody)) },
        responses: { "201": { description: "Created", content: dataOf(ref("Comment")) }, ...ticketErrors },
      },
    },
    "/api/tickets/{id}/assign": {
      patch: {
        tags: ["Tickets"],
        operationId: "assignTicket",
        summary: "Assign to a technician (managers and admins)",
        description: "Allowed while the ticket is `open` or `assigned`. Sets the status to `assigned`.",
        parameters: [ticketIdParam],
        requestBody: { required: true, content: json(fromZod(assignTicketBody)) },
        responses: {
          "200": { description: "Assigned", content: dataOf(ref("Ticket")) },
          ...ticketErrors,
          "403": errorResponse("Not a manager or admin"),
          "409": errorResponse("Work has already started, or someone else changed the ticket"),
        },
      },
    },
    "/api/tickets/{id}/status": {
      patch: {
        tags: ["Tickets"],
        operationId: "changeTicketStatus",
        summary: "Move a ticket along the workflow",
        description: [
          "`assigned → in_progress → resolved`: the assigned technician.",
          "`resolved → closed` or `resolved → in_progress` (reopen): the creator, a manager or an admin.",
        ].join("\n\n"),
        parameters: [ticketIdParam],
        requestBody: { required: true, content: json(fromZod(changeStatusBody)) },
        responses: {
          "200": { description: "Updated", content: dataOf(ref("Ticket")) },
          ...ticketErrors,
          "403": errorResponse("This change isn't yours to make"),
          "409": errorResponse("Not an allowed change from the current status, or someone else changed the ticket"),
        },
      },
    },
  },
};
