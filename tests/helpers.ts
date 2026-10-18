import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { pool } from "../src/db/index.js";
import * as schema from "../src/db/schema.js";
import { organizations, properties, tickets, users, type NewTicket, type UserRole } from "../src/db/schema.js";
import { closeQueue, notificationsQueue } from "../src/jobs/queue.js";
import { createSession } from "../src/modules/auth/auth.service.js";
import { TEST_DB_NAME, testDatabaseUrl } from "./test-db.js";

// The app under test connects as the restricted fixflow_app role, so it can't
// create organizations, wipe tables, and so on. Test setup does those things
// through this separate owner connection instead.
const adminPool = new pg.Pool({ connectionString: testDatabaseUrl("admin") });
export const adminDb = drizzle(adminPool, { schema });

// Use in afterAll: closes both connection pools.
export async function closeDatabases() {
  await pool.end();
  await adminPool.end();
  await closeQueue();
}

// Empty every table between tests so each test starts clean.
export async function resetDatabase() {
  // Safety net: refuse to wipe anything except the test database.
  const { rows } = await adminDb.execute<{ name: string }>(sql`SELECT current_database() AS name`);
  if (rows[0]?.name !== TEST_DB_NAME) {
    throw new Error(`Refusing to reset database "${rows[0]?.name}"`);
  }
  // Empty the (test) job queue too, so each test sees only its own jobs.
  await notificationsQueue().obliterate({ force: true });
  await adminDb.execute(sql`TRUNCATE notifications, sessions, ticket_comments, ticket_events, tickets, properties, users, organizations CASCADE`);
}

// Creates a user and logs them in, so tests can send `.auth(user.token, { type: "bearer" })`.
async function createUser(organizationId: string, slug: string, name: string, role: UserRole) {
  const [user] = await adminDb
    .insert(users)
    .values({ organizationId, name, email: `${name}@${slug}.test`, role })
    .returning();
  const { token } = await createSession(user!);
  return { ...user!, token };
}

// Creates an organization with one property and a user for every role.
export async function createOrg(slug: string) {
  const [org] = await adminDb.insert(organizations).values({ name: `Org ${slug}`, slug }).returning();
  const id = org!.id;
  const [property] = await adminDb
    .insert(properties)
    .values({ organizationId: id, name: `${slug} Block A` })
    .returning();
  return {
    org: org!,
    property: property!,
    resident: await createUser(id, slug, "resident", "resident"),
    resident2: await createUser(id, slug, "resident2", "resident"),
    technician: await createUser(id, slug, "technician", "technician"),
    technician2: await createUser(id, slug, "technician2", "technician"),
    manager: await createUser(id, slug, "manager", "manager"),
    admin: await createUser(id, slug, "admin", "admin"),
  };
}

export type Org = Awaited<ReturnType<typeof createOrg>>;

// Inserts a ticket directly (skipping the API), created by the org's resident.
export async function createTicket(org: Org, overrides: Partial<NewTicket> = {}) {
  const [ticket] = await adminDb
    .insert(tickets)
    .values({
      organizationId: org.org.id,
      propertyId: org.property.id,
      createdBy: org.resident.id,
      title: "Leaking tap",
      ...overrides,
    })
    .returning();
  return ticket!;
}
