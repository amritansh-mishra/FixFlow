// The GraphQL API: same login, same organization isolation and visibility as REST.

import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/index.js";
import { notificationsQueue } from "../src/jobs/queue.js";
import { closeDatabases, createOrg, createTicket, resetDatabase } from "./helpers.js";

const app = createApp();

beforeEach(resetDatabase);
afterAll(closeDatabases);

type AsUser = { token: string };
async function gql(query: string, variables: object = {}, asUser?: AsUser) {
  const req = request(app).post("/graphql").send({ query, variables });
  if (asUser) req.auth(asUser.token, { type: "bearer" });
  const res = await req;
  return res.body as { data?: Record<string, any> | null; errors?: { message: string; extensions?: { code?: string } }[] };
}

describe("GraphQL", () => {
  it("answers `me` for the logged-in user", async () => {
    const a = await createOrg("a");

    const { data } = await gql("{ me { id name role } }", {}, a.manager);

    expect(data!.me).toEqual({ id: a.manager.id, name: "manager", role: "manager" });
  });

  it("requires login", async () => {
    const { errors } = await gql("{ me { id } }");

    expect(errors![0]!.extensions!.code).toBe("UNAUTHENTICATED");
  });

  it("lists only the tickets the user may see, like REST", async () => {
    const a = await createOrg("a");
    const b = await createOrg("b");
    await createTicket(a, { title: "mine" });
    await createTicket(a, { title: "theirs", createdBy: a.resident2.id });
    await createTicket(b, { title: "other org" });

    const asResident = await gql("{ tickets { nodes { title } } }", {}, a.resident);
    const asManager = await gql("{ tickets { nodes { title } } }", {}, a.manager);

    expect(asResident.data!.tickets.nodes.map((t: { title: string }) => t.title)).toEqual(["mine"]);
    expect(asManager.data!.tickets.nodes.map((t: { title: string }) => t.title).sort()).toEqual(["mine", "theirs"]);
  });

  it("filters and paginates with variables", async () => {
    const a = await createOrg("a");
    for (let i = 1; i <= 3; i++) {
      await createTicket(a, { title: `urgent ${i}`, priority: "urgent", createdAt: new Date(`2026-01-0${i}T00:00:00Z`) });
    }
    await createTicket(a, { title: "low one", priority: "low" });
    const query = `query ($after: ID) { tickets(priority: urgent, first: 2, after: $after) { nodes { title } nextCursor } }`;

    const page1 = await gql(query, {}, a.manager);
    const page2 = await gql(query, { after: page1.data!.tickets.nextCursor }, a.manager);

    expect(page1.data!.tickets.nodes.map((t: { title: string }) => t.title)).toEqual(["urgent 3", "urgent 2"]);
    expect(page2.data!.tickets).toEqual({ nodes: [{ title: "urgent 1" }], nextCursor: null });
  });

  it("returns a ticket with typed fields", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a, { title: "Leak", priority: "high" });

    const { data } = await gql(
      "query ($id: ID!) { ticket(id: $id) { id title status priority createdAt assignedToId } }",
      { id: ticket.id },
      a.resident,
    );

    expect(data!.ticket).toMatchObject({ id: ticket.id, title: "Leak", status: "open", priority: "high", assignedToId: null });
    expect(data!.ticket.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it("hides tickets the user can't see, with the same code as REST", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a);

    const { errors } = await gql("query ($id: ID!) { ticket(id: $id) { title } }", { id: ticket.id }, a.resident2);

    expect(errors![0]).toMatchObject({ message: "Ticket not found", extensions: { code: "TICKET_NOT_FOUND" } });
  });

  it("rejects invalid input with a clear code", async () => {
    const a = await createOrg("a");

    const { errors } = await gql("{ tickets(first: 500) { nodes { id } } }", {}, a.manager);

    expect(errors![0]!.extensions!.code).toBe("VALIDATION_ERROR");
  });

  it.each([
    ["ticket(id)", '{ ticket(id: "not-an-id") { title } }'],
    ["tickets(after)", '{ tickets(after: "nope") { nodes { id } } }'],
  ])("rejects a malformed ID in %s with VALIDATION_ERROR, not an internal error", async (_name, query) => {
    const a = await createOrg("a");

    const { errors } = await gql(query, {}, a.manager);

    expect(errors![0]!.extensions!.code).toBe("VALIDATION_ERROR");
  });

  it("rejects queries for fields that don't exist (the schema is checked)", async () => {
    const a = await createOrg("a");

    const { errors } = await gql("{ me { passwordHash } }", {}, a.manager);

    expect(errors![0]!.message).toContain('Cannot query field "passwordHash"');
  });
});

