import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Workflow: edit src/db/schema.ts → `npm run db:generate` → review the SQL in
// drizzle/ → `npm run db:migrate`. Never use `drizzle-kit push` on real data.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  // Schema tools (check, studio) connect as the table owner, not the restricted app user.
  dbCredentials: { url: (process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL)! },
  schemaFilter: ["public"],
  strict: true,
  verbose: true,
});
