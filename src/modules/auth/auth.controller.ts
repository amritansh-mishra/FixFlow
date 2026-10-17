import type { RequestHandler } from "express";
import { env } from "../../config/env.js";
import { validate } from "../../lib/validate.js";
import { getAuth } from "../../middleware/auth.js";
import { HttpError } from "../../middleware/errors.js";
import { loginBody } from "./auth.schemas.js";
import { deleteSession, getCurrentUser, login } from "./auth.service.js";

// POST /api/auth/login
export const loginHandler: RequestHandler = async (req, res) => {
  const { organization, email, password } = validate(loginBody, req.body, "request body");

  const result = await login(organization, email, password);
  if (!result.ok) {
    // Security log: record the failure for spotting attacks, but never the
    // password. Kept out of test output.
    if (env.nodeEnv !== "test") {
      console.warn(`Failed login: org=${organization} reason=${result.reason} ip=${req.ip}`);
    }
    // One message for every failure, so attackers can't learn which
    // organizations or emails exist.
    throw new HttpError(401, "INVALID_CREDENTIALS", "Incorrect organization, email or password");
  }

  res.status(200).json({
    data: { token: result.token, expiresAt: result.expiresAt, user: result.user },
  });
};

// POST /api/auth/logout
export const logoutHandler: RequestHandler = async (req, res) => {
  await deleteSession(getAuth(req).sessionId);
  res.status(204).end();
};

// GET /api/auth/me
export const meHandler: RequestHandler = async (req, res) => {
  const user = await getCurrentUser(getAuth(req).userId);
  res.status(200).json({ data: user });
};
