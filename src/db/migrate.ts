// Applies Drizzle migrations from the drizzle/ folder.
//
//   npm run db:migrate              apply pending migrations
//   npm run db:migrate -- --status  list applied and pending migrations, change nothing
//
// Runs as DATABASE_ADMIN_URL (the table owner), because migrations change the
// schema. The app itself connects with the restricted DATABASE_URL.
//
// Drizzle records applied migrations in drizzle.__drizzle_migrations and runs
// all pending ones in a single transaction.

import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const migrationsFolder = path.resolve(import.meta.dirname, "../../drizzle");
// Arbitrary constant; makes two concurrent runs wait for each other.
const LOCK_ID = 727_001;

// Until the restricted app role is set up (README: "Database users"),
// DATABASE_URL is still the owner, so it can run migrations too.
const adminUrl = process.env.DATABASE_ADMIN_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!adminUrl) {
  console.error("Missing DATABASE_ADMIN_URL: migrations need the database owner's connection URL.");
  process.exit(1);
}
if (!process.env.DATABASE_ADMIN_URL?.trim()) {
  console.warn("Note: DATABASE_ADMIN_URL is not set; using DATABASE_URL for migrations.");
}
const pool = new pg.Pool({ connectionString: adminUrl });

async function lastAppliedMillis(): Promise<number | null> {
  const { rows } = await pool.query<{ exists: boolean }>(
    "SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS exists",
  );
  if (!rows[0]?.exists) return null;
  const { rows: last } = await pool.query<{ created_at: string }>(
    "SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1",
  );
  return last[0] ? Number(last[0].created_at) : null;
}

// Same rule Drizzle uses: a migration is applied if its timestamp is not newer
// than the newest timestamp recorded in the database.
async function printStatus() {
  const journal: { entries: { when: number; tag: string }[] } = JSON.parse(
    await readFile(path.join(migrationsFolder, "meta/_journal.json"), "utf8"),
  );
  const last = await lastAppliedMillis();
  for (const entry of journal.entries) {
    const applied = last !== null && entry.when <= last;
    console.log(`${applied ? "applied" : "pending"}   ${entry.tag}`);
  }
}

async function main() {
  // A dedicated connection holds the lock while migrations run on the pool.
  const lock = await pool.connect();
  try {
    await lock.query("SELECT pg_advisory_lock($1)", [LOCK_ID]);
    if (process.argv.includes("--status")) {
      await printStatus();
      return;
    }
    await migrate(drizzle(pool), { migrationsFolder });
    console.log("Migrations up to date.");
  } finally {
    await lock.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]).catch(() => {});
    lock.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
