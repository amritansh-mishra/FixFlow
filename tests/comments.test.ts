import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { db } from "../src/db/index.js";
import { ticketComments } from "../src/db/schema.js";
import { closeDatabases, createOrg, createTicket, resetDatabase } from "./helpers.js";

const app = createApp();

beforeEach(resetDatabase);
afterAll(closeDatabases);

type AsUser = { token: string };
const comment = (ticketId: string, asUser: AsUser, body: unknown) =>
  request(app).post(`/api/tickets/${ticketId}/comments`).auth(asUser.token, { type: "bearer" }).send({ body });
const comments = (ticketId: string, asUser: AsUser) =>
  request(app).get(`/api/tickets/${ticketId}/comments`).auth(asUser.token, { type: "bearer" });

describe("ticket comments", () => {
  it("lets the people on a ticket discuss it, oldest first, with author details", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a, { status: "assigned", assignedTo: a.technician.id });

    const first = await comment(ticket.id, a.resident, "  It's leaking again tonight.  ");
    await comment(ticket.id, a.technician, "Part ordered, fixing it Thursday.");
    await comment(ticket.id, a.manager, "Thanks, keep me posted.");

    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({
      ticketId: ticket.id,
      body: "It's leaking again tonight.", // trimmed
      author: { id: a.resident.id, name: "resident", role: "resident" },
    });

    const res = await comments(ticket.id, a.resident);
    expect(res.status).toBe(200);
    expect(res.body.data.map((c: { author: { role: string } }) => c.author.role)).toEqual([
      "resident",
      "technician",
      "manager",
    ]);
  });

  it("records each comment in the ticket history", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a);

    await comment(ticket.id, a.resident, "Any update?");
    const history = await request(app)
      .get(`/api/tickets/${ticket.id}/history`)
      .auth(a.resident.token, { type: "bearer" });

    expect(history.body.data).toEqual([
      expect.objectContaining({ type: "commented", actorId: a.resident.id }),
    ]);
  });

  it.each([
    ["another resident", "resident2"],
    ["a technician it isn't assigned to", "technician2"],
  ] as const)("hides comments from %s (404) and stops them commenting", async (_name, who) => {
    const a = await createOrg("a");
    const ticket = await createTicket(a, { status: "assigned", assignedTo: a.technician.id });
    await comment(ticket.id, a.resident, "private details");

    expect((await comments(ticket.id, a[who])).status).toBe(404);
    expect((await comment(ticket.id, a[who], "sneaky")).status).toBe(404);
    expect(await db.select().from(ticketComments)).toHaveLength(1);
  });

  it("returns 404 for another organization's ticket", async () => {
    const a = await createOrg("a");
    const b = await createOrg("b");
    const bTicket = await createTicket(b);

    expect((await comment(bTicket.id, a.manager, "hello")).status).toBe(404);
  });

  it.each([
    ["an empty body", ""],
    ["only spaces", "   "],
    ["a body over 2000 characters", "x".repeat(2001)],
    ["a non-string body", 42],
  ])("rejects %s", async (_name, body) => {
    const a = await createOrg("a");
    const ticket = await createTicket(a);

    const res = await comment(ticket.id, a.resident, body);

    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe("body");
  });
});
