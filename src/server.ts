import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { pool } from "./db/index.js";
import { closeQueue } from "./jobs/queue.js";
import { startWorker } from "./jobs/worker.js";
import { ensureBucket } from "./lib/storage.js";

const app = createApp();

// Optionally run the background worker in this same process (see env.ts).
const worker = env.runWorkerInApi ? startWorker() : undefined;
if (worker) console.log("Background worker running inside the API process (RUN_WORKER_IN_API=true)");

const server = app.listen(env.port, async () => {
  console.log(`FixFlow API running at http://localhost:${env.port} (${env.nodeEnv})`);
  try {
    await pool.query("SELECT 1");
    console.log("Connected to PostgreSQL");
  } catch (err) {
    console.error("PostgreSQL connection error on startup:", err);
  }
  // Locally, create the storage bucket if it's missing. (In production the
  // R2 bucket is created once in the Cloudflare dashboard.)
  if (env.nodeEnv !== "production") {
    await ensureBucket().catch((err) => console.warn("File storage not reachable yet:", err.message));
  }
});

// Graceful shutdown: stop accepting requests, finish running jobs, then close
// the queue and the DB pool.
function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  server.close(async () => {
    await worker?.close();
    await closeQueue();
    await pool.end();
    process.exit(0);
  });
  // Force exit if open connections keep the server alive too long.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