describe("GraphQL nested data", () => {
  const NESTED = `{
    tickets(first: 50) {
      nodes {
        title
        property { name }
        createdBy { name }
        assignedTo { name }
        comments { body author { name } }
        history { type actor { name } }
        photos { fileName }
      }
    }
  }`;

  it("returns a ticket with its people, property, comments and history in one request", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a, { title: "Leak", status: "assigned", assignedTo: a.technician.id });
    await request(app)
      .post(`/api/tickets/${ticket.id}/comments`)
      .auth(a.manager.token, { type: "bearer" })
      .send({ body: "On its way" });

    const { data } = await gql(
      `query ($id: ID!) { ticket(id: $id) {
        title property { name } createdBy { name } assignedTo { name role }
        comments { body author { name role } } history { type actor { name } } photos { id }
      } }`,
      { id: ticket.id },
      a.resident,
    );

    expect(data!.ticket).toEqual({
      title: "Leak",
      property: { name: "a Block A" },
      createdBy: { name: "resident" },
      assignedTo: { name: "technician", role: "technician" },
      comments: [{ body: "On its way", author: { name: "manager", role: "manager" } }],
      history: [{ type: "commented", actor: { name: "manager" } }],
      photos: [],
    });
  });

  it("shows email addresses only to the person themselves and to managers", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a, { status: "assigned", assignedTo: a.technician.id });
    const query = `query ($id: ID!) { me { email } ticket(id: $id) { assignedTo { email } } }`;

    const asResident = await gql(query, { id: ticket.id }, a.resident);
    const asManager = await gql(query, { id: ticket.id }, a.manager);

    expect(asResident.data).toEqual({ me: { email: "resident@a.test" }, ticket: { assignedTo: { email: null } } });
    expect(asManager.data!.ticket.assignedTo.email).toBe("technician@a.test");
  });

  // The N+1 problem: without batching, every ticket would run its own queries
  // for its reporter, property, comments… With DataLoader the number of
  // database queries stays the same however many tickets there are.
  it("uses the same number of database queries for 5 tickets as for 20 (DataLoader)", async () => {
    const a = await createOrg("a");
    const countQueries = async () => {
      let count = 0;
      const original = pool.query.bind(pool);
      // Count every query the app runs while answering one GraphQL request.
      pool.query = ((...args: Parameters<typeof pool.query>) => {
        count++;
        return original(...args);
      }) as typeof pool.query;
      try {
        const { data, errors } = await gql(NESTED, {}, a.manager);
        expect(errors).toBeUndefined();
        return { count, tickets: data!.tickets.nodes.length };
      } finally {
        pool.query = original;
      }
    };

    for (let i = 0; i < 5; i++) await createTicket(a, { title: `t${i}`, status: "assigned", assignedTo: a.technician.id });
    const five = await countQueries();
    for (let i = 5; i < 20; i++) await createTicket(a, { title: `t${i}`, status: "assigned", assignedTo: a.technician.id });
    const twenty = await countQueries();

    expect([five.tickets, twenty.tickets]).toEqual([5, 20]);
    expect(twenty.count).toBe(five.count);
    expect(five.count).toBeLessThanOrEqual(8);
  });
});

