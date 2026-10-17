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
    },
    // Test files share one database, so run them one at a time.
    fileParallelism: false,
  },
});
