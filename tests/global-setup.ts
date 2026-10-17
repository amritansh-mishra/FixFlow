// Runs once before all tests: recreate the test database from the migrations,
// so every test run starts from exactly the schema in drizzle/.

import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { TEST_DB_NAME, testDatabaseUrl } from "./test-db.js";

export default async function setup() {
  const admin = new pg.Client({ connectionString: testDatabaseUrl("postgres") });
  await admin.connect();
  try {
    // TEST_DB_NAME is a constant, never user input, so building SQL with it is safe.
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  } finally {
    await admin.end();
  }

  const pool = new pg.Pool({ connectionString: testDatabaseUrl() });
  try {
    await migrate(drizzle(pool), {
      migrationsFolder: path.resolve(import.meta.dirname, "../drizzle"),
    });
  } finally {
    await pool.end();
  }
}
