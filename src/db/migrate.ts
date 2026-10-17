// Minimal SQL migration runner.
//
//   npm run db:migrate             apply pending migrations
//   npm run db:migrate -- --dry-run  show what would happen, change nothing
//
// Each file in db/migrations runs once, in filename order, inside its own
// transaction. Applied files are recorded in the schema_migrations table along
// with a checksum, so editing a migration after it has run is detected.

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { env } from "../config/env.js";

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../db/migrations");
const BASELINE = "0000_baseline.sql";
// Arbitrary constant; makes two concurrent runs wait for each other.
const LOCK_ID = 727_001;

interface Migration {
  name: string;
  sql: string;
  checksum: string;
}

async function loadMigrations(): Promise<Migration[]> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  return Promise.all(
    files.map(async (name) => {
      const sql = await readFile(path.join(MIGRATIONS_DIR, name), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      return { name, sql, checksum };
    }),
  );
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const client = new pg.Client({ connectionString: env.databaseUrl });
  await client.connect();

  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_ID]);

    // In dry-run mode, peek without creating anything.
    const { rows: tracking } = await client.query<{ exists: boolean }>(
      "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists",
    );
    if (!tracking[0]?.exists && !dryRun) {
      await client.query(`
        CREATE TABLE schema_migrations (
          name        TEXT        PRIMARY KEY,
          checksum    TEXT        NOT NULL,
          applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
    }

    const applied = new Map<string, string>();
    if (tracking[0]?.exists) {
      const { rows } = await client.query<{ name: string; checksum: string }>(
        "SELECT name, checksum FROM schema_migrations",
      );
      for (const row of rows) applied.set(row.name, row.checksum);
    }

    const migrations = await loadMigrations();

    // A migration that already ran must never change; write a new one instead.
    for (const m of migrations) {
      const recorded = applied.get(m.name);
      if (recorded && recorded !== m.checksum) {
        throw new Error(`${m.name} was modified after it was applied. Add a new migration instead.`);
      }
    }

    // Existing database created before migrations existed: its tables already
    // match the baseline, so record the baseline as applied instead of running it.
    const { rows: existing } = await client.query<{ exists: boolean }>(
      "SELECT to_regclass('public.organizations') IS NOT NULL AS exists",
    );
    const baseline = migrations.find((m) => m.name === BASELINE);
    if (baseline && !applied.has(BASELINE) && existing[0]?.exists) {
      console.log(`baseline  ${BASELINE} (tables already exist, recording without running)`);
      if (!dryRun) {
        await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [
          baseline.name,
          baseline.checksum,
        ]);
      }
      applied.set(BASELINE, baseline.checksum);
    }

    const pending = migrations.filter((m) => !applied.has(m.name));
    if (pending.length === 0) {
      console.log("Database is up to date.");
      return;
    }

    for (const m of pending) {
      if (dryRun) {
        console.log(`pending   ${m.name}`);
        continue;
      }
      // All-or-nothing: if any statement fails, the whole file is rolled back.
      await client.query("BEGIN");
      try {
        await client.query(m.sql);
        await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [
          m.name,
          m.checksum,
        ]);
        await client.query("COMMIT");
        console.log(`applied   ${m.name}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${m.name} failed and was rolled back`, { cause: err });
      }
    }
    if (dryRun) console.log("Dry run: no changes made.");
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]).catch(() => {});
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
