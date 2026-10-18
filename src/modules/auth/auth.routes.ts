import { Router } from "express";
import { requireUser } from "../../middleware/auth.js";
import {
  changePasswordHandler,
  joinHandler,
  loginHandler,
  logoutHandler,
  meHandler,
  signupHandler,
} from "./auth.controller.js";

export const authRouter = Router();

authRouter.post("/signup", signupHandler);
authRouter.post("/join", joinHandler);
authRouter.post("/login", loginHandler);
authRouter.post("/logout", requireUser, logoutHandler);
authRouter.get("/me", requireUser, meHandler);
authRouter.post("/password", requireUser, changePasswordHandler);
