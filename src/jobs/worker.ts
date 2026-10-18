// Creates the BullMQ worker that takes jobs off the notifications queue and
// runs them. Used by the standalone worker process (src/worker.ts) and, when
// RUN_WORKER_IN_API=true, by the API process itself (src/server.ts).

import { Worker, type Job } from "bullmq";
import { handleJob } from "./handler.js";
import { NOTIFICATIONS_QUEUE, redisConnection, type NotificationJob } from "./queue.js";

async function handle(job: Job<NotificationJob>) {
  console.log(`[worker] ${await handleJob(job)}`);
}

export function startWorker(): Worker<NotificationJob> {
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
  // Without a listener, a Redis connection error would crash the process.
  worker.on("error", (err) => console.error("[worker] error:", err.message));
  return worker;
}
