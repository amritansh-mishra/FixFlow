// "Forgot password", end to end: request → worker → email in Mailpit → reset.

import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { passwordResets, users } from "../src/db/schema.js";
import { hashPassword } from "../src/lib/passwords.js";
import { notificationsQueue } from "../src/jobs/queue.js";
import { resetLoginLimits } from "../src/modules/auth/auth.rate-limits.js";
import { adminDb, closeDatabases, createOrg, resetDatabase, runQueuedJobs, type Org } from "./helpers.js";

const app = createApp();
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";
const OLD_PASSWORD = "the original passphrase";
const NEW_PASSWORD = "a fresh new passphrase";
const GENERIC = "If an account with that email exists, we've sent a link to reset the password.";

beforeEach(async () => {
  await resetDatabase();
  resetLoginLimits();
  await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });
});
afterAll(closeDatabases);

async function withPassword(org: Org) {
  await adminDb.update(users).set({ passwordHash: await hashPassword(OLD_PASSWORD) }).where(eq(users.id, org.resident.id));
  return org;
}

const forgot = (body: object) => request(app).post("/api/auth/forgot-password").send(body);
const reset = (body: object) => request(app).post("/api/auth/reset-password").send(body);
const login = (org: string, email: string, password: string) =>
  request(app).post("/api/auth/login").send({ organization: org, email, password });

// Reads the token out of the newest reset email in Mailpit.
async function tokenFromEmail(): Promise<string> {
  const { messages } = (await (await fetch(`${MAILPIT}/api/v1/messages`)).json()) as { messages: { ID: string }[] };
  const { Text } = (await (await fetch(`${MAILPIT}/api/v1/message/${messages[0]!.ID}`)).json()) as { Text: string };
  return /reset-password\?token=([A-Za-z0-9_-]+)/.exec(Text)![1]!;
}

describe("POST /api/auth/forgot-password", () => {
  it("emails a one-time link to an existing account", async () => {
    const a = await withPassword(await createOrg("a"));

    const res = await forgot({ organization: "a", email: a.resident.email.toUpperCase() });
    await runQueuedJobs();

    expect(res.status).toBe(200);
    expect(res.body.data.message).toBe(GENERIC);
    const token = await tokenFromEmail();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("gives the same answer for an account that doesn't exist, and sends nothing", async () => {
    await createOrg("a");

    const res = await forgot({ organization: "a", email: "nobody@a.test" });
    await runQueuedJobs();

    expect(res.status).toBe(200);
    expect(res.body.data.message).toBe(GENERIC);
    const { total } = (await (await fetch(`${MAILPIT}/api/v1/messages`)).json()) as { total: number };
    expect(total).toBe(0);
  });

  it("always queues a job, so the response takes the same time either way", async () => {
    await createOrg("a");

    await forgot({ organization: "a", email: "nobody@a.test" });

    expect(await notificationsQueue().getJobs(["waiting"])).toHaveLength(1);
  });

  it("stores only a hash of the token", async () => {
    const a = await withPassword(await createOrg("a"));
    await forgot({ organization: "a", email: a.resident.email });
    await runQueuedJobs();

    const token = await tokenFromEmail();
    const rows = await adminDb.select().from(passwordResets);

    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it("limits emails per account (3 per hour) but keeps the same answer", async () => {
    const a = await withPassword(await createOrg("a"));
    for (let i = 0; i < 4; i++) {
      expect((await forgot({ organization: "a", email: a.resident.email })).body.data.message).toBe(GENERIC);
    }
    await runQueuedJobs();

    const { total } = (await (await fetch(`${MAILPIT}/api/v1/messages`)).json()) as { total: number };
    expect(total).toBe(3);
  });
});

describe("POST /api/auth/reset-password", () => {
  async function requestToken(a: Org) {
    await forgot({ organization: "a", email: a.resident.email });
    await runQueuedJobs();
    return tokenFromEmail();
  }

  it("sets the new password and logs out every device", async () => {
    const a = await withPassword(await createOrg("a"));
    const token = await requestToken(a);

    const res = await reset({ token, newPassword: NEW_PASSWORD });

    expect(res.status).toBe(200);
    expect((await login("a", a.resident.email, NEW_PASSWORD)).status).toBe(200);
    expect((await login("a", a.resident.email, OLD_PASSWORD)).status).toBe(401);
    expect((await request(app).get("/api/auth/me").auth(a.resident.token, { type: "bearer" })).status).toBe(401);
  });

  it("works only once", async () => {
    const a = await withPassword(await createOrg("a"));
    const token = await requestToken(a);

    await reset({ token, newPassword: NEW_PASSWORD });
    const again = await reset({ token, newPassword: "yet another passphrase" });

    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe("INVALID_RESET_LINK");
  });

  it("can't be used twice even at the same moment", async () => {
    const a = await withPassword(await createOrg("a"));
    const token = await requestToken(a);

    const results = await Promise.all([
      reset({ token, newPassword: NEW_PASSWORD }),
      reset({ token, newPassword: "a competing passphrase" }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
  });

  it("expires after 30 minutes", async () => {
    const a = await withPassword(await createOrg("a"));
    const token = await requestToken(a);
    await adminDb.update(passwordResets).set({ expiresAt: new Date(Date.now() - 1000) });

    expect((await reset({ token, newPassword: NEW_PASSWORD })).status).toBe(400);
  });

  it("a newer link replaces the older one", async () => {
    const a = await withPassword(await createOrg("a"));
    const first = await requestToken(a);
    await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });
    const second = await requestToken(a);

    expect((await reset({ token: first, newPassword: NEW_PASSWORD })).status).toBe(400);
    expect((await reset({ token: second, newPassword: NEW_PASSWORD })).status).toBe(200);
  });

  it("rejects an unknown token and a weak new password", async () => {
    expect((await reset({ token: "x".repeat(43), newPassword: NEW_PASSWORD })).status).toBe(400);
    const weak = await reset({ token: "x".repeat(43), newPassword: "short" });
    expect(weak.body.error.details[0].path).toBe("newPassword");
  });
});
