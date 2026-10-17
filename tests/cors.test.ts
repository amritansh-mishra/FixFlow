// CORS is configured from CORS_ORIGINS at startup; vitest.config.ts sets it
// to http://localhost:5173 for tests.

import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { closeDatabases } from "./helpers.js";

const app = createApp();
afterAll(closeDatabases);

const ALLOWED = "http://localhost:5173";

describe("CORS", () => {
  it("allows the configured frontend origin", async () => {
    const res = await request(app).get("/health").set("Origin", ALLOWED);

    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED);
    expect(res.headers["access-control-expose-headers"]).toContain("Location");
    expect(res.headers.vary).toContain("Origin");
  });

  it("answers the browser's preflight request", async () => {
    const res = await request(app)
      .options("/api/tickets")
      .set("Origin", ALLOWED)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "authorization, content-type");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-methods"]).toContain("PATCH");
    expect(res.headers["access-control-allow-headers"]).toContain("Authorization");
  });

  it("gives no CORS permission to other origins", async () => {
    const res = await request(app).get("/health").set("Origin", "https://evil.example");

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
