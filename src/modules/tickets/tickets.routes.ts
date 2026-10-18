// URL map for tickets: which handler answers which method + path.

import { Router } from "express";
import { requireUser } from "../../middleware/auth.js";
import {
  addCommentHandler,
  assignTicketHandler,
  changeStatusHandler,
  createTicketHandler,
  editTicketHandler,
  getTicketHandler,
  listCommentsHandler,
  listTicketsHandler,
  ticketHistoryHandler,
} from "./tickets.controller.js";

export const ticketsRouter = Router();

ticketsRouter.use(requireUser);

ticketsRouter.get("/", listTicketsHandler);
ticketsRouter.post("/", createTicketHandler);
ticketsRouter.get("/:id", getTicketHandler);
ticketsRouter.patch("/:id", editTicketHandler);
ticketsRouter.get("/:id/history", ticketHistoryHandler);
ticketsRouter.get("/:id/comments", listCommentsHandler);
ticketsRouter.post("/:id/comments", addCommentHandler);
ticketsRouter.patch("/:id/assign", assignTicketHandler);
ticketsRouter.patch("/:id/status", changeStatusHandler);
