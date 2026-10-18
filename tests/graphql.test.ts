// The GraphQL API: same login, same organization isolation and visibility as REST.

import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
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
