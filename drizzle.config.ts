import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Workflow: edit src/db/schema.ts → `npm run db:generate` → review the SQL in
// drizzle/ → `npm run db:migrate`. Never use `drizzle-kit push` on real data.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL! },
  schemaFilter: ["public"],
  strict: true,
  verbose: true,
});
