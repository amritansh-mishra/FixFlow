// Turns one notification into an email to its recipient.

import { and, eq } from "drizzle-orm";
import { env } from "../config/env.js";
import { db } from "../db/index.js";
import { notifications, users } from "../db/schema.js";
import { mailer, type Mailer } from "../lib/email.js";

// HTML-escape text from the database (ticket titles, names) before putting
// it in an email's HTML, so a title like "<script>" shows as text.
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export async function processEmailJob(notificationId: string, send: Mailer = mailer): Promise<"sent" | "skipped"> {
  const [row] = await db
    .select({
      message: notifications.message,
      ticketId: notifications.ticketId,
      name: users.name,
      email: users.email,
    })
    .from(notifications)
    .innerJoin(users, and(eq(users.id, notifications.userId), eq(users.organizationId, notifications.organizationId)))
    .where(eq(notifications.id, notificationId));
  if (!row) return "skipped";

  const link = `${env.appUrl}/#/tickets/${row.ticketId}`;
  return send.send({
    to: row.email,
    subject: row.message,
    text: `Hi ${row.name},\n\n${row.message}.\n\nOpen the ticket: ${link}\n\n— FixFlow`,
    html: `<p>Hi ${escapeHtml(row.name)},</p>
<p>${escapeHtml(row.message)}.</p>
<p><a href="${escapeHtml(link)}">Open the ticket</a></p>
<p style="color:#6b7280">— FixFlow</p>`,
  });
}
