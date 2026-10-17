import { Router } from "express";
import { requireUser } from "../../middleware/auth.js";
import { loginHandler, logoutHandler, meHandler } from "./auth.controller.js";

export const authRouter = Router();

authRouter.post("/login", loginHandler);
authRouter.post("/logout", requireUser, logoutHandler);
authRouter.get("/me", requireUser, meHandler);
