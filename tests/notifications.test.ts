// Notifications end to end: the API queues a job, the job is processed into
// notification rows (as the worker would), and users read them.

import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { notifications } from "../src/db/schema.js";
import { processNotificationJob } from "../src/jobs/notifications.js";
import { notificationsQueue, type TicketNotificationJob } from "../src/jobs/queue.js";
import { adminDb, closeDatabases, createOrg, createTicket, resetDatabase, runQueuedJobs } from "./helpers.js";

const app = createApp();

beforeEach(resetDatabase);
afterAll(closeDatabases);

type AsUser = { token: string };

const inbox = (asUser: AsUser) => request(app).get("/api/notifications").auth(asUser.token, { type: "bearer" });
const messages = async (asUser: AsUser) =>
  (await inbox(asUser)).body.data.map((n: { message: string }) => n.message);

describe("the API queues a job for each event", () => {
  it("on assignment, status change and comment", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a, { title: "Wi-Fi down" });
    const auth = { type: "bearer" } as const;

    await request(app).patch(`/api/tickets/${ticket.id}/assign`).auth(a.manager.token, auth).send({ technicianId: a.technician.id });
    await request(app).patch(`/api/tickets/${ticket.id}/status`).auth(a.technician.token, auth).send({ status: "in_progress" });
    await request(app).post(`/api/tickets/${ticket.id}/comments`).auth(a.technician.token, auth).send({ body: "On it" });

    const jobs = await notificationsQueue().getJobs(["waiting"]);
    expect(jobs.map((j) => j.data.kind).sort()).toEqual(["comment_added", "status_changed", "ticket_assigned"]);
    expect(jobs.find((j) => j.data.kind === "ticket_assigned")!.data).toMatchObject({
      organizationId: a.org.id,
      ticketId: ticket.id,
      actorId: a.manager.id,
      technicianId: a.technician.id,
    });
  });

  it("not when the request is refused", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a);

    const res = await request(app)
      .patch(`/api/tickets/${ticket.id}/assign`)
      .auth(a.resident.token, { type: "bearer" })
      .send({ technicianId: a.technician.id });

    expect(res.status).toBe(403);
    expect(await notificationsQueue().getJobs(["waiting"])).toHaveLength(0);
  });
});

describe("processing jobs into notifications", () => {
  it("assignment notifies the technician", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a, { title: "Wi-Fi down" });

    await request(app)
      .patch(`/api/tickets/${ticket.id}/assign`)
      .auth(a.manager.token, { type: "bearer" })
      .send({ technicianId: a.technician.id });
    await runQueuedJobs();

    expect(await messages(a.technician)).toEqual(['manager assigned you "Wi-Fi down"']);
    expect(await messages(a.resident)).toEqual([]);
  });

  it("a status change by the technician notifies the reporter, not the technician", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a, { title: "Leak", status: "in_progress", assignedTo: a.technician.id });

    await request(app)
      .patch(`/api/tickets/${ticket.id}/status`)
      .auth(a.technician.token, { type: "bearer" })
      .send({ status: "resolved" });
    await runQueuedJobs();

    expect(await messages(a.resident)).toEqual(['technician moved "Leak" to Resolved']);
    expect(await messages(a.technician)).toEqual([]);
  });

  it("closing by the reporter notifies the technician", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a, { title: "Leak", status: "resolved", assignedTo: a.technician.id });

    await request(app)
      .patch(`/api/tickets/${ticket.id}/status`)
      .auth(a.resident.token, { type: "bearer" })
      .send({ status: "closed" });
    await runQueuedJobs();

    expect(await messages(a.technician)).toEqual(['resident moved "Leak" to Closed']);
    expect(await messages(a.resident)).toEqual([]);
  });

  it("a comment notifies the others on the ticket, never the commenter", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a, { title: "Leak", status: "assigned", assignedTo: a.technician.id });

    await request(app)
      .post(`/api/tickets/${ticket.id}/comments`)
      .auth(a.manager.token, { type: "bearer" })
      .send({ body: "Any update?" });
    await runQueuedJobs();

    expect(await messages(a.resident)).toEqual(['manager commented on "Leak"']);
    expect(await messages(a.technician)).toEqual(['manager commented on "Leak"']);
    expect(await messages(a.manager)).toEqual([]);
  });

  // Regression test: duplicate protection used BullMQ's job number, which is
  // only a counter per queue. After a Redis reset the numbers repeat, and new
  // notifications were silently dropped as "duplicates".
  it("still notifies after Redis is reset and job numbers start again", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a, { title: "Leak", status: "assigned", assignedTo: a.technician.id });
    const comment = (body: string) =>
      request(app).post(`/api/tickets/${ticket.id}/comments`).auth(a.manager.token, { type: "bearer" }).send({ body });

    await comment("first");
    const [firstJob] = await notificationsQueue().getJobs(["waiting"]);
    await runQueuedJobs();
    await notificationsQueue().obliterate({ force: true }); // like a Redis reset: numbering restarts
    await comment("second");
    const [secondJob] = await notificationsQueue().getJobs(["waiting"]);
    await runQueuedJobs();

    expect(secondJob!.id).toBe(firstJob!.id); // the job numbers really did repeat
    expect(await messages(a.technician)).toHaveLength(2);
  });

  it("is idempotent: processing the same job twice creates no duplicates", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a, { status: "assigned", assignedTo: a.technician.id });
    const job: TicketNotificationJob = {
      eventId: "11111111-1111-1111-1111-111111111111",
      kind: "comment_added",
      organizationId: a.org.id,
      ticketId: ticket.id,
      actorId: a.manager.id,
      commentId: "00000000-0000-0000-0000-000000000000",
    };

    const first = await processNotificationJob(job);
    const retry = await processNotificationJob(job); // e.g. BullMQ retrying after a crash

    expect(first).toHaveLength(2);
    expect(retry).toEqual([]);
    expect(await adminDb.select().from(notifications)).toHaveLength(2);
  });
});

