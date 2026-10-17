// HTTP layer for tickets: reads the request, validates input, calls the
// service, and shapes the response. No SQL here.

import type { RequestHandler } from "express";
import { validate } from "../../lib/validate.js";
import { getAuth } from "../../middleware/auth.js";
import { HttpError } from "../../middleware/errors.js";
import { createTicketBody, listTicketsQuery, ticketIdParams } from "./tickets.schemas.js";
import { createTicket, getTicket, listTickets } from "./tickets.service.js";

// GET /api/tickets?status=open&limit=20
export const listTicketsHandler: RequestHandler = async (req, res) => {
  const { organizationId } = getAuth(req);
  const query = validate(listTicketsQuery, req.query, "query parameters");

  const rows = await listTickets(organizationId, query);
  res.status(200).json({ data: rows });
};

// GET /api/tickets/:id
export const getTicketHandler: RequestHandler = async (req, res) => {
  const { organizationId } = getAuth(req);
  const { id } = validate(ticketIdParams, req.params, "ticket id");

  const ticket = await getTicket(organizationId, id);
  // 404 (not 403) for other organizations' tickets: don't reveal they exist.
  if (!ticket) throw new HttpError(404, "TICKET_NOT_FOUND", "Ticket not found");
  res.status(200).json({ data: ticket });
};

// POST /api/tickets
export const createTicketHandler: RequestHandler = async (req, res) => {
  const { organizationId, userId } = getAuth(req);
  const body = validate(createTicketBody, req.body, "request body");

  const ticket = await createTicket(organizationId, userId, body);
  res.status(201).location(`/api/tickets/${ticket.id}`).json({ data: ticket });
};
