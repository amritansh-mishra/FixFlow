// Authentication: works out who is making the request from their session token.
//
// Clients send the token they got from POST /api/auth/login in a header:
//   Authorization: Bearer <token>

import type { RequestHandler } from "express";
import type { UserRole } from "../db/schema.js";
import { findSessionUser } from "../modules/auth/auth.service.js";
import { HttpError } from "./errors.js";

export interface AuthContext {
  sessionId: string;
  userId: string;
  organizationId: string;
  role: UserRole;
}

// Adds `req.auth` to Express's Request type.
declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

const BEARER_RE = /^Bearer ([A-Za-z0-9_-]{20,200})$/i;

export const requireUser: RequestHandler = async (req, _res, next) => {
  const match = BEARER_RE.exec(req.get("authorization") ?? "");
  if (!match) {
    throw new HttpError(401, "UNAUTHENTICATED", "Log in and send your token as 'Authorization: Bearer <token>'");
  }

  const session = await findSessionUser(match[1]!);
  // Same answer for unknown and expired tokens.
  if (!session) {
    throw new HttpError(401, "UNAUTHENTICATED", "Your session is invalid or has expired. Log in again.");
  }

  req.auth = session;
  next();
};

// For handlers that run after requireUser.
export function getAuth(req: Express.Request): AuthContext {
  if (!req.auth) throw new Error("requireUser middleware did not run");
  return req.auth;
}
