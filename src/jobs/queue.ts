// The notifications job queue, stored in Redis by BullMQ.
//
// The API *adds* jobs here and returns immediately; the separate worker
// process (src/worker.ts) *runs* them. Like a restaurant: the waiter clips an
// order to the rail, the cook picks it up.

import { Queue } from "bullmq";
import { env } from "../config/env.js";

export const NOTIFICATIONS_QUEUE = "notifications";

// Every kind of job and the data it carries. More kinds are added as
// notifications are built; TypeScript checks each job matches its shape.
export type NotificationJob = { kind: "test"; message: string };

export const redisConnection = { url: env.redisUrl };

// Created on first use, so code that never queues anything (most tests, for
// example) doesn't open a Redis connection.
let queue: Queue<NotificationJob> | undefined;

export function notificationsQueue(): Queue<NotificationJob> {
  queue ??= new Queue<NotificationJob>(NOTIFICATIONS_QUEUE, {
    connection: redisConnection,
    defaultJobOptions: {
      // If a job fails, try again up to 3 times, waiting 1s, 2s, 4s…
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
      // Don't let finished jobs pile up in Redis forever.
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 1000 },
    },
  });
  return queue;
}

export async function closeQueue(): Promise<void> {
  await queue?.close();
  queue = undefined;
}
