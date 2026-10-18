// Photo attachments, stored in the local S3-compatible SeaweedFS.

import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { MAX_ATTACHMENT_BYTES, ticketAttachments } from "../src/db/schema.js";
import { detectImageType } from "../src/lib/image-type.js";
import { MAX_ATTACHMENTS_PER_TICKET } from "../src/modules/attachments/attachments.routes.js";
import { adminDb, closeDatabases, createOrg, createTicket, resetDatabase } from "./helpers.js";

const app = createApp();

beforeEach(resetDatabase);
afterAll(closeDatabases);

// The smallest valid 1×1 PNG, plus files that merely *start* like JPEG/WebP
// (only the first bytes matter for type detection).
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WEBPVP8 "), Buffer.alloc(40)]);

type AsUser = { token: string };
const upload = (ticketId: string, asUser: AsUser, file: Buffer, filename = "photo.png") =>
  request(app)
    .post(`/api/tickets/${ticketId}/attachments`)
    .auth(asUser.token, { type: "bearer" })
    .attach("photo", file, filename);
const list = (ticketId: string, asUser: AsUser) =>
  request(app).get(`/api/tickets/${ticketId}/attachments`).auth(asUser.token, { type: "bearer" });

describe("detectImageType (reads the file's first bytes)", () => {
  it.each([
    ["PNG", PNG, "image/png"],
    ["JPEG", JPEG, "image/jpeg"],
    ["WebP", WEBP, "image/webp"],
  ] as const)("recognizes %s", (_name, bytes, type) => {
    expect(detectImageType(bytes)?.type).toBe(type);
  });

  it.each([
    ["text", Buffer.from("hello world")],
    ["HTML", Buffer.from("<html><script>alert(1)</script></html>")],
    ["a PDF", Buffer.from("%PDF-1.7 …")],
    ["an empty file", Buffer.alloc(0)],
  ])("rejects %s", (_name, bytes) => {
    expect(detectImageType(bytes)).toBeNull();
  });
});

describe("POST /api/tickets/:id/attachments", () => {
  it("stores a photo and returns a download link that serves the same bytes", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a);

    const res = await upload(ticket.id, a.resident, PNG, "leak.png");

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      ticketId: ticket.id,
      uploadedBy: a.resident.id,
      fileName: "leak.png",
      contentType: "image/png",
      sizeBytes: PNG.length,
    });
    expect(res.body.data.storageKey).toBeUndefined(); // internal detail, never exposed

    const download = await fetch(res.body.data.url);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await download.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it.each([
    ["JPEG", JPEG, "image/jpeg"],
    ["WebP", WEBP, "image/webp"],
  ] as const)("accepts %s", async (_name, bytes, type) => {
    const a = await createOrg("a");
    const ticket = await createTicket(a);

    const res = await upload(ticket.id, a.resident, bytes, "photo");

    expect(res.status).toBe(201);
    expect(res.body.data.contentType).toBe(type);
  });

  it("rejects a non-image even when it's named .jpg and claims to be one", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a);

    const res = await request(app)
      .post(`/api/tickets/${ticket.id}/attachments`)
      .auth(a.resident.token, { type: "bearer" })
      .attach("photo", Buffer.from("<script>alert(1)</script>"), { filename: "cute.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe("UNSUPPORTED_FILE_TYPE");
    expect(await adminDb.select().from(ticketAttachments)).toHaveLength(0);
  });

  it("rejects photos over 5 MB", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a);
    const tooBig = Buffer.concat([PNG, Buffer.alloc(MAX_ATTACHMENT_BYTES)]);

    const res = await upload(ticket.id, a.resident, tooBig);

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("requires a file", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a);

    const res = await request(app)
      .post(`/api/tickets/${ticket.id}/attachments`)
      .auth(a.resident.token, { type: "bearer" })
      .field("note", "no file here");

    expect(res.status).toBe(400);
  });

  it("never uses the uploaded file name in the storage path", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a);

    const res = await upload(ticket.id, a.resident, PNG, "../../../etc/passwd.png");
    const [row] = await adminDb.select().from(ticketAttachments);

    expect(res.status).toBe(201);
    expect(row!.storageKey).toMatch(new RegExp(`^orgs/${a.org.id}/tickets/${ticket.id}/[0-9a-f-]{36}\\.png$`));
    expect(res.body.data.fileName).toBe("passwd.png");
  });

  it(`allows at most ${MAX_ATTACHMENTS_PER_TICKET} photos per ticket`, async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a);
    for (let i = 0; i < MAX_ATTACHMENTS_PER_TICKET; i++) {
      expect((await upload(ticket.id, a.resident, PNG)).status).toBe(201);
    }

    const res = await upload(ticket.id, a.resident, PNG);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("TOO_MANY_ATTACHMENTS");
  });

  it.each([
    ["another resident", "resident2"],
    ["a technician it isn't assigned to", "technician2"],
  ] as const)("returns 404 for %s, and stores nothing", async (_name, who) => {
    const a = await createOrg("a");
    const ticket = await createTicket(a, { status: "assigned", assignedTo: a.technician.id });

    expect((await upload(ticket.id, a[who], PNG)).status).toBe(404);
    expect((await list(ticket.id, a[who])).status).toBe(404);
    expect(await adminDb.select().from(ticketAttachments)).toHaveLength(0);
  });

  it("returns 404 for another organization's ticket", async () => {
    const a = await createOrg("a");
    const b = await createOrg("b");
    const bTicket = await createTicket(b);

    expect((await upload(bTicket.id, a.manager, PNG)).status).toBe(404);
  });
});

describe("GET /api/tickets/:id/attachments", () => {
  it("lists the ticket's photos with download links that expire after 5 minutes", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a, { status: "assigned", assignedTo: a.technician.id });
    await upload(ticket.id, a.resident, PNG, "first.png");
    await upload(ticket.id, a.resident, JPEG, "second.jpg");

    const res = await list(ticket.id, a.technician); // the assigned technician can see them too

    expect(res.status).toBe(200);
    expect(res.body.data.map((p: { fileName: string }) => p.fileName)).toEqual(["first.png", "second.jpg"]);
    const url = new URL(res.body.data[0].url);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
  });

  it("a tampered link is refused by storage", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a);
    const { body } = await upload(ticket.id, a.resident, PNG);

    const tampered = new URL(body.data.url);
    tampered.pathname = tampered.pathname.replace(/[0-9a-f-]{36}\.png$/, "00000000-0000-0000-0000-000000000000.png");

    expect((await fetch(tampered)).status).toBe(403);
  });
});
