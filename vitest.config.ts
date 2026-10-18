import { defineConfig } from "vitest/config";
import { testDatabaseUrl } from "./tests/test-db.js";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["./tests/global-setup.ts"],
    // Point the app at the test database (as the restricted app role) instead of the real one.
    env: {
      NODE_ENV: "test",
      DATABASE_URL: testDatabaseUrl("app"),
      CORS_ORIGINS: "http://localhost:5173",
      // Redis database 1, so tests never touch the dev queue (database 0).
      REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://localhost:6379/1",
    },
    // Test files share one database, so run them one at a time.
    fileParallelism: false,
  },
});
