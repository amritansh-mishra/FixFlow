// The caller's organization.
//
//   GET  /api/organization            everyone (the join code only for managers and admins)
//   POST /api/organization/join-code  managers and admins: replace the join code

import { eq } from "drizzle-orm";
import { Router } from "express";
import { db } from "../../db/index.js";
import { organizations } from "../../db/schema.js";
import { generateJoinCode } from "../../lib/codes.js";
import { getAuth, requireUser } from "../../middleware/auth.js";
import { HttpError } from "../../middleware/errors.js";

export const organizationRouter = Router();

organizationRouter.use(requireUser);

organizationRouter.get("/", async (req, res) => {
  const { organizationId, role } = getAuth(req);
  const [org] = await db
    .select({ id: organizations.id, name: organizations.name, slug: organizations.slug, joinCode: organizations.joinCode })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  const canSeeCode = role === "manager" || role === "admin";
  res.status(200).json({ data: { ...org!, joinCode: canSeeCode ? org!.joinCode : undefined } });
});

// A new code immediately stops the old one working, e.g. if it was shared too widely.
organizationRouter.post("/join-code", async (req, res) => {
  const { organizationId, role } = getAuth(req);
  if (role !== "manager" && role !== "admin") {
    throw new HttpError(403, "FORBIDDEN", "Only managers and admins can change the join code");
  }
  const [org] = await db
    .update(organizations)
    .set({ joinCode: generateJoinCode() })
    .where(eq(organizations.id, organizationId))
    .returning({ joinCode: organizations.joinCode });
  res.status(200).json({ data: { joinCode: org!.joinCode } });
});
