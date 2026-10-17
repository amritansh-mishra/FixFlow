// Integration tests: assignment, status changes and history, through the API.

import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { db, pool } from "../src/db/index.js";
import { ticketEvents } from "../src/db/schema.js";
import { closeDatabases, createOrg, createTicket, resetDatabase } from "./helpers.js";

const app = createApp();
const NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000";

beforeEach(resetDatabase);
afterAll(closeDatabases);

type AsUser = { token: string };

const assign = (ticketId: string, asUser: AsUser, technicianId: string) =>
  request(app).patch(`/api/tickets/${ticketId}/assign`).auth(asUser.token, { type: "bearer" }).send({ technicianId });

const setStatus = (ticketId: string, asUser: AsUser, status: string) =>
  request(app).patch(`/api/tickets/${ticketId}/status`).auth(asUser.token, { type: "bearer" }).send({ status });

const history = (ticketId: string, asUser: AsUser) =>
  request(app).get(`/api/tickets/${ticketId}/history`).auth(asUser.token, { type: "bearer" });

// Polls PostgreSQL until `count` queries are waiting for a lock.
async function waitForQueriesBlockedOnLocks(count: number) {
  for (let i = 0; i < 250; i++) {
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if (rows[0]!.n >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${count} queries to block on a lock`);
}

describe("the full workflow", () => {
  it("resident reports → manager assigns → technician works → resident closes", async () => {
    const a = await createOrg("a");

    const created = await request(app)
      .post("/api/tickets")
      .auth(a.resident.token, { type: "bearer" })
      .send({ propertyId: a.property.id, title: "Leaking tap" });
    const id = created.body.data.id;

    expect((await assign(id, a.manager, a.technician.id)).body.data).toMatchObject({
      status: "assigned",
      assignedTo: a.technician.id,
    });
    expect((await setStatus(id, a.technician, "in_progress")).body.data.status).toBe("in_progress");
    expect((await setStatus(id, a.technician, "resolved")).body.data.status).toBe("resolved");
    expect((await setStatus(id, a.resident, "closed")).body.data.status).toBe("closed");

    const res = await history(id, a.resident);
    expect(res.status).toBe(200);
    expect(
      res.body.data.map((e: Record<string, unknown>) => [e.type, e.actorId, e.fromStatus, e.toStatus]),
    ).toEqual([
      ["created", a.resident.id, null, "open"],
      ["assigned", a.manager.id, "open", "assigned"],
      ["status_changed", a.technician.id, "assigned", "in_progress"],
      ["status_changed", a.technician.id, "in_progress", "resolved"],
      ["status_changed", a.resident.id, "resolved", "closed"],
    ]);
    expect(res.body.data[1].assignedTo).toBe(a.technician.id);
  });

  it("updates updated_at on every change", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a);

    const res = await assign(ticket.id, a.manager, a.technician.id);

    expect(new Date(res.body.data.updatedAt).getTime()).toBeGreaterThan(ticket.updatedAt.getTime());
  });
});

describe("PATCH /api/tickets/:id/assign", () => {
  it.each(["manager", "admin"] as const)("lets a %s assign a technician", async (role) => {
    const a = await createOrg("a");
    const ticket = await createTicket(a);

    const res = await assign(ticket.id, a[role], a.technician.id);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "assigned", assignedTo: a.technician.id });
  });

  it.each(["resident", "technician"] as const)("forbids a %s from assigning", async (role) => {
    const a = await createOrg("a");
    // Created by the resident and assigned to the technician, so both can see it.
    const ticket = await createTicket(a, { status: "assigned", assignedTo: a.technician.id });

    const res = await assign(ticket.id, a[role], a.technician.id);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(await db.select().from(ticketEvents)).toHaveLength(0);
  });

  it("allows reassigning before work starts", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a, { status: "assigned", assignedTo: a.technician.id });

    const res = await assign(ticket.id, a.manager, a.technician2.id);

    expect(res.status).toBe(200);
    expect(res.body.data.assignedTo).toBe(a.technician2.id);
  });

  it.each(["in_progress", "resolved", "closed"] as const)("refuses to assign a ticket that is %s", async (status) => {
    const a = await createOrg("a");
    const ticket = await createTicket(a, { status, assignedTo: a.technician.id });

    const res = await assign(ticket.id, a.manager, a.technician2.id);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
  });

  it("only assigns to technicians", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a);

    const res = await assign(ticket.id, a.manager, a.resident2.id);

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ path: "technicianId", message: "Technician not found" }]);
  });

  it("won't assign a technician from another organization", async () => {
    const a = await createOrg("a");
    const b = await createOrg("b");
    const ticket = await createTicket(a);

    const res = await assign(ticket.id, a.manager, b.technician.id);

    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe("technicianId");
  });

  it("returns 404 for another organization's ticket", async () => {
    const a = await createOrg("a");
    const b = await createOrg("b");
    const bTicket = await createTicket(b);

    const res = await assign(bTicket.id, a.manager, a.technician.id);

    expect(res.status).toBe(404);
  });

  it("validates the body", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a);

    const res = await request(app)
      .patch(`/api/tickets/${ticket.id}/assign`)
      .auth(a.manager.token, { type: "bearer" })
      .send({ technicianId: "nope", status: "closed" });

    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(["technicianId", ""]);
  });
});

describe("PATCH /api/tickets/:id/status", () => {
  it("lets the creator reopen a resolved ticket", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a, { status: "resolved", assignedTo: a.technician.id });

    const res = await setStatus(ticket.id, a.resident, "in_progress");

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("in_progress");
  });

  it("lets a manager close a resolved ticket", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a, { status: "resolved", assignedTo: a.technician.id });

    expect((await setStatus(ticket.id, a.manager, "closed")).status).toBe(200);
  });

  // These users can see the ticket, but the rules don't let them make the change.
  it.each([
    ["the manager starts work", "manager", "assigned", "in_progress"],
    ["the creator resolves", "resident", "in_progress", "resolved"],
    ["the technician closes", "technician", "resolved", "closed"],
  ] as const)("forbids: %s", async (_name, who, from, to) => {
    const a = await createOrg("a");
    const ticket = await createTicket(a, { status: from, assignedTo: a.technician.id });

    const res = await setStatus(ticket.id, a[who], to);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  // These users can't even see the ticket, so it doesn't exist for them.
  it.each([
    ["another technician starts work", "technician2", "assigned", "in_progress"],
    ["another resident closes", "resident2", "resolved", "closed"],
  ] as const)("returns 404 when %s (can't see the ticket)", async (_name, who, from, to) => {
    const a = await createOrg("a");
    const ticket = await createTicket(a, { status: from, assignedTo: a.technician.id });

    const res = await setStatus(ticket.id, a[who], to);

    expect(res.status).toBe(404);
    expect(await db.select().from(ticketEvents)).toHaveLength(0);
  });

  it.each([
    ["open", "resolved"],
    ["assigned", "closed"],
    ["closed", "in_progress"],
    ["in_progress", "in_progress"],
  ] as const)("rejects the invalid change %s → %s with 409", async (from, to) => {
    const a = await createOrg("a");
    const ticket = await createTicket(a, { status: from, assignedTo: a.technician.id });

    const res = await setStatus(ticket.id, a.technician, to);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
    expect(await db.select().from(ticketEvents)).toHaveLength(0);
  });

  it("rejects an unknown status with 400", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a, { status: "assigned", assignedTo: a.technician.id });

    const res = await setStatus(ticket.id, a.technician, "done");

    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe("status");
  });

  it("returns 404 for another organization's ticket", async () => {
    const a = await createOrg("a");
    const b = await createOrg("b");
    const bTicket = await createTicket(b, { status: "assigned", assignedTo: b.technician.id });

    const res = await setStatus(bTicket.id, a.technician, "in_progress");

    expect(res.status).toBe(404);
  });

  it("lets only one of two simultaneous identical changes win", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a, { status: "in_progress", assignedTo: a.technician.id });

    // Force a real race: lock the ticket row so both requests read it, pass the
    // rules, and then both wait at their UPDATE. Releasing the lock lets one
    // update win; the other must notice the ticket changed underneath it.
    const lock = await pool.connect();
    let results;
    try {
      await lock.query("BEGIN");
      await lock.query("SELECT 1 FROM tickets WHERE id = $1 FOR UPDATE", [ticket.id]);
      const pending = Promise.all([
        setStatus(ticket.id, a.technician, "resolved"),
        setStatus(ticket.id, a.technician, "resolved"),
      ]);
      await waitForQueriesBlockedOnLocks(2);
      await lock.query("COMMIT");
      results = await pending;
    } finally {
      lock.release();
    }

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe("CONFLICT");
    expect(await db.select().from(ticketEvents)).toHaveLength(1);
  });
});

describe("GET /api/tickets/:id/history", () => {
  it("records a 'created' event when a ticket is created through the API", async () => {
    const a = await createOrg("a");
    const created = await request(app)
      .post("/api/tickets")
      .auth(a.resident.token, { type: "bearer" })
      .send({ propertyId: a.property.id, title: "Flickering light" });

    const res = await history(created.body.data.id, a.manager);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ type: "created", actorId: a.resident.id, toStatus: "open" });
  });

  it("returns 404 for another organization's ticket", async () => {
    const a = await createOrg("a");
    const b = await createOrg("b");
    const bTicket = await createTicket(b);

    expect((await history(bTicket.id, a.resident)).status).toBe(404);
  });

  it("returns 404 for a ticket that doesn't exist", async () => {
    const a = await createOrg("a");

    expect((await history(NONEXISTENT_ID, a.resident)).status).toBe(404);
  });
});
