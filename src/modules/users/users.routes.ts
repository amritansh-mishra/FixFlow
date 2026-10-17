// The Team page: list the organization's people and add new ones.
//
//   GET  /api/users   managers and admins
//   POST /api/users   managers add residents and technicians;
//                     only admins add managers and admins

import { asc, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/index.js";
import { USER_ROLES, users, type UserRole } from "../../db/schema.js";
import { isUniqueViolation } from "../../lib/codes.js";
import { hashPassword } from "../../lib/passwords.js";
import { validate } from "../../lib/validate.js";
import { getAuth, requireUser, type AuthContext } from "../../middleware/auth.js";
import { HttpError } from "../../middleware/errors.js";
import { newPasswordSchema } from "../auth/auth.schemas.js";

export const usersRouter = Router();

usersRouter.use(requireUser);

export const addUserBody = z.strictObject({
  name: z.string().trim().min(1).max(120),
  email: z.email().max(255).transform((email) => email.toLowerCase()),
  role: z.enum(USER_ROLES),
  // A temporary password the new person changes later.
  password: newPasswordSchema,
});

// Which roles each role may give to new people. Nobody can create a role
// above their own, so a manager can't make themselves an admin's equal.
const ASSIGNABLE_ROLES: Partial<Record<UserRole, readonly UserRole[]>> = {
  manager: ["resident", "technician"],
  admin: ["resident", "technician", "manager", "admin"],
};

function requireManager(auth: AuthContext) {
  if (auth.role !== "manager" && auth.role !== "admin") {
    throw new HttpError(403, "FORBIDDEN", "Only managers and admins can manage the team");
  }
}

usersRouter.get("/", async (req, res) => {
  const auth = getAuth(req);
  requireManager(auth);
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.organizationId, auth.organizationId))
    .orderBy(asc(users.name));
  res.status(200).json({ data: rows });
});

usersRouter.post("/", async (req, res) => {
  const auth = getAuth(req);
  requireManager(auth);
  const body = validate(addUserBody, req.body, "request body");
  if (!ASSIGNABLE_ROLES[auth.role]?.includes(body.role)) {
    throw new HttpError(403, "FORBIDDEN", `A ${auth.role} can't add a ${body.role}`);
  }

  try {
    const [user] = await db
      .insert(users)
      .values({
        organizationId: auth.organizationId,
        name: body.name,
        email: body.email,
        role: body.role,
        passwordHash: await hashPassword(body.password),
      })
      .returning({ id: users.id, name: users.name, email: users.email, role: users.role, createdAt: users.createdAt });
    res.status(201).json({ data: user });
  } catch (err) {
    if (isUniqueViolation(err, "users_organization_id_email_key")) {
      throw new HttpError(409, "EMAIL_TAKEN", "Someone in this organization already uses that email");
    }
    throw err;
  }
});
