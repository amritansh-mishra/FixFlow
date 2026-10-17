import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { db } from "../src/db/index.js";
import { tickets } from "../src/db/schema.js";
import { closeDatabases, createOrg, createTicket, resetDatabase } from "./helpers.js";

const app = createApp();
const NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000";

beforeEach(resetDatabase);
afterAll(closeDatabases);

type Titled = { title: string };

describe("GET /api/tickets", () => {
  it("returns an empty list when the organization has no tickets", async () => {
    const a = await createOrg("a");

    const res = await request(app).get("/api/tickets").auth(a.resident.token, { type: "bearer" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [], nextCursor: null });
  });

  it("only returns tickets from the caller's organization", async () => {
    const a = await createOrg("a");
    const b = await createOrg("b");
    await createTicket(a, { title: "A's ticket" });
    await createTicket(b, { title: "B's ticket" });

    const res = await request(app).get("/api/tickets").auth(a.resident.token, { type: "bearer" });

    expect(res.status).toBe(200);
    expect(res.body.data.map((t: Titled) => t.title)).toEqual(["A's ticket"]);
  });

  it("returns newest tickets first", async () => {
    const a = await createOrg("a");
    await createTicket(a, { title: "old", createdAt: new Date("2026-01-01T00:00:00Z") });
    await createTicket(a, { title: "new", createdAt: new Date("2026-03-01T00:00:00Z") });
    await createTicket(a, { title: "middle", createdAt: new Date("2026-02-01T00:00:00Z") });

    const res = await request(app).get("/api/tickets").auth(a.resident.token, { type: "bearer" });

    expect(res.body.data.map((t: Titled) => t.title)).toEqual(["new", "middle", "old"]);
  });

  it("filters by status", async () => {
    const a = await createOrg("a");
    await createTicket(a, { title: "open one" });
    await createTicket(a, { title: "resolved one", status: "resolved" });

    const res = await request(app).get("/api/tickets?status=resolved").auth(a.resident.token, { type: "bearer" });

    expect(res.status).toBe(200);
    expect(res.body.data.map((t: Titled) => t.title)).toEqual(["resolved one"]);
  });

  it("respects the limit", async () => {
    const a = await createOrg("a");
    for (let i = 0; i < 3; i++) await createTicket(a, { title: `t${i}` });

    const res = await request(app).get("/api/tickets?limit=2").auth(a.resident.token, { type: "bearer" });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it.each(["0", "51", "abc", "1.5"])("rejects limit=%s", async (limit) => {
    const a = await createOrg("a");

    const res = await request(app).get(`/api/tickets?limit=${limit}`).auth(a.resident.token, { type: "bearer" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details[0].path).toBe("limit");
  });

  it("rejects an unknown status", async () => {
    const a = await createOrg("a");

    const res = await request(app).get("/api/tickets?status=done").auth(a.resident.token, { type: "bearer" });

    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe("status");
  });

  it("returns ticket fields in camelCase with ISO timestamps", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a, { title: "Broken light", priority: "high" });

    const res = await request(app).get("/api/tickets").auth(a.resident.token, { type: "bearer" });

    expect(res.body.data[0]).toMatchObject({
      id: ticket.id,
      organizationId: a.org.id,
      propertyId: a.property.id,
      createdBy: a.resident.id,
      assignedTo: null,
      title: "Broken light",
      priority: "high",
      status: "open",
    });
    expect(res.body.data[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });
});

describe("GET /api/tickets/:id", () => {
  it("returns the ticket", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a, { title: "Broken window" });

    const res = await request(app).get(`/api/tickets/${ticket.id}`).auth(a.resident.token, { type: "bearer" });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: ticket.id, title: "Broken window" });
  });

  it("returns 404 for another organization's ticket", async () => {
    const a = await createOrg("a");
    const b = await createOrg("b");
    const bTicket = await createTicket(b, { title: "B's secret ticket" });

    const res = await request(app).get(`/api/tickets/${bTicket.id}`).auth(a.resident.token, { type: "bearer" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("TICKET_NOT_FOUND");
    expect(JSON.stringify(res.body)).not.toContain("B's secret ticket");
  });

  it("returns 404 for a ticket that doesn't exist", async () => {
    const a = await createOrg("a");

    const res = await request(app).get(`/api/tickets/${NONEXISTENT_ID}`).auth(a.resident.token, { type: "bearer" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("TICKET_NOT_FOUND");
  });

  it("returns 400 for an id that isn't a UUID", async () => {
    const a = await createOrg("a");

    const res = await request(app).get("/api/tickets/123").auth(a.resident.token, { type: "bearer" });

    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe("id");
  });
});

describe("POST /api/tickets", () => {
  it("creates a ticket owned by the caller and their organization", async () => {
    const a = await createOrg("a");

    const res = await request(app)
      .post("/api/tickets")
      .auth(a.resident.token, { type: "bearer" })
      .send({ propertyId: a.property.id, title: "Leaking tap", description: "Kitchen sink" });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      organizationId: a.org.id,
      createdBy: a.resident.id,
      propertyId: a.property.id,
      title: "Leaking tap",
      description: "Kitchen sink",
      priority: "medium", // database default
      status: "open",
      assignedTo: null,
    });
    expect(res.headers.location).toBe(`/api/tickets/${res.body.data.id}`);
  });

  it("saves the ticket so it can be fetched afterwards", async () => {
    const a = await createOrg("a");

    const created = await request(app)
      .post("/api/tickets")
      .auth(a.resident.token, { type: "bearer" })
      .send({ propertyId: a.property.id, title: "No hot water", priority: "urgent" });
    const fetched = await request(app).get(created.headers.location!).auth(a.resident.token, { type: "bearer" });

    expect(fetched.status).toBe(200);
    expect(fetched.body.data).toMatchObject({ title: "No hot water", priority: "urgent" });
  });

  it("trims whitespace from the title", async () => {
    const a = await createOrg("a");

    const res = await request(app)
      .post("/api/tickets")
      .auth(a.resident.token, { type: "bearer" })
      .send({ propertyId: a.property.id, title: "   Broken door   " });

    expect(res.status).toBe(201);
    expect(res.body.data.title).toBe("Broken door");
  });

  it.each([
    ["missing title", {}, "title"],
    ["blank title", { title: "   " }, "title"],
    ["title too long", { title: "x".repeat(201) }, "title"],
    ["bad priority", { title: "ok", priority: "critical" }, "priority"],
    ["bad propertyId", { title: "ok", propertyId: "nope" }, "propertyId"],
  ])("rejects %s", async (_name, overrides, field) => {
    const a = await createOrg("a");

    const res = await request(app)
      .post("/api/tickets")
      .auth(a.resident.token, { type: "bearer" })
      .send({ propertyId: a.property.id, ...overrides });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain(field);
  });

  it("rejects fields the server controls (organizationId, status, ...)", async () => {
    const a = await createOrg("a");
    const b = await createOrg("b");

    const res = await request(app)
      .post("/api/tickets")
      .auth(a.resident.token, { type: "bearer" })
      .send({ propertyId: a.property.id, title: "Sneaky", organizationId: b.org.id, status: "closed" });

    expect(res.status).toBe(400);
    expect(await db.select().from(tickets)).toHaveLength(0);
  });

  it("rejects a property from another organization and saves nothing", async () => {
    const a = await createOrg("a");
    const b = await createOrg("b");

    const res = await request(app)
      .post("/api/tickets")
      .auth(a.resident.token, { type: "bearer" })
      .send({ propertyId: b.property.id, title: "Cross-org" });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ path: "propertyId", message: "Property not found" }]);
    expect(await db.select().from(tickets)).toHaveLength(0);
  });

  it("rejects a body that isn't a JSON object", async () => {
    const a = await createOrg("a");

    const res = await request(app)
      .post("/api/tickets")
      .auth(a.resident.token, { type: "bearer" })
      .set("Content-Type", "application/json")
      .send("[1, 2, 3]");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});
