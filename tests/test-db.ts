import "dotenv/config";

// Tests always use this separate database, never the real one.
export const TEST_DB_NAME = "fixflow_test";

// Same server and credentials as .env's DATABASE_URL, different database name.
export function testDatabaseUrl(dbName = TEST_DB_NAME): string {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL must be set in .env to run tests");
  const url = new URL(base);
  url.pathname = `/${dbName}`;
  return url.toString();
}
