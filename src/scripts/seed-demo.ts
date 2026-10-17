// Creates a demo organization ("demo") with users, properties and tickets in
// every workflow state, so the deployed API can be tried right away.
//
//   SEED_DEMO=true DEMO_PASSWORD=... npm run db:seed-demo
//
// Safe to run on every deploy: it does nothing unless SEED_DEMO=true, and
// nothing if the demo organization already exists. It never changes other data.

import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import pg from "pg";
import * as schema from "../db/schema.js";
import { organizations, properties, ticketComments, ticketEvents, tickets, users, type UserRole } from "../db/schema.js";
import { hashPassword } from "../lib/passwords.js";

const DEMO_SLUG = "demo";
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

async function main() {
  if (process.env.SEED_DEMO !== "true") return;

  const password = process.env.DEMO_PASSWORD ?? "";
  if (password.length < 12) {
    console.warn("Demo seed skipped: DEMO_PASSWORD must be set and at least 12 characters.");
    return;
  }

  // Seeding creates organizations and users, which the restricted app role
  // can't do, so connect as the owner.
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });
  try {
    const [existing] = await db.select().from(organizations).where(eq(organizations.slug, DEMO_SLUG));
    if (existing) {
      console.log("Demo organization already exists; nothing to seed.");
      return;
    }

    const passwordHash = await hashPassword(password);

    await db.transaction(async (tx) => {
      const [org] = await tx.insert(organizations).values({ name: "Demo Campus", slug: DEMO_SLUG }).returning();
      const orgId = org!.id;

      const [hostel, library] = await tx
        .insert(properties)
        .values([
          { organizationId: orgId, name: "Hostel Block A", address: "North Campus" },
          { organizationId: orgId, name: "Central Library", address: "Main Campus" },
        ])
        .returning();

      const person = async (name: string, email: string, role: UserRole) => {
        const [user] = await tx
          .insert(users)
          .values({ organizationId: orgId, name, email, role, passwordHash })
          .returning();
        return user!;
      };
      const admin = await person("Asha Admin", "admin@example.com", "admin");
      const manager = await person("Meera Manager", "manager@example.com", "manager");
      const tech = await person("Ravi Technician", "technician@example.com", "technician");
      const resident = await person("Rohan Resident", "resident@example.com", "resident");
      const resident2 = await person("Priya Resident", "resident2@example.com", "resident");

      // Each ticket with the history of how it reached its current status.
      const ticket = async (
        values: Omit<typeof tickets.$inferInsert, "organizationId">,
        events: Omit<typeof ticketEvents.$inferInsert, "organizationId" | "ticketId">[],
      ) => {
        const [row] = await tx.insert(tickets).values({ organizationId: orgId, ...values }).returning();
        await tx.insert(ticketEvents).values(events.map((e) => ({ organizationId: orgId, ticketId: row!.id, ...e })));
        return row!;
      };
      // A comment and its history entry.
      const say = async (ticketId: string, authorId: string, body: string, when: Date) => {
        await tx.insert(ticketComments).values({ organizationId: orgId, ticketId, authorId, body, createdAt: when });
        await tx.insert(ticketEvents).values({ organizationId: orgId, ticketId, actorId: authorId, type: "commented", createdAt: when });
      };

      await ticket(
        { propertyId: hostel!.id, createdBy: resident.id, title: "Leaking tap in Room 204", description: "Bathroom tap drips all night.", priority: "medium", createdAt: daysAgo(1) },
        [{ actorId: resident.id, type: "created", toStatus: "open", createdAt: daysAgo(1) }],
      );
      await ticket(
        { propertyId: hostel!.id, createdBy: resident2.id, assignedTo: tech.id, status: "assigned", title: "Wi-Fi down on 2nd floor", priority: "high", createdAt: daysAgo(2) },
        [
          { actorId: resident2.id, type: "created", toStatus: "open", createdAt: daysAgo(2) },
          { actorId: manager.id, type: "assigned", fromStatus: "open", toStatus: "assigned", assignedTo: tech.id, createdAt: daysAgo(1.5) },
        ],
      );
      const projector = await ticket(
        { propertyId: library!.id, createdBy: resident.id, assignedTo: tech.id, status: "in_progress", title: "Projector not working in seminar hall", priority: "urgent", createdAt: daysAgo(3) },
        [
          { actorId: resident.id, type: "created", toStatus: "open", createdAt: daysAgo(3) },
          { actorId: manager.id, type: "assigned", fromStatus: "open", toStatus: "assigned", assignedTo: tech.id, createdAt: daysAgo(2.8) },
          { actorId: tech.id, type: "status_changed", fromStatus: "assigned", toStatus: "in_progress", createdAt: daysAgo(2.5) },
        ],
      );
      await say(projector.id, resident.id, "We have a guest lecture on Friday. Any chance it is fixed by then?", daysAgo(2.4));
      await say(projector.id, tech.id, "The lamp has burnt out. Replacement ordered, it arrives Thursday.", daysAgo(2.2));
      await say(projector.id, manager.id, "Thanks Ravi. Please confirm here once it is installed.", daysAgo(2));
      await ticket(
        { propertyId: library!.id, createdBy: resident2.id, assignedTo: tech.id, status: "resolved", title: "Flickering lights in reading room", priority: "low", createdAt: daysAgo(6) },
        [
          { actorId: resident2.id, type: "created", toStatus: "open", createdAt: daysAgo(6) },
          { actorId: admin.id, type: "assigned", fromStatus: "open", toStatus: "assigned", assignedTo: tech.id, createdAt: daysAgo(5.5) },
          { actorId: tech.id, type: "status_changed", fromStatus: "assigned", toStatus: "in_progress", createdAt: daysAgo(5) },
          { actorId: tech.id, type: "status_changed", fromStatus: "in_progress", toStatus: "resolved", createdAt: daysAgo(4) },
        ],
      );
      await ticket(
        { propertyId: hostel!.id, createdBy: resident.id, assignedTo: tech.id, status: "closed", title: "Blocked drain near the mess", priority: "high", createdAt: daysAgo(10) },
        [
          { actorId: resident.id, type: "created", toStatus: "open", createdAt: daysAgo(10) },
          { actorId: manager.id, type: "assigned", fromStatus: "open", toStatus: "assigned", assignedTo: tech.id, createdAt: daysAgo(9.8) },
          { actorId: tech.id, type: "status_changed", fromStatus: "assigned", toStatus: "in_progress", createdAt: daysAgo(9.5) },
          { actorId: tech.id, type: "status_changed", fromStatus: "in_progress", toStatus: "resolved", createdAt: daysAgo(9) },
          { actorId: resident.id, type: "status_changed", fromStatus: "resolved", toStatus: "closed", createdAt: daysAgo(8) },
        ],
      );
    });
    console.log('Demo organization "demo" seeded.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Demo seed failed:", err);
  process.exit(1);
});
