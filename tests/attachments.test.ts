// Photo attachments, stored in the local S3-compatible SeaweedFS.

import sharp from "sharp";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { MAX_ATTACHMENT_BYTES, ticketAttachments } from "../src/db/schema.js";
import { detectImageType } from "../src/lib/image-type.js";
import { MAX_ATTACHMENTS_PER_TICKET } from "../src/modules/attachments/attachments.routes.js";
import { adminDb, closeDatabases, createOrg, createTicket, resetDatabase } from "./helpers.js";

const app = createApp();

beforeEach(resetDatabase);
afterAll(closeDatabases);

// Real images, made with sharp: 800×600 so the thumbnail is visibly smaller.
let PNG: Buffer;
let JPEG: Buffer;
let WEBP: Buffer;
// A JPEG carrying GPS coordinates in its EXIF metadata, like a phone photo.
let JPEG_WITH_GPS: Buffer;
// Files that merely *start* like JPEG/WebP: right first bytes, garbage after.
const FAKE_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)]);
const FAKE_WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WEBPVP8 "), Buffer.alloc(40)]);

beforeAll(async () => {
  const canvas = () => sharp({ create: { width: 800, height: 600, channels: 3, background: "#3366cc" } });
  PNG = await canvas().png().toBuffer();
  JPEG = await canvas().jpeg().toBuffer();
  WEBP = await canvas().webp().toBuffer();
  JPEG_WITH_GPS = await canvas()
    .jpeg()
    .withExif({ IFD0: { Make: "TestPhone" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "12/1 58/1 0/1" } })
    .toBuffer();
});

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
    ["JPEG", () => FAKE_JPEG, "image/jpeg"],
    ["WebP", () => FAKE_WEBP, "image/webp"],
    ["PNG", () => PNG, "image/png"],
  ] as const)("recognizes %s by its signature", (_name, bytes, type) => {
    expect(detectImageType(bytes())?.type).toBe(type);
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
  it("stores a photo and returns a download link to the full image", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a);

    const res = await upload(ticket.id, a.resident, PNG, "leak.png");

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      ticketId: ticket.id,
      uploadedBy: a.resident.id,
      fileName: "leak.png",
      contentType: "image/png",
    });
    expect(res.body.data.storageKey).toBeUndefined(); // internal details, never exposed
    expect(res.body.data.thumbnailKey).toBeUndefined();

    const download = await fetch(res.body.data.url);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("image/png");
    const meta = await sharp(Buffer.from(await download.arrayBuffer())).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["png", 800, 600]);
  });

  it("makes a small WebP thumbnail", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a);

    const { body } = await upload(ticket.id, a.resident, PNG);
    const thumb = Buffer.from(await (await fetch(body.data.thumbnailUrl)).arrayBuffer());
    const meta = await sharp(thumb).metadata();

    expect(meta.format).toBe("webp");
    expect([meta.width, meta.height]).toEqual([320, 240]); // fits in 320×320, keeps the shape
  });

  it("removes hidden metadata such as GPS location", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a);
    expect((await sharp(JPEG_WITH_GPS).metadata()).exif).toBeDefined(); // the upload really has it

    const { body } = await upload(ticket.id, a.resident, JPEG_WITH_GPS, "flat.jpg");
    const stored = Buffer.from(await (await fetch(body.data.url)).arrayBuffer());

    expect((await sharp(stored).metadata()).exif).toBeUndefined();
  });

  it.each([
    ["JPEG", () => FAKE_JPEG],
    ["WebP", () => FAKE_WEBP],
  ])("rejects a fake %s that only has the right first bytes", async (_name, bytes) => {
    const a = await createOrg("a");
    const ticket = await createTicket(a);

    const res = await upload(ticket.id, a.resident, bytes(), "photo");

    expect(res.status).toBe(415);
    expect(await adminDb.select().from(ticketAttachments)).toHaveLength(0);
  });

  it.each([
    ["JPEG", () => JPEG, "image/jpeg"],
    ["WebP", () => WEBP, "image/webp"],
  ] as const)("accepts %s", async (_name, bytes, type) => {
    const a = await createOrg("a");
    const ticket = await createTicket(a);

    const res = await upload(ticket.id, a.resident, bytes(), "photo");

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

describe("DELETE /api/tickets/:id/attachments/:attachmentId", () => {
  const remove = (ticketId: string, attachmentId: string, asUser: AsUser) =>
    request(app).delete(`/api/tickets/${ticketId}/attachments/${attachmentId}`).auth(asUser.token, { type: "bearer" });

  it("lets the uploader remove their photo: the record and the file are gone", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a);
    const { body } = await upload(ticket.id, a.resident, PNG);

    const res = await remove(ticket.id, body.data.id, a.resident);

    expect(res.status).toBe(204);
    expect(await adminDb.select().from(ticketAttachments)).toHaveLength(0);
    expect((await fetch(body.data.url)).status).toBe(404); // the file itself was deleted from storage
    expect((await fetch(body.data.thumbnailUrl)).status).toBe(404); // and its thumbnail
  });

  it.each(["manager", "admin"] as const)("lets a %s remove anyone's photo", async (role) => {
    const a = await createOrg("a");
    const ticket = await createTicket(a);
    const { body } = await upload(ticket.id, a.resident, PNG);

    expect((await remove(ticket.id, body.data.id, a[role])).status).toBe(204);
  });

  it("forbids someone who can see the ticket but didn't upload the photo", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a, { status: "assigned", assignedTo: a.technician.id });
    const { body } = await upload(ticket.id, a.resident, PNG);

    const res = await remove(ticket.id, body.data.id, a.technician);

    expect(res.status).toBe(403);
    expect(await adminDb.select().from(ticketAttachments)).toHaveLength(1);
  });

  it("returns 404 to people who can't see the ticket", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a);
    const { body } = await upload(ticket.id, a.resident, PNG);

    expect((await remove(ticket.id, body.data.id, a.resident2)).status).toBe(404);
    expect(await adminDb.select().from(ticketAttachments)).toHaveLength(1);
  });

  it("returns 404 for a photo that belongs to a different ticket", async () => {
    const a = await createOrg("a");
    const ticket = await createTicket(a);
    const otherTicket = await createTicket(a);
    const { body } = await upload(otherTicket.id, a.resident, PNG);

    expect((await remove(ticket.id, body.data.id, a.resident)).status).toBe(404);
  });
});
