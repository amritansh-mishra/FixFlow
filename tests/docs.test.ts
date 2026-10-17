import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { openApiDocument } from "../src/docs/openapi.js";
import { closeDatabases } from "./helpers.js";

const app = createApp();
afterAll(closeDatabases);

const operations = Object.entries(openApiDocument.paths).flatMap(([path, ops]) =>
  Object.keys(ops).map((method) => ({ method, path })),
);

describe("API docs", () => {
  it("serves the OpenAPI document", async () => {
    const res = await request(app).get("/openapi.json");

    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe("3.1.0");
    expect(Object.keys(res.body.paths).length).toBeGreaterThan(10);
  });

  it("serves the Swagger UI page", async () => {
    const res = await request(app).get("/docs");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain('url: "/openapi.json"');
  });

  // Every documented endpoint must be a real route: the app's catch-all 404
  // ("Route ... not found") means the docs describe something that doesn't exist.
  it.each(operations)("$method $path exists", async ({ method, path }) => {
    const url = path.replace("{id}", "00000000-0000-0000-0000-000000000000");

    const res = await request(app)[method as "get" | "post" | "patch"](url);

    expect(res.body?.error?.code).not.toBe("NOT_FOUND");
  });

  it("documents request bodies from the same rules the API validates with", () => {
    const create = openApiDocument.paths["/api/tickets"].post.requestBody.content["application/json"].schema;

    expect(create).toMatchObject({
      required: ["propertyId", "title"],
      additionalProperties: false,
      properties: { title: { minLength: 1, maxLength: 200 } },
    });
  });
});
