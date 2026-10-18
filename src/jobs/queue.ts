// The notifications job queue, stored in Redis by BullMQ.
//
// The API *adds* jobs here and returns immediately; the separate worker
// process (src/worker.ts) *runs* them. Like a restaurant: the waiter clips an
// order to the rail, the cook picks it up.

import { Queue } from "bullmq";
import { env } from "../config/env.js";
import type { TicketStatus } from "../db/schema.js";

export const NOTIFICATIONS_QUEUE = "notifications";

// Every kind of job and the data it carries. Jobs hold IDs, not names or
// titles: the worker looks those up when it runs, so it always uses current data.
interface TicketJobBase {
  organizationId: string;
  ticketId: string;
  // Who caused it. Never notified about their own action.
  actorId: string;
}
export type NotificationJob =
  | { kind: "test"; message: string }
  | (TicketJobBase & { kind: "ticket_assigned"; technicianId: string })
  | (TicketJobBase & { kind: "status_changed"; fromStatus: TicketStatus; toStatus: TicketStatus })
  | (TicketJobBase & { kind: "comment_added"; commentId: string });

export type TicketNotificationJob = Exclude<NotificationJob, { kind: "test" }>;

export const redisConnection = { url: env.redisUrl };

// Created on first use, so code that never queues anything doesn't open a
// Redis connection.
let queue: Queue<NotificationJob> | undefined;

export function notificationsQueue(): Queue<NotificationJob> {
  queue ??= new Queue<NotificationJob>(NOTIFICATIONS_QUEUE, {
    // enableOfflineQueue: false makes adding a job fail fast if Redis is down,
    // instead of making the API request wait while it retries.
    connection: { ...redisConnection, enableOfflineQueue: false },
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

// Called by the API after a change has been saved. Notifications are
// "best effort": if Redis is unavailable the change still succeeds, and the
// failure is logged instead of turning the user's request into an error.
export async function enqueueNotification(job: TicketNotificationJob): Promise<void> {
  try {
    await notificationsQueue().add(job.kind, job);
  } catch (err) {
    console.error(`Could not queue ${job.kind} notification for ticket ${job.ticketId}:`, err);
  }
}

export async function closeQueue(): Promise<void> {
  await queue?.close();
  queue = undefined;
}
