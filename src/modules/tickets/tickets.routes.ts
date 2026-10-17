// URL map for tickets: which handler answers which method + path.

import { Router } from "express";
import { requireOrganization } from "../../middleware/auth.js";
import { listTicketsHandler } from "./tickets.controller.js";

export const ticketsRouter = Router();

ticketsRouter.use(requireOrganization);

ticketsRouter.get("/", listTicketsHandler);
