import { sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { properties, ticketEvents } from "../src/db/schema.js";
import { adminDb, closeDatabases, createOrg, createTicket, resetDatabase } from "./helpers.js";

const app = createApp();

beforeEach(resetDatabase);
afterAll(closeDatabases);

type AsUser = { token: string };
const get = (path: string, asUser: AsUser) => request(app).get(path).auth(asUser.token, { type: "bearer" });
const titles = (res: request.Response) => res.body.data.map((t: { title: string }) => t.title);
const at = (iso: string) => new Date(iso);

describe("GET /api/tickets: filters and search", () => {
  it("filters by priority and by property", async () => {
    const a = await createOrg("a");
    const [library] = await adminDb
      .insert(properties)
      .values({ organizationId: a.org.id, name: "Library" })
      .returning();
    await createTicket(a, { title: "urgent hostel", priority: "urgent" });
    await createTicket(a, { title: "low library", priority: "low", propertyId: library!.id });

    expect(titles(await get("/api/tickets?priority=urgent", a.manager))).toEqual(["urgent hostel"]);
    expect(titles(await get(`/api/tickets?propertyId=${library!.id}`, a.manager))).toEqual(["low library"]);
  });

  it("searches title and description, ignoring case", async () => {
    const a = await createOrg("a");
    await createTicket(a, { title: "Leaking TAP in kitchen" });
    await createTicket(a, { title: "Bathroom issue", description: "the tap drips" });
    await createTicket(a, { title: "Broken window" });

    expect(titles(await get("/api/tickets?q=tap", a.manager)).sort()).toEqual([
      "Bathroom issue",
      "Leaking TAP in kitchen",
    ]);
  });

  it("treats % and _ in the search text literally", async () => {
    const a = await createOrg("a");
    await createTicket(a, { title: "100% broken" });
    await createTicket(a, { title: "100 percent broken" });

    expect(titles(await get("/api/tickets?q=100%25", a.manager))).toEqual(["100% broken"]);
    expect(titles(await get("/api/tickets?q=_", a.manager))).toEqual([]);
  });

  it("combines filters with the user's visibility", async () => {
    const a = await createOrg("a");
    await createTicket(a, { title: "mine urgent", priority: "urgent" });
    await createTicket(a, { title: "theirs urgent", priority: "urgent", createdBy: a.resident2.id });

    expect(titles(await get("/api/tickets?priority=urgent", a.resident))).toEqual(["mine urgent"]);
  });
});

describe("GET /api/tickets: cursor pagination", () => {
  async function fiveTickets(createdAt: (i: number) => Date) {
    const a = await createOrg("a");
    for (let i = 1; i <= 5; i++) await createTicket(a, { title: `t${i}`, createdAt: createdAt(i) });
    return a;
  }

  async function allPages(asUser: AsUser, limit: number) {
    const pages: string[][] = [];
    let cursor: string | null = null;
    do {
      const res = await get(`/api/tickets?limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`, asUser);
      expect(res.status).toBe(200);
      pages.push(titles(res));
      cursor = res.body.nextCursor;
    } while (cursor && pages.length < 10);
    return pages;
  }

  it("walks through all tickets, newest first, without gaps or repeats", async () => {
    const a = await fiveTickets((i) => at(`2026-01-0${i}T00:00:00Z`));

    expect(await allPages(a.manager, 2)).toEqual([["t5", "t4"], ["t3", "t2"], ["t1"]]);
  });

  it("handles tickets with identical timestamps", async () => {
    const a = await fiveTickets(() => at("2026-01-01T00:00:00Z"));

    const pages = await allPages(a.manager, 2);

    expect(pages.flat().sort()).toEqual(["t1", "t2", "t3", "t4", "t5"]);
    expect(pages.map((p) => p.length)).toEqual([2, 2, 1]);
  });

  it("handles timestamps with sub-millisecond precision", async () => {
    // JavaScript Dates only have milliseconds; PostgreSQL keeps microseconds.
    const a = await createOrg("a");
    for (const [title, us] of [["first", "000100"], ["second", "000200"], ["third", "000300"]] as const) {
      const ticket = await createTicket(a, { title });
      const precise = `2026-01-01 00:00:00.${us}+00`;
      await adminDb.execute(sql`UPDATE tickets SET created_at = ${precise}::timestamptz WHERE id = ${ticket.id}`);
    }

    expect((await allPages(a.manager, 1)).flat()).toEqual(["third", "second", "first"]);
  });

  it("says when there are no more pages", async () => {
    const a = await fiveTickets((i) => at(`2026-01-0${i}T00:00:00Z`));

    expect((await get("/api/tickets?limit=5", a.manager)).body.nextCursor).toBeNull();
    expect((await get("/api/tickets?limit=4", a.manager)).body.nextCursor).not.toBeNull();
  });

  it("rejects a cursor the user can't see", async () => {
    const a = await createOrg("a");
    const hidden = await createTicket(a, { createdBy: a.resident2.id });

    const res = await get(`/api/tickets?cursor=${hidden.id}`, a.resident);

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ path: "cursor", message: "Unknown cursor" }]);
  });
});

describe("GET /api/stats", () => {
  it.each(["resident", "technician"] as const)("is forbidden for a %s", async (role) => {
    const a = await createOrg("a");

    expect((await get("/api/stats", a[role])).status).toBe(403);
  });

  it("summarizes the organization's tickets for a manager", async () => {
    const a = await createOrg("a");
    const b = await createOrg("b");
    await createTicket(b, { priority: "urgent" }); // other organization: not counted

    await createTicket(a, { priority: "urgent" }); // open
    await createTicket(a, { status: "assigned", assignedTo: a.technician.id });
    await createTicket(a, { status: "in_progress", assignedTo: a.technician.id, priority: "high" });
    // Two resolved tickets: 2 hours and 4 hours from creation to resolution → average 3.
    for (const hours of [2, 4]) {
      const ticket = await createTicket(a, {
        status: "closed",
        assignedTo: a.technician2.id,
        createdAt: at("2026-01-01T00:00:00Z"),
      });
      await adminDb.insert(ticketEvents).values({
        organizationId: a.org.id,
        ticketId: ticket.id,
        actorId: a.technician2.id,
        type: "status_changed",
        fromStatus: "in_progress",
        toStatus: "resolved",
        createdAt: new Date(Date.parse("2026-01-01T00:00:00Z") + hours * 3600_000),
      });
    }

    const res = await get("/api/stats", a.manager);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      total: 5,
      byStatus: { open: 1, assigned: 1, in_progress: 1, resolved: 0, closed: 2 },
      byPriority: { low: 0, medium: 3, high: 1, urgent: 1 },
      averageResolutionHours: 3,
      resolvedTickets: 2,
      technicians: [
        { id: a.technician.id, name: "technician", active: 2, completed: 0 },
        { id: a.technician2.id, name: "technician2", active: 0, completed: 2 },
      ],
    });
  });

  it("works for an organization with no tickets", async () => {
    const a = await createOrg("a");

    const res = await get("/api/stats", a.admin);

    expect(res.body.data).toMatchObject({ total: 0, averageResolutionHours: null, resolvedTickets: 0 });
  });
});
