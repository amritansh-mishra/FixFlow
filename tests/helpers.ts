import { sql } from "drizzle-orm";
import { db } from "../src/db/index.js";
import {
  organizations,
  properties,
  tickets,
  users,
  type NewTicket,
  type UserRole,
} from "../src/db/schema.js";
import { TEST_DB_NAME } from "./test-db.js";

// Empty every table between tests so each test starts clean.
export async function resetDatabase() {
  // Safety net: refuse to wipe anything except the test database.
  const { rows } = await db.execute<{ name: string }>(sql`SELECT current_database() AS name`);
  if (rows[0]?.name !== TEST_DB_NAME) {
    throw new Error(`Refusing to reset database "${rows[0]?.name}"`);
  }
  await db.execute(sql`TRUNCATE ticket_events, tickets, properties, users, organizations CASCADE`);
}

async function createUser(organizationId: string, slug: string, name: string, role: UserRole) {
  const [user] = await db
    .insert(users)
    .values({ organizationId, name, email: `${name}@${slug}.test`, role })
    .returning();
  return user!;
}

// Creates an organization with one property and a user for every role.
export async function createOrg(slug: string) {
  const [org] = await db.insert(organizations).values({ name: `Org ${slug}`, slug }).returning();
  const id = org!.id;
  const [property] = await db
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
  const [ticket] = await db
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
