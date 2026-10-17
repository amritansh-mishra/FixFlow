import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { db } from "../src/db/index.js";
import { sessions, users } from "../src/db/schema.js";
import { hashPassword, verifyPassword } from "../src/lib/passwords.js";
import { resetLoginLimits } from "../src/modules/auth/auth.rate-limits.js";
import { setUserPassword } from "../src/modules/auth/auth.service.js";
import { adminDb, closeDatabases, createOrg, resetDatabase, type Org } from "./helpers.js";

const app = createApp();
const PASSWORD = "correct horse battery staple";

beforeEach(async () => {
  await resetDatabase();
  resetLoginLimits();
});
afterAll(closeDatabases);

// Gives the org's resident a password so they can log in.
async function withPassword(org: Org) {
  await db.update(users).set({ passwordHash: await hashPassword(PASSWORD) }).where(eq(users.id, org.resident.id));
  return org;
}

const login = (body: object) => request(app).post("/api/auth/login").send(body);

describe("password hashing", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const hash = await hashPassword(PASSWORD);

    expect(await verifyPassword(PASSWORD, hash)).toBe(true);
    expect(await verifyPassword("wrong password!!", hash)).toBe(false);
  });

  it("never stores the password itself, and salts every hash", async () => {
    const first = await hashPassword(PASSWORD);
    const second = await hashPassword(PASSWORD);

    expect(first).not.toContain(PASSWORD);
    expect(first).toMatch(/^scrypt\$32768\$8\$3\$/);
    expect(first).not.toBe(second); // different random salt each time
  });
});

describe("POST /api/auth/login", () => {
  it("logs in with organization, email and password", async () => {
    const a = await withPassword(await createOrg("a"));

    const res = await login({ organization: "a", email: a.resident.email, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.body.data.user).toEqual({
      id: a.resident.id,
      organizationId: a.org.id,
      name: a.resident.name,
      email: a.resident.email,
      role: "resident",
    });
    expect(new Date(res.body.data.expiresAt).getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 3600 * 1000);
  });

  it("returns a token that works on protected routes", async () => {
    const a = await withPassword(await createOrg("a"));
    const { body } = await login({ organization: "a", email: a.resident.email, password: PASSWORD });

    const res = await request(app).get("/api/tickets").auth(body.data.token, { type: "bearer" });

    expect(res.status).toBe(200);
  });

  it("treats the email as case-insensitive", async () => {
    const a = await withPassword(await createOrg("a"));

    const res = await login({ organization: "a", email: a.resident.email.toUpperCase(), password: PASSWORD });

    expect(res.status).toBe(200);
  });

  it("stores only a hash of the token, never the token itself", async () => {
    const a = await withPassword(await createOrg("a"));
    const { body } = await login({ organization: "a", email: a.resident.email, password: PASSWORD });

    const { rows } = await db.execute(sql`SELECT * FROM sessions`);
    expect(JSON.stringify(rows)).not.toContain(body.data.token);
    const expected = createHash("sha256").update(body.data.token).digest("hex");
    expect(rows.some((r) => r.token_hash === expected)).toBe(true);
  });

  it("never returns the password hash", async () => {
    const a = await withPassword(await createOrg("a"));

    const res = await login({ organization: "a", email: a.resident.email, password: PASSWORD });

    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|scrypt/);
  });

  it.each([
    ["wrong password", (a: Org) => ({ organization: "a", email: a.resident.email, password: "not the password" })],
    ["unknown email", () => ({ organization: "a", email: "nobody@a.test", password: PASSWORD })],
    ["unknown organization", (a: Org) => ({ organization: "zzz", email: a.resident.email, password: PASSWORD })],
    ["user from another organization", () => ({ organization: "a", email: "resident@b.test", password: PASSWORD })],
    ["user with no password yet", (a: Org) => ({ organization: "a", email: a.manager.email, password: PASSWORD })],
  ])("gives the same 401 for: %s", async (_name, body) => {
    const a = await withPassword(await createOrg("a"));
    await withPassword(await createOrg("b"));

    const res = await login(body(a));

    expect(res.status).toBe(401);
    expect(res.body.error).toEqual({
      code: "INVALID_CREDENTIALS",
      message: "Incorrect organization, email or password",
    });
    expect(await db.select().from(sessions).where(eq(sessions.userId, a.resident.id))).toHaveLength(1); // only the helper's
  });

  it("validates the body", async () => {
    const res = await login({ organization: "a", email: "not-an-email", password: "" });

    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(["email", "password"]);
  });
});

describe("protected routes", () => {
  it("reject requests without a token", async () => {
    const res = await request(app).get("/api/tickets");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it.each(["Bearer", "Bearer short", "Basic dXNlcjpwYXNz", "Bearer has spaces in it, nope"])(
    "reject a malformed header: %s",
    async (header) => {
      const res = await request(app).get("/api/tickets").set("Authorization", header);

      expect(res.status).toBe(401);
    },
  );

  it("reject a token that doesn't exist", async () => {
    const res = await request(app).get("/api/tickets").auth("x".repeat(43), { type: "bearer" });

    expect(res.status).toBe(401);
  });

  it("reject an expired session", async () => {
    const a = await createOrg("a");
    await adminDb.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.userId, a.resident.id));

    const res = await request(app).get("/api/tickets").auth(a.resident.token, { type: "bearer" });

    expect(res.status).toBe(401);
    expect(res.body.error.message).toContain("expired");
  });
});

