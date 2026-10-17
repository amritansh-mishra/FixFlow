// Properties (buildings, blocks, campuses) of the caller's organization.
// Needed to create tickets: POST /api/tickets takes a propertyId.

import { asc, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/index.js";
import { properties } from "../../db/schema.js";
import { validate } from "../../lib/validate.js";
import { getAuth, requireUser } from "../../middleware/auth.js";
import { HttpError } from "../../middleware/errors.js";

export const propertiesRouter = Router();

propertiesRouter.use(requireUser);

// GET /api/properties
propertiesRouter.get("/", async (req, res) => {
  const { organizationId } = getAuth(req);
  const rows = await db
    .select({ id: properties.id, name: properties.name, address: properties.address })
    .from(properties)
    .where(eq(properties.organizationId, organizationId))
    .orderBy(asc(properties.name));
  res.status(200).json({ data: rows });
});

export const addPropertyBody = z.strictObject({
  name: z.string().trim().min(1).max(150),
  address: z.string().trim().max(500).optional(),
});

// POST /api/properties (managers and admins)
propertiesRouter.post("/", async (req, res) => {
  const { organizationId, role } = getAuth(req);
  if (role !== "manager" && role !== "admin") {
    throw new HttpError(403, "FORBIDDEN", "Only managers and admins can add properties");
  }
  const body = validate(addPropertyBody, req.body, "request body");
  const [property] = await db
    .insert(properties)
    .values({ organizationId, name: body.name, address: body.address ?? null })
    .returning({ id: properties.id, name: properties.name, address: properties.address });
  res.status(201).json({ data: property });
});
