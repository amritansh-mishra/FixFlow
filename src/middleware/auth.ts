// ⚠️ TEMPORARY: placeholder until real authentication exists (Phase 3).
//
// Reads the caller's user id from the X-User-Id header and loads that user
// from the database. The organization and role come from the user's database
// row, never from the request. But anyone can still claim to be any user by
// sending their id, so this is disabled in production. Phase 3 replaces the
// header with a verified login; the rest of the app keeps using req.auth.

import { eq } from "drizzle-orm";
import type { RequestHandler } from "express";
import { z } from "zod";
import { isProduction } from "../config/env.js";
import { db } from "../db/index.js";
import { users, type UserRole } from "../db/schema.js";
import { HttpError } from "./errors.js";

export interface AuthContext {
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

export const requireUser: RequestHandler = async (req, _res, next) => {
  if (isProduction) {
    throw new HttpError(401, "UNAUTHENTICATED", "Authentication is not implemented yet");
  }
  const header = req.get("x-user-id");
  if (!header) {
    throw new HttpError(401, "UNAUTHENTICATED", "Missing X-User-Id header");
  }
  const parsed = z.uuid().safeParse(header);
  if (!parsed.success) {
    throw new HttpError(400, "VALIDATION_ERROR", "X-User-Id must be a UUID");
  }

  const [user] = await db
    .select({ id: users.id, organizationId: users.organizationId, role: users.role })
    .from(users)
    .where(eq(users.id, parsed.data));
  if (!user) {
    throw new HttpError(401, "UNAUTHENTICATED", "Unknown user");
  }

  req.auth = { userId: user.id, organizationId: user.organizationId, role: user.role };
  next();
};

// For handlers that run after requireUser.
export function getAuth(req: Express.Request): AuthContext {
  if (!req.auth) throw new Error("requireUser middleware did not run");
  return req.auth;
}
