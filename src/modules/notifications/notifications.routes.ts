// The logged-in user's own notifications.
//
//   GET  /api/notifications?limit=20   newest first, plus the unread count
//   POST /api/notifications/read       mark some ({ ids: [...] }) or all ({}) as read

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/index.js";
import { notifications } from "../../db/schema.js";
import { validate } from "../../lib/validate.js";
import { getAuth, requireUser, type AuthContext } from "../../middleware/auth.js";

export const notificationsRouter = Router();

notificationsRouter.use(requireUser);

export const listNotificationsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const markReadBody = z.strictObject({
  // Leave out to mark everything as read.
  ids: z.array(z.uuid()).min(1).max(100).optional(),
});

// Only ever the caller's own notifications, in their own organization.
const mine = (auth: AuthContext) =>
  and(eq(notifications.organizationId, auth.organizationId), eq(notifications.userId, auth.userId));

notificationsRouter.get("/", async (req, res) => {
  const auth = getAuth(req);
  const { limit } = validate(listNotificationsQuery, req.query, "query parameters");

  const [rows, [unread]] = await Promise.all([
    db
      .select({
        id: notifications.id,
        type: notifications.type,
        message: notifications.message,
        ticketId: notifications.ticketId,
        actorId: notifications.actorId,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(mine(auth))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(limit),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(mine(auth), isNull(notifications.readAt))),
  ]);
  res.status(200).json({ data: rows, unreadCount: unread?.count ?? 0 });
});

notificationsRouter.post("/read", async (req, res) => {
  const auth = getAuth(req);
  const { ids } = validate(markReadBody, req.body ?? {}, "request body");

  const updated = await db
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(
      and(
        mine(auth),
        // Already-read ones keep their original read time.
        isNull(notifications.readAt),
        ids ? inArray(notifications.id, ids) : undefined,
      ),
    )
    .returning({ id: notifications.id });
  res.status(200).json({ data: { updated: updated.length } });
});
