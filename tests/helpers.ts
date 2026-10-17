import { sql } from "drizzle-orm";
import { db } from "../src/db/index.js";
import { organizations, properties, tickets, users, type NewTicket } from "../src/db/schema.js";
import { TEST_DB_NAME } from "./test-db.js";

// Empty every table between tests so each test starts clean.
export async function resetDatabase() {
  // Safety net: refuse to wipe anything except the test database.
  const { rows } = await db.execute<{ name: string }>(sql`SELECT current_database() AS name`);
  if (rows[0]?.name !== TEST_DB_NAME) {
    throw new Error(`Refusing to reset database "${rows[0]?.name}"`);
  }
  await db.execute(sql`TRUNCATE tickets, properties, users, organizations CASCADE`);
}

// Creates an organization with one resident and one property.
export async function createOrg(slug: string) {
  const [org] = await db.insert(organizations).values({ name: `Org ${slug}`, slug }).returning();
  const [resident] = await db
    .insert(users)
    .values({ organizationId: org!.id, name: "Resident", email: `resident@${slug}.test`, role: "resident" })
    .returning();
  const [property] = await db
    .insert(properties)
    .values({ organizationId: org!.id, name: `${slug} Block A` })
    .returning();
  return { org: org!, resident: resident!, property: property! };
}

type Org = Awaited<ReturnType<typeof createOrg>>;

export async function createTicket(
  { org, resident, property }: Org,
  overrides: Partial<NewTicket> = {},
) {
  const [ticket] = await db
    .insert(tickets)
    .values({
      organizationId: org.id,
      propertyId: property.id,
      createdBy: resident.id,
      title: "Leaking tap",
      ...overrides,
    })
    .returning();
  return ticket!;
}