describe("GraphQL mutations", () => {
  it("runs the whole workflow: report → assign → start → resolve → close", async () => {
    const a = await createOrg("a");

    const created = await gql(
      `mutation ($input: CreateTicketInput!) { createTicket(input: $input) { id status priority createdBy { name } } }`,
      { input: { propertyId: a.property.id, title: "Leaking tap", priority: "high" } },
      a.resident,
    );
    const id = created.data!.createTicket.id;
    expect(created.data!.createTicket).toMatchObject({ status: "open", priority: "high", createdBy: { name: "resident" } });

    const assigned = await gql(
      `mutation ($id: ID!, $tech: ID!) { assignTicket(id: $id, technicianId: $tech) { status assignedTo { name } } }`,
      { id, tech: a.technician.id },
      a.manager,
    );
    expect(assigned.data!.assignTicket).toEqual({ status: "assigned", assignedTo: { name: "technician" } });

    const move = (status: string, asUser: { token: string }) =>
      gql(`mutation ($id: ID!, $s: TicketStatus!) { changeTicketStatus(id: $id, status: $s) { status } }`, { id, s: status }, asUser);
    expect((await move("in_progress", a.technician)).data!.changeTicketStatus.status).toBe("in_progress");
    expect((await move("resolved", a.technician)).data!.changeTicketStatus.status).toBe("resolved");
    expect((await move("closed", a.resident)).data!.changeTicketStatus.status).toBe("closed");

    const { data } = await gql(`query ($id: ID!) { ticket(id: $id) { history { type } } }`, { id }, a.manager);
    expect(data!.ticket.history.map((e: { type: string }) => e.type)).toEqual([
      "created",
      "assigned",
      "status_changed",
      "status_changed",
      "status_changed",
    ]);
  });

  it("applies the same permissions as REST", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a, { status: "assigned", assignedTo: a.technician.id });

    const residentAssigns = await gql(
      `mutation ($id: ID!, $tech: ID!) { assignTicket(id: $id, technicianId: $tech) { id } }`,
      { id: ticket.id, tech: a.technician2.id },
      a.resident,
    );
    const technicianReports = await gql(
      `mutation ($input: CreateTicketInput!) { createTicket(input: $input) { id } }`,
      { input: { propertyId: a.property.id, title: "x" } },
      a.technician,
    );
    const invalidMove = await gql(
      `mutation ($id: ID!) { changeTicketStatus(id: $id, status: closed) { id } }`,
      { id: ticket.id },
      a.technician,
    );

    expect(residentAssigns.errors![0]!.extensions!.code).toBe("FORBIDDEN");
    expect(technicianReports.errors![0]!.extensions!.code).toBe("FORBIDDEN");
    expect(invalidMove.errors![0]!.extensions!.code).toBe("INVALID_TRANSITION");
  });

  it("validates input with the same rules and field details as REST", async () => {
    const a = await createOrg("a");

    const { errors } = await gql(
      `mutation ($input: CreateTicketInput!) { createTicket(input: $input) { id } }`,
      { input: { propertyId: a.property.id, title: "   " } },
      a.resident,
    );

    expect(errors![0]!.extensions).toMatchObject({ code: "VALIDATION_ERROR", details: [{ path: "title" }] });
  });

  it("edits, and adding a comment returns it with its author", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a, { title: "Typo", description: "old" });

    const edited = await gql(
      `mutation ($id: ID!) { editTicket(id: $id, input: { title: "Fixed", description: null }) { title description } }`,
      { id: ticket.id },
      a.resident,
    );
    const commented = await gql(
      `mutation ($id: ID!) { addComment(ticketId: $id, body: "  Any update?  ") { body author { name } } }`,
      { id: ticket.id },
      a.resident,
    );

    expect(edited.data!.editTicket).toEqual({ title: "Fixed", description: null });
    expect(commented.data!.addComment).toEqual({ body: "Any update?", author: { name: "resident" } });
  });

  it("queues notifications exactly as REST does", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a);

    await gql(
      `mutation ($id: ID!, $tech: ID!) { assignTicket(id: $id, technicianId: $tech) { id } }`,
      { id: ticket.id, tech: a.technician.id },
      a.manager,
    );

    const jobs = await notificationsQueue().getJobs(["waiting"]);
    expect(jobs.map((j) => j.data.kind)).toEqual(["ticket_assigned"]);
  });
});

describe("GraphQL query limits", () => {
  const countDbQueries = async (run: () => Promise<unknown>) => {
    let count = 0;
    const original = pool.query.bind(pool);
    pool.query = ((...args: Parameters<typeof pool.query>) => {
      count++;
      return original(...args);
    }) as typeof pool.query;
    try {
      await run();
    } finally {
      pool.query = original;
    }
    return count;
  };

  it("rejects an alias flood before running any ticket query", async () => {
    const a = await createOrg("a");
    const flood = `{ ${Array.from({ length: 50 }, (_, i) => `a${i}: tickets(first: 50) { nodes { id } }`).join(" ")} }`;

    let result: Awaited<ReturnType<typeof gql>> | undefined;
    const queries = await countDbQueries(async () => {
      result = await gql(flood, {}, a.manager);
    });

    expect(result!.errors![0]).toMatchObject({ extensions: { code: "QUERY_TOO_COMPLEX" } });
    expect(result!.errors![0]!.message).toContain("Too many top-level fields (50)");
    expect(queries).toBeLessThanOrEqual(1); // only the session lookup, no ticket queries
  });

  it("rejects a query selecting too many fields", async () => {
    const a = await createOrg("a");
    const wide = `{ tickets { nodes { ${Array.from({ length: 210 }, (_, i) => `f${i}: id`).join(" ")} } } }`;

    const { errors } = await gql(wide, {}, a.manager);

    expect(errors![0]!.message).toContain("too many fields");
  });

  it("rejects a query nested too deeply (counting through fragments)", async () => {
    const a = await createOrg("a");
    // Introspection mixed with real fields isn't exempt, and nests deeply.
    // The depth hides inside a fragment: it must still be counted.
    const deep = `{ me { id } __schema { types { fields { type { ...Deep } } } } }
      fragment Deep on __Type { ofType { ofType { ofType { ofType { name } } } } }`;

    const { errors } = await gql(deep, {}, a.manager);

    expect(errors![0]!.message).toContain("too deeply nested");
  });

  it("still allows GraphiQL's full introspection query", async () => {
    const { getIntrospectionQuery } = await import("graphql");

    const { data, errors } = await gql(getIntrospectionQuery());

    expect(errors).toBeUndefined();
    expect(data!.__schema.queryType.name).toBe("Query");
  });

  it("allows a normal full ticket-page query", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a);

    const { errors } = await gql(
      `query ($id: ID!) { me { name } ticket(id: $id) { title property { name } createdBy { name } assignedTo { name }
        comments { body author { name } } history { type actor { name } } photos { thumbnailUrl uploadedBy { name } } } }`,
      { id: ticket.id },
      a.resident,
    );

    expect(errors).toBeUndefined();
  });
});
