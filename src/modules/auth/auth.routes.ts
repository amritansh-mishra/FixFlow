import { Router } from "express";
import { requireUser } from "../../middleware/auth.js";
import {
  changePasswordHandler,
  forgotPasswordHandler,
  joinHandler,
  loginHandler,
  logoutHandler,
  meHandler,
  resetPasswordHandler,
  signupHandler,
} from "./auth.controller.js";

export const authRouter = Router();

authRouter.post("/signup", signupHandler);
authRouter.post("/join", joinHandler);
authRouter.post("/login", loginHandler);
authRouter.post("/logout", requireUser, logoutHandler);
authRouter.get("/me", requireUser, meHandler);
authRouter.post("/password", requireUser, changePasswordHandler);
authRouter.post("/forgot-password", forgotPasswordHandler);
authRouter.post("/reset-password", resetPasswordHandler);
