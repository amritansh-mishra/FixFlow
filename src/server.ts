import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { pool } from "./db/index.js";

const app = createApp();

const server = app.listen(env.port, async () => {
  console.log(`FixFlow API running at http://localhost:${env.port} (${env.nodeEnv})`);
  try {
    await pool.query("SELECT 1");
    console.log("Connected to PostgreSQL");
  } catch (err) {
    console.error("PostgreSQL connection error on startup:", err);
  }
});

// Graceful shutdown: stop accepting requests, then close the DB pool.
function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  // Force exit if open connections keep the server alive too long.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
