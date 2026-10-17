import "dotenv/config";

// Tests always use this separate database, never the real one.
export const TEST_DB_NAME = "fixflow_test";

// Same server and credentials as .env, but pointing at another database.
//   "app"   → DATABASE_URL       (restricted fixflow_app role: what the app uses)
//   "admin" → DATABASE_ADMIN_URL (table owner: creates the database, runs migrations, seeds data)
//
// Until the restricted role is set up, DATABASE_ADMIN_URL may be missing; then
// both point at DATABASE_URL (the owner) and the permission tests are skipped.
export function testDatabaseUrl(role: "app" | "admin", dbName = TEST_DB_NAME): string {
  const base =
    role === "admin" ? process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL : process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL must be set in .env to run tests");
  const url = new URL(base);
  url.pathname = `/${dbName}`;
  return url.toString();
}

// True once .env's DATABASE_URL uses the restricted fixflow_app role.
export function usingRestrictedAppRole(): boolean {
  const url = process.env.DATABASE_URL;
  return !!url && decodeURIComponent(new URL(url).username) === "fixflow_app";
}
