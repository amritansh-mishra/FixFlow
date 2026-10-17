// Integration tests: who can see which tickets, through every ticket endpoint.

import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { closeDatabases, createOrg, createTicket, resetDatabase, type Org } from "./helpers.js";

const app = createApp();

beforeEach(resetDatabase);
afterAll(closeDatabases);

type AsUser = { token: string };
const get = (path: string, asUser: AsUser) => request(app).get(path).auth(asUser.token, { type: "bearer" });
const titles = (res: request.Response) => res.body.data.map((t: { title: string }) => t.title).sort();

// Three tickets with different creators and assignees:
//   mine        created by resident,  assigned to technician
//   unassigned  created by resident,  not assigned
//   theirs      created by resident2, assigned to technician2
async function seed(org: Org) {
  return {
    mine: await createTicket(org, { title: "mine", status: "assigned", assignedTo: org.technician.id }),
    unassigned: await createTicket(org, { title: "unassigned" }),
    theirs: await createTicket(org, {
      title: "theirs",
      createdBy: org.resident2.id,
      status: "assigned",
      assignedTo: org.technician2.id,
    }),
  };
}

describe("GET /api/tickets only lists tickets the user may see", () => {
  it("residents see the tickets they created", async () => {
    const a = await createOrg("a");
    await seed(a);

    expect(titles(await get("/api/tickets", a.resident))).toEqual(["mine", "unassigned"]);
    expect(titles(await get("/api/tickets", a.resident2))).toEqual(["theirs"]);
  });

  it("technicians see the tickets assigned to them", async () => {
    const a = await createOrg("a");
    await seed(a);

    expect(titles(await get("/api/tickets", a.technician))).toEqual(["mine"]);
    expect(titles(await get("/api/tickets", a.technician2))).toEqual(["theirs"]);
  });

  it.each(["manager", "admin"] as const)("a %s sees every ticket in the organization", async (role) => {
    const a = await createOrg("a");
    const b = await createOrg("b");
    await seed(a);
    await createTicket(b, { title: "other org" });

    expect(titles(await get("/api/tickets", a[role]))).toEqual(["mine", "theirs", "unassigned"]);
  });

  it("the status filter still applies within the user's scope", async () => {
    const a = await createOrg("a");
    await seed(a);

    expect(titles(await get("/api/tickets?status=open", a.resident))).toEqual(["unassigned"]);
  });
});

describe("single-ticket endpoints hide tickets the user may not see (404)", () => {
  it.each([
    ["another resident", "resident2"],
    ["a technician it isn't assigned to", "technician2"],
  ] as const)("GET /:id and /:id/history return 404 for %s", async (_name, who) => {
    const a = await createOrg("a");
    const { mine } = await seed(a);

    const one = await get(`/api/tickets/${mine.id}`, a[who]);
    const history = await get(`/api/tickets/${mine.id}/history`, a[who]);

    expect(one.status).toBe(404);
    expect(history.status).toBe(404);
    expect(one.body.error.code).toBe("TICKET_NOT_FOUND");
  });

  it("the creator, the assignee and a manager can all open it", async () => {
    const a = await createOrg("a");
    const { mine } = await seed(a);

    for (const user of [a.resident, a.technician, a.manager]) {
      expect((await get(`/api/tickets/${mine.id}`, user)).status).toBe(200);
    }
  });

  it("a technician loses access when the ticket is reassigned", async () => {
    const a = await createOrg("a");
    const { mine } = await seed(a);

    await request(app)
      .patch(`/api/tickets/${mine.id}/assign`)
      .auth(a.manager.token, { type: "bearer" })
      .send({ technicianId: a.technician2.id });

    expect((await get(`/api/tickets/${mine.id}`, a.technician)).status).toBe(404);
    expect((await get(`/api/tickets/${mine.id}`, a.technician2)).status).toBe(200);
  });

  it("a resident can see a ticket right after creating it", async () => {
    const a = await createOrg("a");

    const created = await request(app)
      .post("/api/tickets")
      .auth(a.resident2.token, { type: "bearer" })
      .send({ propertyId: a.property.id, title: "new" });

    expect((await get(created.headers.location!, a.resident2)).status).toBe(200);
    expect((await get(created.headers.location!, a.resident)).status).toBe(404);
  });
});
