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
      // Emails go to Mailpit (Docker Compose locally, a service in CI).
      SMTP_URL: "smtp://127.0.0.1:1025",
    },
    // Password hashing (scrypt) is deliberately slow (~180 ms per hash), so the
    // rate-limiting tests that log in 20+ times take several seconds. The
    // default 5 s limit made them flaky on a busy machine; CI is often slower.
    testTimeout: 15_000,
    // Test files share one database, so run them one at a time.
    fileParallelism: false,
  },
});
