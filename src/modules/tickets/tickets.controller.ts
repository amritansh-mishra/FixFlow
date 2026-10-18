// HTTP layer for tickets: reads the request, validates input, calls the
// service, and shapes the response. No SQL here.

import type { RequestHandler } from "express";
import { validate } from "../../lib/validate.js";
import { getAuth } from "../../middleware/auth.js";
import { HttpError } from "../../middleware/errors.js";
import {
  addCommentBody,
  editTicketBody,
  assignTicketBody,
  changeStatusBody,
  createTicketBody,
  listTicketsQuery,
  ticketIdParams,
} from "./tickets.schemas.js";
import {
  addComment,
  editTicket,
  assignTicket,
  changeTicketStatus,
  createTicket,
  getTicket,
  getTicketHistory,
  listComments,
  listTickets,
} from "./tickets.service.js";

// GET /api/tickets?status=&priority=&propertyId=&q=&limit=&cursor=
export const listTicketsHandler: RequestHandler = async (req, res) => {
  const auth = getAuth(req);
  const query = validate(listTicketsQuery, req.query, "query parameters");

  const { tickets, nextCursor } = await listTickets(auth, query);
  res.status(200).json({ data: tickets, nextCursor });
};

// GET /api/tickets/:id
export const getTicketHandler: RequestHandler = async (req, res) => {
  const auth = getAuth(req);
  const { id } = validate(ticketIdParams, req.params, "ticket id");

  const ticket = await getTicket(auth, id);
  // 404 (not 403) for tickets the user may not see: don't reveal they exist.
  if (!ticket) throw new HttpError(404, "TICKET_NOT_FOUND", "Ticket not found");
  res.status(200).json({ data: ticket });
};

// POST /api/tickets
export const createTicketHandler: RequestHandler = async (req, res) => {
  const auth = getAuth(req);
  const body = validate(createTicketBody, req.body, "request body");

  const ticket = await createTicket(auth, body);
  res.status(201).location(`/api/tickets/${ticket.id}`).json({ data: ticket });
};

// PATCH /api/tickets/:id/assign
export const assignTicketHandler: RequestHandler = async (req, res) => {
  const auth = getAuth(req);
  const { id } = validate(ticketIdParams, req.params, "ticket id");
  const { technicianId } = validate(assignTicketBody, req.body, "request body");

  const ticket = await assignTicket(auth, id, technicianId);
  res.status(200).json({ data: ticket });
};

// PATCH /api/tickets/:id/status
export const changeStatusHandler: RequestHandler = async (req, res) => {
  const auth = getAuth(req);
  const { id } = validate(ticketIdParams, req.params, "ticket id");
  const { status } = validate(changeStatusBody, req.body, "request body");

  const ticket = await changeTicketStatus(auth, id, status);
  res.status(200).json({ data: ticket });
};

// GET /api/tickets/:id/history
export const ticketHistoryHandler: RequestHandler = async (req, res) => {
  const auth = getAuth(req);
  const { id } = validate(ticketIdParams, req.params, "ticket id");

  const events = await getTicketHistory(auth, id);
  res.status(200).json({ data: events });
};

// GET /api/tickets/:id/comments
export const listCommentsHandler: RequestHandler = async (req, res) => {
  const auth = getAuth(req);
  const { id } = validate(ticketIdParams, req.params, "ticket id");

  const comments = await listComments(auth, id);
  res.status(200).json({ data: comments });
};

// POST /api/tickets/:id/comments
export const addCommentHandler: RequestHandler = async (req, res) => {
  const auth = getAuth(req);
  const { id } = validate(ticketIdParams, req.params, "ticket id");
  const { body } = validate(addCommentBody, req.body, "request body");

  const comment = await addComment(auth, id, body);
  res.status(201).json({ data: comment });
};

// PATCH /api/tickets/:id
export const editTicketHandler: RequestHandler = async (req, res) => {
  const auth = getAuth(req);
  const { id } = validate(ticketIdParams, req.params, "ticket id");
  const changes = validate(editTicketBody, req.body, "request body");

  const ticket = await editTicket(auth, id, changes);
  res.status(200).json({ data: ticket });
};
