// ⚠️ TEMPORARY: placeholder until real authentication exists (Phase 3).
//
// Reads the caller's organization from the X-Organization-Id header. That is
// NOT secure (anyone can send any header), so it is disabled in production.
// Phase 3 replaces this with a verified login, and the organization will come
// from the authenticated user, never from the request.

import type { RequestHandler } from "express";
import { isProduction } from "../config/env.js";
import { HttpError } from "./errors.js";

export interface AuthContext {
  organizationId: string;
}

// Adds `req.auth` to Express's Request type.
declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const requireOrganization: RequestHandler = (req, _res, next) => {
  if (isProduction) {
    throw new HttpError(401, "UNAUTHENTICATED", "Authentication is not implemented yet");
  }
  const organizationId = req.get("x-organization-id");
  if (!organizationId) {
    throw new HttpError(401, "UNAUTHENTICATED", "Missing X-Organization-Id header");
  }
  if (!UUID_RE.test(organizationId)) {
    throw new HttpError(400, "VALIDATION_ERROR", "X-Organization-Id must be a UUID");
  }
  req.auth = { organizationId };
  next();
};

// For handlers that run after requireOrganization.
export function getAuth(req: Express.Request): AuthContext {
  if (!req.auth) throw new Error("requireOrganization middleware did not run");
  return req.auth;
}
