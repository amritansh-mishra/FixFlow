// HTTP layer for tickets: reads the request, validates input, calls the
// service, and shapes the response. No SQL here.

import type { RequestHandler } from "express";
import { TICKET_STATUSES, type TicketStatus } from "../../db/schema.js";
import { getAuth } from "../../middleware/auth.js";
import { HttpError } from "../../middleware/errors.js";
import { listTickets } from "./tickets.service.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function parseLimit(raw: unknown): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  const limit = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new HttpError(400, "VALIDATION_ERROR", `limit must be an integer from 1 to ${MAX_LIMIT}`);
  }
  return limit;
}

function parseStatus(raw: unknown): TicketStatus | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || !(TICKET_STATUSES as readonly string[]).includes(raw)) {
    throw new HttpError(400, "VALIDATION_ERROR", `status must be one of: ${TICKET_STATUSES.join(", ")}`);
  }
  return raw as TicketStatus;
}

// GET /api/tickets?status=open&limit=20
export const listTicketsHandler: RequestHandler = async (req, res) => {
  const { organizationId } = getAuth(req);
  const limit = parseLimit(req.query.limit);
  const status = parseStatus(req.query.status);

  const rows = await listTickets(organizationId, { status, limit });
  res.status(200).json({ data: rows });
};