describe("GET /api/notifications and POST /api/notifications/read", () => {
  async function seedNotifications() {
    const a = await createOrg("a");
    const ticket = await createTicket(a, { title: "Leak", status: "assigned", assignedTo: a.technician.id });
    for (const body of ["one", "two", "three"]) {
      await request(app)
        .post(`/api/tickets/${ticket.id}/comments`)
        .auth(a.manager.token, { type: "bearer" })
        .send({ body });
    }
    await runQueuedJobs();
    return a;
  }

  it("lists only your own notifications, newest first, with the unread count", async () => {
    const a = await seedNotifications();
    const b = await createOrg("b");

    const mine = await inbox(a.technician);
    const other = await inbox(b.technician);

    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(3);
    expect(mine.body.unreadCount).toBe(3);
    expect(mine.body.data[0].readAt).toBeNull();
    expect(other.body).toEqual({ data: [], unreadCount: 0 });
  });

  it("marks chosen notifications as read", async () => {
    const a = await seedNotifications();
    const [first] = (await inbox(a.technician)).body.data;

    const res = await request(app)
      .post("/api/notifications/read")
      .auth(a.technician.token, { type: "bearer" })
      .send({ ids: [first.id] });

    expect(res.body.data.updated).toBe(1);
    expect((await inbox(a.technician)).body.unreadCount).toBe(2);
  });

  it("marks everything as read with an empty body", async () => {
    const a = await seedNotifications();

    const res = await request(app).post("/api/notifications/read").auth(a.technician.token, { type: "bearer" }).send({});

    expect(res.body.data.updated).toBe(3);
    expect((await inbox(a.technician)).body.unreadCount).toBe(0);
  });

  it("can't mark someone else's notifications as read", async () => {
    const a = await seedNotifications();
    const theirs = (await inbox(a.technician)).body.data.map((n: { id: string }) => n.id);

    const res = await request(app)
      .post("/api/notifications/read")
      .auth(a.resident.token, { type: "bearer" })
      .send({ ids: theirs });

    expect(res.body.data.updated).toBe(0);
    expect((await inbox(a.technician)).body.unreadCount).toBe(3);
  });

  it("validates the body", async () => {
    const a = await createOrg("a");

    const res = await request(app)
      .post("/api/notifications/read")
      .auth(a.technician.token, { type: "bearer" })
      .send({ ids: ["not-a-uuid"] });

    expect(res.status).toBe(400);
  });
});
