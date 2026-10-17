import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { closeDatabases, createOrg, resetDatabase } from "./helpers.js";

const app = createApp();

beforeEach(resetDatabase);
afterAll(closeDatabases);

describe("GET /api/properties", () => {
  it("lists only the caller's organization's properties", async () => {
    const a = await createOrg("a");
    await createOrg("b");

    const res = await request(app).get("/api/properties").auth(a.resident.token, { type: "bearer" });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ id: a.property.id, name: "a Block A", address: null }]);
  });

  it("requires login", async () => {
    expect((await request(app).get("/api/properties")).status).toBe(401);
  });
});

describe("GET /", () => {
  it("describes the API", async () => {
    const res = await request(app).get("/");

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("FixFlow API");
    expect(res.body.endpoints).toContain("GET  /api/properties");
  });
});
