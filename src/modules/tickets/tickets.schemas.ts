// Shapes of valid ticket requests. Anything that doesn't match is rejected
// with a 400 before it reaches the service.

import { z } from "zod";
import { TICKET_PRIORITIES, TICKET_STATUSES } from "../../db/schema.js";

// GET /api/tickets?status=open&limit=20
export const listTicketsQuery = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  // Query values arrive as strings; coerce turns "20" into 20.
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// /api/tickets/:id
export const ticketIdParams = z.object({
  id: z.uuid(),
});

// POST /api/tickets
// strictObject rejects unknown fields, so a client can't sneak in
// organizationId, createdBy, status or assignedTo. The server sets those.
export const createTicketBody = z.strictObject({
  propertyId: z.uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
});

export type CreateTicketBody = z.infer<typeof createTicketBody>;

// PATCH /api/tickets/:id/assign
export const assignTicketBody = z.strictObject({
  technicianId: z.uuid(),
});

// PATCH /api/tickets/:id/status
export const changeStatusBody = z.strictObject({
  status: z.enum(TICKET_STATUSES),
});

// POST /api/tickets/:id/comments
export const addCommentBody = z.strictObject({
  body: z.string().trim().min(1).max(2000),
});
