// Email notifications, checked by reading what actually arrived in Mailpit.

import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { processEmailJob } from "../src/jobs/email.js";
import { enqueueEmail, notificationsQueue } from "../src/jobs/queue.js";
import { createMailer } from "../src/lib/email.js";
import { closeDatabases, createOrg, createTicket, resetDatabase, runQueuedJobs } from "./helpers.js";

const app = createApp();
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";

interface MailSummary {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

async function inbox(): Promise<MailSummary[]> {
  const res = await fetch(`${MAILPIT}/api/v1/messages`);
  return ((await res.json()) as { messages: MailSummary[] }).messages;
}

async function body(id: string): Promise<{ Text: string; HTML: string }> {
  return (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as { Text: string; HTML: string };
}

beforeEach(async () => {
  await resetDatabase();
  await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });
});
afterAll(closeDatabases);

describe("email notifications", () => {
  it("assigning a ticket emails the technician, with a link to the ticket", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a, { title: "Wi-Fi down" });

    await request(app)
      .patch(`/api/tickets/${ticket.id}/assign`)
      .auth(a.manager.token, { type: "bearer" })
      .send({ technicianId: a.technician.id });
    const ran = await runQueuedJobs();

    expect(ran).toEqual(["ticket_assigned", "send_email"]);
    const mails = await inbox();
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ Subject: 'manager assigned you "Wi-Fi down"', To: [{ Address: "technician@a.test" }] });
    const { Text } = await body(mails[0]!.ID);
    expect(Text).toContain("Hi technician,");
    expect(Text).toContain(`http://localhost:5173/#/tickets/${ticket.id}`);
  });

  it("a comment emails everyone it notifies", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a, { title: "Leak", status: "assigned", assignedTo: a.technician.id });

    await request(app)
      .post(`/api/tickets/${ticket.id}/comments`)
      .auth(a.manager.token, { type: "bearer" })
      .send({ body: "Any update?" });
    await runQueuedJobs();

    expect((await inbox()).flatMap((m) => m.To.map((t) => t.Address)).sort()).toEqual([
      "resident@a.test",
      "technician@a.test",
    ]);
  });

  it("escapes HTML from ticket titles in the email body", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a, { title: "<b>Broken</b> door" });

    await request(app)
      .patch(`/api/tickets/${ticket.id}/assign`)
      .auth(a.manager.token, { type: "bearer" })
      .send({ technicianId: a.technician.id });
    await runQueuedJobs();

    const { HTML } = await body((await inbox())[0]!.ID);
    expect(HTML).toContain("&lt;b&gt;Broken&lt;/b&gt; door");
    expect(HTML).not.toContain("<b>Broken</b>");
  });

  it("the same notification can't be queued for email twice", async () => {
    await enqueueEmail("00000000-0000-0000-0000-000000000001");
    await enqueueEmail("00000000-0000-0000-0000-000000000001");

    expect(await notificationsQueue().getJobs(["waiting"])).toHaveLength(1);
  });

  it("skips a notification that doesn't exist", async () => {
    expect(await processEmailJob("00000000-0000-0000-0000-000000000000")).toBe("skipped");
  });

  it("skips sending when no SMTP server is configured", async () => {
    const noSmtp = createMailer(undefined, "x@example.com");

    expect(await noSmtp.send({ to: "a@b.c", subject: "s", text: "t", html: "h" })).toBe("skipped");
  });
});
