// What to do with each kind of job. Used by the worker process, and by tests
// to run queued jobs without starting a worker.

import type { Job } from "bullmq";
import { processEmailJob } from "./email.js";
import { processNotificationJob } from "./notifications.js";
import { processPasswordResetJob } from "./password-reset.js";
import { enqueueEmail, type NotificationJob } from "./queue.js";

export async function handleJob(job: Pick<Job<NotificationJob>, "id" | "data">): Promise<string> {
  const data = job.data;
  switch (data.kind) {
    case "test":
      return `test job: ${data.message}`;

    case "password_reset":
      return `password reset request: ${await processPasswordResetJob(data.organizationSlug, data.email)}`;

    case "send_email":
      return `email for notification ${data.notificationId}: ${await processEmailJob(data.notificationId)}`;

    default: {
      // A ticket event: create the notifications, then queue one email each.
      const created = await processNotificationJob(data);
      for (const notificationId of created) await enqueueEmail(notificationId);
      return `${data.kind} for ticket ${data.ticketId}: ${created.length} notification(s)`;
    }
  }
}
