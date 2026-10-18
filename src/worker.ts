// The background worker: a separate process that takes jobs off the
// notifications queue and runs them.
//
//   npm run worker        (development, restarts on file changes)
//   npm run worker:prod   (after npm run build)
//
// It runs alongside the API, not inside it, so slow work (like sending email)
// never makes an API request wait, and a crash here can't take the API down.
// (On hosting without a free worker, RUN_WORKER_IN_API=true runs the same
// worker inside the API process instead: see src/server.ts.)

import { pool } from "./db/index.js";
import { closeQueue } from "./jobs/queue.js";
import { startWorker } from "./jobs/worker.js";

const worker = startWorker();

// Graceful shutdown: finish the jobs in progress, then exit.
async function shutdown(signal: string) {
  console.log(`[worker] ${signal} received, finishing current jobs`);
  await worker.close();
  await closeQueue();
  await pool.end();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
