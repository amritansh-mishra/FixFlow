// The notifications job queue, stored in Redis by BullMQ.
//
// The API *adds* jobs here and returns immediately; the separate worker
// process (src/worker.ts) *runs* them. Like a restaurant: the waiter clips an
// order to the rail, the cook picks it up.

import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { env } from "../config/env.js";
import type { TicketStatus } from "../db/schema.js";

export const NOTIFICATIONS_QUEUE = "notifications";

// Every kind of job and the data it carries. Jobs hold IDs, not names or
// titles: the worker looks those up when it runs, so it always uses current data.
interface TicketJobBase {
  // A unique ID for this event, set when it's queued. Retries of the job keep
  // it, so it's what makes processing idempotent. (BullMQ's own job IDs are
  // only a counter per queue and repeat if Redis is reset.)
  eventId: string;
  organizationId: string;
  ticketId: string;
  // Who caused it. Never notified about their own action.
  actorId: string;
}
export type NotificationJob =
  | { kind: "test"; message: string }
  | (TicketJobBase & { kind: "ticket_assigned"; technicianId: string })
  | (TicketJobBase & { kind: "status_changed"; fromStatus: TicketStatus; toStatus: TicketStatus })
  | (TicketJobBase & { kind: "comment_added"; commentId: string })
  // Email the recipient of one notification. Separate from the job that
  // created the notification, so a failed email is retried on its own.
  | { kind: "send_email"; notificationId: string };

// The jobs the API queues when something happens to a ticket.
export type TicketNotificationJob = Exclude<NotificationJob, { kind: "test" } | { kind: "send_email" }>;

// The same, before an eventId is assigned (Omit applied to each member).
type WithoutEventId<T> = T extends unknown ? Omit<T, "eventId"> : never;
export type NewTicketNotificationJob = WithoutEventId<TicketNotificationJob>;

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
export async function enqueueNotification(event: NewTicketNotificationJob): Promise<void> {
  const job = { ...event, eventId: randomUUID() } as TicketNotificationJob;
  try {
    await notificationsQueue().add(job.kind, job);
  } catch (err) {
    console.error(`Could not queue ${job.kind} notification for ticket ${job.ticketId}:`, err);
  }
}

// Queues the email for a notification. The job ID is derived from the
// notification, so the same email can't be queued twice (BullMQ ignores a job
// whose ID already exists).
export async function enqueueEmail(notificationId: string): Promise<void> {
  await notificationsQueue().add("send_email", { kind: "send_email", notificationId }, { jobId: `email-${notificationId}` });
}

export async function closeQueue(): Promise<void> {
  await queue?.close();
  queue = undefined;
}
