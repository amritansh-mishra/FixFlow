import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/index.js";
import { createOrg, createTicket, resetDatabase } from "./helpers.js";

const app = createApp();

beforeEach(resetDatabase);
afterAll(() => pool.end());

describe("GET /api/tickets", () => {
  it("returns 401 without an organization", async () => {
    const res = await request(app).get("/api/tickets");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns 400 when the organization id is not a UUID", async () => {
    const res = await request(app).get("/api/tickets").set("X-Organization-Id", "not-a-uuid");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns an empty list when the organization has no tickets", async () => {
    const a = await createOrg("a");

    const res = await request(app).get("/api/tickets").set("X-Organization-Id", a.org.id);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [] });
  });

  it("only returns tickets from the caller's organization", async () => {
    const a = await createOrg("a");
    const b = await createOrg("b");
    await createTicket(a, { title: "A's ticket" });
    await createTicket(b, { title: "B's ticket" });

    const res = await request(app).get("/api/tickets").set("X-Organization-Id", a.org.id);

    expect(res.status).toBe(200);
    expect(res.body.data.map((t: { title: string }) => t.title)).toEqual(["A's ticket"]);
  });

  it("returns newest tickets first", async () => {
    const a = await createOrg("a");
    await createTicket(a, { title: "old", createdAt: new Date("2026-01-01T00:00:00Z") });
    await createTicket(a, { title: "new", createdAt: new Date("2026-03-01T00:00:00Z") });
    await createTicket(a, { title: "middle", createdAt: new Date("2026-02-01T00:00:00Z") });

    const res = await request(app).get("/api/tickets").set("X-Organization-Id", a.org.id);

    expect(res.body.data.map((t: { title: string }) => t.title)).toEqual(["new", "middle", "old"]);
  });

  it("filters by status", async () => {
    const a = await createOrg("a");
    await createTicket(a, { title: "open one" });
    await createTicket(a, { title: "resolved one", status: "resolved" });

    const res = await request(app)
      .get("/api/tickets?status=resolved")
      .set("X-Organization-Id", a.org.id);

    expect(res.status).toBe(200);
    expect(res.body.data.map((t: { title: string }) => t.title)).toEqual(["resolved one"]);
  });

  it("respects the limit", async () => {
    const a = await createOrg("a");
    for (let i = 0; i < 3; i++) await createTicket(a, { title: `t${i}` });

    const res = await request(app).get("/api/tickets?limit=2").set("X-Organization-Id", a.org.id);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it.each(["0", "51", "abc", "1.5"])("rejects limit=%s", async (limit) => {
    const a = await createOrg("a");

    const res = await request(app)
      .get(`/api/tickets?limit=${limit}`)
      .set("X-Organization-Id", a.org.id);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an unknown status", async () => {
    const a = await createOrg("a");

    const res = await request(app).get("/api/tickets?status=done").set("X-Organization-Id", a.org.id);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain("status must be one of");
  });

  it("returns ticket fields in camelCase with ISO timestamps", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a, { title: "Broken light", priority: "high" });

    const res = await request(app).get("/api/tickets").set("X-Organization-Id", a.org.id);

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
