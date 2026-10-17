import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { organizations, properties, users } from "../src/db/schema.js";
import { resetLoginLimits } from "../src/modules/auth/auth.rate-limits.js";
import { adminDb, closeDatabases, createOrg, resetDatabase } from "./helpers.js";

const app = createApp();
const PASSWORD = "a long enough passphrase";

beforeEach(async () => {
  await resetDatabase();
  resetLoginLimits();
});
afterAll(closeDatabases);

const signup = (overrides: object = {}) =>
  request(app)
    .post("/api/auth/signup")
    .send({
      organizationName: "Sunrise Hostel",
      organizationSlug: "sunrise-hostel",
      name: "Asha",
      email: "Asha@Example.com",
      password: PASSWORD,
      ...overrides,
    });

type AsUser = { token: string };

describe("POST /api/auth/signup", () => {
  it("creates the organization, makes the caller its admin, and logs them in", async () => {
    const res = await signup();

    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({ name: "Asha", email: "asha@example.com", role: "admin" });
    const [org] = await adminDb.select().from(organizations).where(eq(organizations.slug, "sunrise-hostel"));
    expect(org).toMatchObject({ name: "Sunrise Hostel", joinCode: expect.stringMatching(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/) });
    expect(await adminDb.select().from(properties).where(eq(properties.organizationId, org!.id))).toHaveLength(1);

    const me = await request(app).get("/api/auth/me").auth(res.body.data.token, { type: "bearer" });
    expect(me.body.data.role).toBe("admin");
  });

  it("lets the new admin log in later with the lowercased email", async () => {
    await signup();

    const res = await request(app)
      .post("/api/auth/login")
      .send({ organization: "sunrise-hostel", email: "ASHA@example.com", password: PASSWORD });

    expect(res.status).toBe(200);
  });

  it("rejects a slug that's already taken", async () => {
    await createOrg("taken-slug");

    const res = await signup({ organizationSlug: "taken-slug" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("SLUG_TAKEN");
  });

  it("handles two simultaneous signups for the same slug", async () => {
    const results = await Promise.all([signup(), signup({ email: "other@example.com" })]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await adminDb.select().from(organizations)).toHaveLength(1);
  });

  it.each([
    ["an invalid slug", { organizationSlug: "Not A Slug!" }, "organizationSlug"],
    ["a short password", { password: "short" }, "password"],
    ["a missing name", { name: "" }, "name"],
  ])("rejects %s", async (_label, overrides, field) => {
    const res = await signup(overrides);

    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain(field);
  });

  it("is rate-limited per IP", async () => {
    for (let i = 0; i < 10; i++) {
      expect((await signup({ organizationSlug: `org-${i}`, email: `a${i}@example.com` })).status).toBe(201);
    }

    const res = await signup({ organizationSlug: "one-too-many" });

    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBeDefined();
  });
});

describe("POST /api/auth/join", () => {
  async function orgWithCode() {
    const a = await createOrg("a");
    await adminDb.update(organizations).set({ joinCode: "K7QM-3XPA" }).where(eq(organizations.id, a.org.id));
    return a;
  }
  const join = (overrides: object = {}) =>
    request(app)
      .post("/api/auth/join")
      .send({ joinCode: "K7QM-3XPA", name: "Rohan", email: "rohan@example.com", password: PASSWORD, ...overrides });

  it("adds the person as a resident of the code's organization and logs them in", async () => {
    const a = await orgWithCode();

    const res = await join({ joinCode: "k7qm-3xpa" }); // case doesn't matter

    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({ organizationId: a.org.id, role: "resident", email: "rohan@example.com" });
  });

  it("rejects an unknown code", async () => {
    await orgWithCode();

    const res = await join({ joinCode: "ZZZZ-ZZZZ" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_JOIN_CODE");
  });

  it("rejects an email that's already in the organization", async () => {
    await orgWithCode();

    const res = await join({ email: "resident@a.test" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("EMAIL_TAKEN");
  });
});

describe("GET/POST /api/organization", () => {
  it("shows the join code to managers but not to residents", async () => {
    const a = await createOrg("a");
    await adminDb.update(organizations).set({ joinCode: "K7QM-3XPA" }).where(eq(organizations.id, a.org.id));

    const manager = await request(app).get("/api/organization").auth(a.manager.token, { type: "bearer" });
    const resident = await request(app).get("/api/organization").auth(a.resident.token, { type: "bearer" });

    expect(manager.body.data).toMatchObject({ slug: "a", joinCode: "K7QM-3XPA" });
    expect(resident.body.data.joinCode).toBeUndefined();
  });

  it("regenerating the code makes the old one stop working", async () => {
    const a = await createOrg("a");
    await adminDb.update(organizations).set({ joinCode: "K7QM-3XPA" }).where(eq(organizations.id, a.org.id));

    const res = await request(app).post("/api/organization/join-code").auth(a.manager.token, { type: "bearer" });
    const oldCode = await request(app)
      .post("/api/auth/join")
      .send({ joinCode: "K7QM-3XPA", name: "Late", email: "late@example.com", password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data.joinCode).not.toBe("K7QM-3XPA");
    expect(oldCode.status).toBe(400);
  });

  it("only managers and admins can regenerate the code", async () => {
    const a = await createOrg("a");

    const res = await request(app).post("/api/organization/join-code").auth(a.technician.token, { type: "bearer" });

    expect(res.status).toBe(403);
  });
});

describe("GET/POST /api/users (team)", () => {
  const add = (asUser: AsUser, body: object) =>
    request(app).post("/api/users").auth(asUser.token, { type: "bearer" }).send({ password: PASSWORD, ...body });

  it("lists only the organization's people, for managers", async () => {
    const a = await createOrg("a");
    await createOrg("b");

    const res = await request(app).get("/api/users").auth(a.manager.token, { type: "bearer" });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(6);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|scrypt/);
  });

  it.each(["resident", "technician"] as const)("is forbidden for a %s", async (role) => {
    const a = await createOrg("a");

    expect((await request(app).get("/api/users").auth(a[role].token, { type: "bearer" })).status).toBe(403);
    expect((await add(a[role], { name: "X", email: "x@a.test", role: "resident" })).status).toBe(403);
  });

  it("a manager can add residents and technicians, who can then log in", async () => {
    const a = await createOrg("a");

    const res = await add(a.manager, { name: "New Tech", email: "NewTech@a.test", role: "technician" });
    const login = await request(app)
      .post("/api/auth/login")
      .send({ organization: "a", email: "newtech@a.test", password: PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ email: "newtech@a.test", role: "technician" });
    expect(login.status).toBe(200);
  });

  it.each(["manager", "admin"] as const)("a manager can't add a %s", async (role) => {
    const a = await createOrg("a");

    const res = await add(a.manager, { name: "Boss", email: "boss@a.test", role });

    expect(res.status).toBe(403);
    expect(await adminDb.select().from(users).where(eq(users.email, "boss@a.test"))).toHaveLength(0);
  });

  it("an admin can add a manager", async () => {
    const a = await createOrg("a");

    expect((await add(a.admin, { name: "Mgr", email: "mgr@a.test", role: "manager" })).status).toBe(201);
  });

  it("rejects an email already used in the organization", async () => {
    const a = await createOrg("a");

    const res = await add(a.admin, { name: "Dup", email: "RESIDENT@a.test", role: "resident" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("EMAIL_TAKEN");
  });
});

describe("POST /api/properties", () => {
  it("lets a manager add a property", async () => {
    const a = await createOrg("a");

    const res = await request(app)
      .post("/api/properties")
      .auth(a.manager.token, { type: "bearer" })
      .send({ name: "Block B", address: "North campus" });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: "Block B", address: "North campus" });
  });

  it("is forbidden for residents", async () => {
    const a = await createOrg("a");

    const res = await request(app).post("/api/properties").auth(a.resident.token, { type: "bearer" }).send({ name: "X" });

    expect(res.status).toBe(403);
  });
});
