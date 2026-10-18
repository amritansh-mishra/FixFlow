// The background worker: a separate process that takes jobs off the
// notifications queue and runs them.
//
//   npm run worker        (development, restarts on file changes)
//   npm run worker:prod   (after npm run build)
//
// It runs alongside the API, not inside it, so slow work (like sending email)
// never makes an API request wait, and a crash here can't take the API down.

import { Worker, type Job } from "bullmq";
import { NOTIFICATIONS_QUEUE, redisConnection, type NotificationJob } from "./jobs/queue.js";

async function handle(job: Job<NotificationJob>) {
  switch (job.data.kind) {
    case "test":
      console.log(`[worker] test job ${job.id}: ${job.data.message}`);
      return;
  }
}

const worker = new Worker<NotificationJob>(NOTIFICATIONS_QUEUE, handle, {
  // Workers wait on Redis indefinitely; BullMQ requires retries to be unlimited.
  connection: { ...redisConnection, maxRetriesPerRequest: null },
  // How many jobs to run at the same time.
  concurrency: 5,
});

worker.on("ready", () => console.log(`[worker] listening on queue "${NOTIFICATIONS_QUEUE}"`));
worker.on("failed", (job, err) =>
  console.error(`[worker] job ${job?.id} (${job?.data.kind}) failed, attempt ${job?.attemptsMade}:`, err.message),
);

// Graceful shutdown: finish the jobs in progress, then exit.
async function shutdown(signal: string) {
  console.log(`[worker] ${signal} received, finishing current jobs`);
  await worker.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
