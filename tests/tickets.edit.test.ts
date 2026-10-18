import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/index.js";
import { closeDatabases, createOrg, createTicket, resetDatabase } from "./helpers.js";

const app = createApp();

beforeEach(resetDatabase);
afterAll(closeDatabases);

type AsUser = { token: string };
const edit = (ticketId: string, asUser: AsUser, body: object) =>
  request(app).patch(`/api/tickets/${ticketId}`).auth(asUser.token, { type: "bearer" }).send(body);

describe("PATCH /api/tickets/:id", () => {
  it("lets the reporter fix their ticket before work starts, and records it", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a, { title: "Leeking tap", status: "assigned", assignedTo: a.technician.id });

    const res = await edit(ticket.id, a.resident, { title: "Leaking tap", description: "Kitchen sink", priority: "high" });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ title: "Leaking tap", description: "Kitchen sink", priority: "high" });
    const history = await request(app).get(`/api/tickets/${ticket.id}/history`).auth(a.resident.token, { type: "bearer" });
    expect(history.body.data.map((e: { type: string }) => e.type)).toContain("edited");
  });

  it("changes only the fields sent", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a, { title: "Original", description: "Keep me", priority: "low" });

    const res = await edit(ticket.id, a.resident, { priority: "urgent" });

    expect(res.body.data).toMatchObject({ title: "Original", description: "Keep me", priority: "urgent" });
  });

  it("clears the description with null or an empty string", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a, { description: "Remove me" });

    expect((await edit(ticket.id, a.resident, { description: "" })).body.data.description).toBeNull();
  });

  it("refuses the reporter once work has started", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a, { status: "in_progress", assignedTo: a.technician.id });

    const res = await edit(ticket.id, a.resident, { title: "Changed my mind" });

    expect(res.status).toBe(403);
  });

  it("lets a manager edit during work, but not after closing", async () => {
    const a = await createOrg("a");
    const working = await createTicket(a, { status: "in_progress", assignedTo: a.technician.id });
    const closed = await createTicket(a, { status: "closed", assignedTo: a.technician.id });

    expect((await edit(working.id, a.manager, { priority: "urgent" })).status).toBe(200);
    const res = await edit(closed.id, a.manager, { priority: "urgent" });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe("Closed tickets can't be edited");
  });

  it("doesn't let the assigned technician edit", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a, { status: "assigned", assignedTo: a.technician.id });

    expect((await edit(ticket.id, a.technician, { title: "x" })).status).toBe(403);
  });

  it("returns 404 to people who can't see the ticket", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a);

    expect((await edit(ticket.id, a.resident2, { title: "x" })).status).toBe(404);
  });

  it.each([
    ["an empty body", {}],
    ["a blank title", { title: "  " }],
    ["an unknown field", { status: "closed" }],
    ["a bad priority", { priority: "critical" }],
  ])("rejects %s", async (_name, body) => {
    const a = await createOrg("a");
    const ticket = await createTicket(a);

    expect((await edit(ticket.id, a.resident, body)).status).toBe(400);
  });

  it("refuses the reporter's edit if work starts at the same moment", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a, { status: "assigned", assignedTo: a.technician.id });

    // Hold the row so the edit reads "assigned", passes the rule, then waits
    // at its UPDATE while the technician starts work.
    const lock = await pool.connect();
    try {
      await lock.query("BEGIN");
      await lock.query("UPDATE tickets SET status = 'in_progress' WHERE id = $1", [ticket.id]);
      // .then() actually sends the request: supertest waits until someone awaits it.
      const pending = edit(ticket.id, a.resident, { title: "Too late" }).then((r) => r);
      for (let i = 0; i < 250; i++) {
        const { rows } = await pool.query(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
        );
        if (rows[0].n >= 1) break;
        if (i === 249) throw new Error("The edit never reached its UPDATE");
        await new Promise((r) => setTimeout(r, 20));
      }
      await lock.query("COMMIT");
      const res = await pending;

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("CONFLICT");
    } finally {
      lock.release();
    }
  });
});