describe("GET /api/auth/me", () => {
  it("returns the logged-in user without the password hash", async () => {
    const a = await withPassword(await createOrg("a"));

    const res = await request(app).get("/api/auth/me").auth(a.resident.token, { type: "bearer" });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      id: a.resident.id,
      organizationId: a.org.id,
      name: a.resident.name,
      email: a.resident.email,
      role: "resident",
    });
  });
});

describe("POST /api/auth/logout", () => {
  it("ends the session so the token stops working", async () => {
    const a = await createOrg("a");
    const auth = { type: "bearer" } as const;

    const res = await request(app).post("/api/auth/logout").auth(a.resident.token, auth);
    const after = await request(app).get("/api/tickets").auth(a.resident.token, auth);

    expect(res.status).toBe(204);
    expect(after.status).toBe(401);
  });

  it("only ends that one session (other devices stay logged in)", async () => {
    const a = await withPassword(await createOrg("a"));
    const { body } = await login({ organization: "a", email: a.resident.email, password: PASSWORD });

    await request(app).post("/api/auth/logout").auth(body.data.token, { type: "bearer" });
    const other = await request(app).get("/api/tickets").auth(a.resident.token, { type: "bearer" });

    expect(other.status).toBe(200);
  });
});

describe("setUserPassword (used by the CLI script)", () => {
  it("sets a password the user can log in with", async () => {
    const a = await createOrg("a");

    expect(await setUserPassword("a", a.manager.email, PASSWORD)).toBe(true);
    const res = await login({ organization: "a", email: a.manager.email, password: PASSWORD });

    expect(res.status).toBe(200);
  });

  it("logs the user out everywhere", async () => {
    const a = await createOrg("a");

    await setUserPassword("a", a.resident.email, PASSWORD);
    const res = await request(app).get("/api/tickets").auth(a.resident.token, { type: "bearer" });

    expect(res.status).toBe(401);
  });

  it("returns false for an unknown user", async () => {
    await createOrg("a");

    expect(await setUserPassword("a", "nobody@a.test", PASSWORD)).toBe(false);
  });
});

describe("login rate limiting", () => {
  const wrong = (a: Org) => ({ organization: "a", email: a.resident.email, password: "not the password" });
  const right = (a: Org) => ({ organization: "a", email: a.resident.email, password: PASSWORD });

  it("blocks an account after 5 failed attempts, even with the right password", async () => {
    const a = await withPassword(await createOrg("a"));
    for (let i = 0; i < 5; i++) expect((await login(wrong(a))).status).toBe(401);

    const blocked = await login(right(a));

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("TOO_MANY_ATTEMPTS");
    expect(blocked.body.error.message).toBe("Too many login attempts. Try again in 15 minutes.");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(14 * 60);
    expect(await db.select().from(sessions).where(eq(sessions.userId, a.resident.id))).toHaveLength(1); // no new session
  });

  it("doesn't block other accounts", async () => {
    const a = await withPassword(await createOrg("a"));
    await db.update(users).set({ passwordHash: await hashPassword(PASSWORD) }).where(eq(users.id, a.manager.id));
    for (let i = 0; i < 5; i++) await login(wrong(a));

    const res = await login({ organization: "a", email: a.manager.email, password: PASSWORD });

    expect(res.status).toBe(200);
  });

  it("a successful login clears the failed attempts", async () => {
    const a = await withPassword(await createOrg("a"));
    for (let i = 0; i < 4; i++) await login(wrong(a));
    expect((await login(right(a))).status).toBe(200);

    for (let i = 0; i < 4; i++) expect((await login(wrong(a))).status).toBe(401);
  });

  it("limits accounts that don't exist the same way (no enumeration)", async () => {
    await createOrg("a");
    const ghost = { organization: "a", email: "ghost@a.test", password: "whatever" };
    for (let i = 0; i < 5; i++) expect((await login(ghost)).status).toBe(401);

    expect((await login(ghost)).status).toBe(429);
  });

  it("treats the email case-insensitively when counting", async () => {
    const a = await withPassword(await createOrg("a"));
    for (let i = 0; i < 5; i++) {
      await login({ ...wrong(a), email: i % 2 ? a.resident.email.toUpperCase() : a.resident.email });
    }

    expect((await login(right(a))).status).toBe(429);
  });

  it("blocks an IP address after 20 attempts across different accounts", async () => {
    await createOrg("a");
    for (let i = 0; i < 20; i++) {
      expect((await login({ organization: "a", email: `user${i}@a.test`, password: "guess123" })).status).toBe(401);
    }

    const res = await login({ organization: "a", email: "user99@a.test", password: "guess123" });

    expect(res.status).toBe(429);
  });
});
