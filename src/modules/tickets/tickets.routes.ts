// URL map for tickets: which handler answers which method + path.

import { Router } from "express";
import { requireUser } from "../../middleware/auth.js";
import { createTicketHandler, getTicketHandler, listTicketsHandler } from "./tickets.controller.js";

export const ticketsRouter = Router();

ticketsRouter.use(requireUser);

ticketsRouter.get("/", listTicketsHandler);
ticketsRouter.post("/", createTicketHandler);
ticketsRouter.get("/:id", getTicketHandler);
