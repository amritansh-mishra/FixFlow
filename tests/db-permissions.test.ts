// The app's database role (fixflow_app) can do its job and nothing more.
// These run through the same connection the app uses.

import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db/index.js";
import { closeDatabases, createOrg, createTicket, resetDatabase } from "./helpers.js";
import { usingRestrictedAppRole } from "./test-db.js";

beforeEach(resetDatabase);
afterAll(closeDatabases);

// Drizzle wraps database errors; the PostgreSQL error is the `cause`.
async function pgErrorOf(query: SQL) {
  try {
    await db.execute(query);
  } catch (err) {
    return (err as { cause?: { code?: string } }).cause ?? err;
  }
  throw new Error("Expected the query to be refused, but it succeeded");
}

// 42501 = insufficient_privilege
const PERMISSION_DENIED = { code: "42501" };

// Skipped (and reported as skipped) until .env uses fixflow_app: see README "Database users".
describe.skipIf(!usingRestrictedAppRole())("the app's database role", () => {
  it("connects as fixflow_app, not as a superuser", async () => {
    const { rows } = await db.execute<{ user: string; superuser: boolean }>(
      sql`SELECT current_user AS user, rolsuper AS superuser FROM pg_roles WHERE rolname = current_user`,
    );

    expect(rows[0]).toEqual({ user: "fixflow_app", superuser: false });
  });

  it.each([
    ["drop a table", sql`DROP TABLE tickets`],
    ["empty a table", sql`TRUNCATE tickets`],
    ["create a table", sql`CREATE TABLE sneaky (id int)`],
    ["change a table", sql`ALTER TABLE tickets ADD COLUMN sneaky text`],
    ["read the migration log", sql`SELECT * FROM drizzle.__drizzle_migrations`],
    ["delete an organization", sql`DELETE FROM organizations`],
    ["change an organization's slug", sql`UPDATE organizations SET slug = 'taken'`],
    ["delete a user", sql`DELETE FROM users`],
    ["delete a property", sql`DELETE FROM properties`],
    ["change a user's role", sql`UPDATE users SET role = 'admin'`],
    ["delete a ticket", sql`DELETE FROM tickets`],
    ["change a ticket's organization", sql`UPDATE tickets SET organization_id = organization_id`],
    ["rewrite history", sql`UPDATE ticket_events SET to_status = 'closed'`],
    ["delete history", sql`DELETE FROM ticket_events`],
    ["extend a session", sql`UPDATE sessions SET expires_at = now() + interval '1 year'`],
    ["edit a comment", sql`UPDATE ticket_comments SET body = 'edited'`],
    ["delete a comment", sql`DELETE FROM ticket_comments`],
    ["edit a notification", sql`UPDATE notifications SET message = 'edited'`],
    ["redirect a notification", sql`UPDATE notifications SET user_id = actor_id`],
    ["delete a notification", sql`DELETE FROM notifications`],
    ["delete an attachment record", sql`DELETE FROM ticket_attachments`],
    ["point an attachment at another file", sql`UPDATE ticket_attachments SET storage_key = 'other'`],
  ])("can't %s", async (_name, query) => {
    await createTicket(await createOrg("a"));

    expect(await pgErrorOf(query)).toMatchObject(PERMISSION_DENIED);
  });

  it("can still do what the app needs", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a);

    await db.execute(sql`UPDATE tickets SET status = 'assigned', assigned_to = ${a.technician.id} WHERE id = ${ticket.id}`);
    await db.execute(sql`UPDATE users SET password_hash = 'x' WHERE id = ${a.resident.id}`);
    await db.execute(sql`INSERT INTO ticket_events (organization_id, ticket_id, actor_id, type)
                         VALUES (${a.org.id}, ${ticket.id}, ${a.manager.id}, 'assigned')`);
    await db.execute(sql`DELETE FROM sessions WHERE user_id = ${a.resident.id}`);
    await db.execute(sql`INSERT INTO notifications (organization_id, user_id, actor_id, ticket_id, type, message, dedupe_key)
                         VALUES (${a.org.id}, ${a.technician.id}, ${a.manager.id}, ${ticket.id}, 'ticket_assigned', 'x', 'k1')`);
    await db.execute(sql`UPDATE notifications SET read_at = now() WHERE user_id = ${a.technician.id}`);
  });
});
