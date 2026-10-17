// Properties (buildings, blocks, campuses) of the caller's organization.
// Needed to create tickets: POST /api/tickets takes a propertyId.

import { asc, eq } from "drizzle-orm";
import { Router } from "express";
import { db } from "../../db/index.js";
import { properties } from "../../db/schema.js";
import { getAuth, requireUser } from "../../middleware/auth.js";

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
