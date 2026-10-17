// GET /api/stats: an overview of the organization's tickets for managers.
// The database does the counting (GROUP BY, FILTER, AVG), so this stays fast
// however many tickets there are.

import { sql } from "drizzle-orm";
import { Router } from "express";
import { db } from "../../db/index.js";
import { TICKET_PRIORITIES, TICKET_STATUSES } from "../../db/schema.js";
import { getAuth, requireUser } from "../../middleware/auth.js";
import { HttpError } from "../../middleware/errors.js";

export const statsRouter = Router();

statsRouter.use(requireUser);

// Turns [{ key, count }] rows into { every key: count }, with 0 for missing keys.
function countsByKey<K extends string>(keys: readonly K[], rows: { key: string; count: number }[]) {
  const counts = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  for (const row of rows) counts[row.key as K] = row.count;
  return counts;
}

statsRouter.get("/", async (req, res) => {
  const { organizationId, role } = getAuth(req);
  if (role !== "manager" && role !== "admin") {
    throw new HttpError(403, "FORBIDDEN", "Only managers and admins can view statistics");
  }

  const [byStatus, byPriority, resolution, workload] = await Promise.all([
    db.execute<{ key: string; count: number }>(sql`
      SELECT status AS key, count(*)::int AS count
      FROM tickets WHERE organization_id = ${organizationId}
      GROUP BY status`),
    db.execute<{ key: string; count: number }>(sql`
      SELECT priority AS key, count(*)::int AS count
      FROM tickets WHERE organization_id = ${organizationId}
      GROUP BY priority`),
    // Time from a ticket's creation to the FIRST time it was resolved.
    db.execute<{ hours: number | null; resolved: number }>(sql`
      SELECT round((avg(extract(epoch FROM r.resolved_at - t.created_at)) / 3600)::numeric, 1)::float AS hours,
             count(*)::int AS resolved
      FROM tickets t
      JOIN (
        SELECT ticket_id, min(created_at) AS resolved_at
        FROM ticket_events
        WHERE organization_id = ${organizationId} AND to_status = 'resolved'
        GROUP BY ticket_id
      ) r ON r.ticket_id = t.id
      WHERE t.organization_id = ${organizationId}`),
    // Every technician, including those with no tickets (LEFT JOIN).
    db.execute<{ id: string; name: string; active: number; completed: number }>(sql`
      SELECT u.id, u.name,
             count(t.id) FILTER (WHERE t.status IN ('assigned', 'in_progress'))::int AS active,
             count(t.id) FILTER (WHERE t.status IN ('resolved', 'closed'))::int AS completed
      FROM users u
      LEFT JOIN tickets t ON t.assigned_to = u.id AND t.organization_id = u.organization_id
      WHERE u.organization_id = ${organizationId} AND u.role = 'technician'
      GROUP BY u.id, u.name
      ORDER BY active DESC, u.name`),
  ]);

  const statusCounts = countsByKey(TICKET_STATUSES, byStatus.rows);
  res.status(200).json({
    data: {
      total: Object.values(statusCounts).reduce((sum, n) => sum + n, 0),
      byStatus: statusCounts,
      byPriority: countsByKey(TICKET_PRIORITIES, byPriority.rows),
      averageResolutionHours: resolution.rows[0]?.hours ?? null,
      resolvedTickets: resolution.rows[0]?.resolved ?? 0,
      technicians: workload.rows,
    },
  });
});
