// Photos on a ticket.
//
//   POST /api/tickets/:id/attachments   upload one photo (form field "photo")
//   GET  /api/tickets/:id/attachments   list photos, each with a short-lived download link
//
// Anyone who can see the ticket can add and view its photos.

import { randomUUID } from "node:crypto";
import { and, asc, count, eq } from "drizzle-orm";
import { Router, type RequestHandler } from "express";
import multer from "multer";
import { db } from "../../db/index.js";
import { MAX_ATTACHMENT_BYTES, ticketAttachments, type TicketAttachment } from "../../db/schema.js";
import { detectImageType } from "../../lib/image-type.js";
import { downloadLink, putFile } from "../../lib/storage.js";
import { validate } from "../../lib/validate.js";
import { getAuth, requireUser } from "../../middleware/auth.js";
import { HttpError } from "../../middleware/errors.js";
import { ticketIdParams } from "../tickets/tickets.schemas.js";
import { getTicket } from "../tickets/tickets.service.js";

export const MAX_ATTACHMENTS_PER_TICKET = 10;

// mergeParams: see :id from the parent route (/api/tickets/:id/attachments).
export const attachmentsRouter = Router({ mergeParams: true });

attachmentsRouter.use(requireUser);

// Step 1, before reading any upload: the ticket must exist and be visible to
// the caller (same 404 as everywhere else for tickets they can't see).
const loadTicket: RequestHandler = async (req, res, next) => {
  const { id } = validate(ticketIdParams, req.params, "ticket id");
  const ticket = await getTicket(getAuth(req), id);
  if (!ticket) throw new HttpError(404, "TICKET_NOT_FOUND", "Ticket not found");
  res.locals.ticketId = ticket.id;
  next();
};

// Step 2: read one file, kept in memory, at most 5 MB. Larger uploads are
// cut off as soon as they pass the limit.
const parseUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1, fields: 5 },
}).single("photo");

const readPhoto: RequestHandler = (req, res, next) => {
  parseUpload(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return next(new HttpError(413, "PAYLOAD_TOO_LARGE", "Photos can be at most 5 MB"));
      }
      return next(new HttpError(400, "VALIDATION_ERROR", `Upload rejected: ${err.message}`));
    }
    next(err);
  });
};

// The original name is kept for display only: strip folders and odd characters.
function cleanFileName(name: string, extension: string): string {
  const base = name.split(/[\\/]/).pop()!.replace(/[^\w.\- ]+/g, "").trim().slice(0, 200);
  return base || `photo.${extension}`;
}

async function withLink(row: TicketAttachment) {
  const { storageKey: _key, organizationId: _org, ...rest } = row;
  return { ...rest, url: await downloadLink(row.storageKey) };
}

attachmentsRouter.post("/", loadTicket, readPhoto, async (req, res) => {
  const auth = getAuth(req);
  const ticketId: string = res.locals.ticketId;
  const file = req.file;
  if (!file) throw new HttpError(400, "VALIDATION_ERROR", 'Attach a photo in the "photo" form field');

  // Step 3: what the file really is, from its contents.
  const detected = detectImageType(file.buffer);
  if (!detected) {
    throw new HttpError(415, "UNSUPPORTED_FILE_TYPE", "Only JPEG, PNG and WebP photos are allowed");
  }

  const [existing] = await db
    .select({ value: count() })
    .from(ticketAttachments)
    .where(and(eq(ticketAttachments.organizationId, auth.organizationId), eq(ticketAttachments.ticketId, ticketId)));
  if ((existing?.value ?? 0) >= MAX_ATTACHMENTS_PER_TICKET) {
    throw new HttpError(409, "TOO_MANY_ATTACHMENTS", `A ticket can have at most ${MAX_ATTACHMENTS_PER_TICKET} photos`);
  }

  // Step 4: store it under a key the server chooses. The uploaded file name
  // never becomes part of the path, so names like "../../x" can't do anything.
  const storageKey = `orgs/${auth.organizationId}/tickets/${ticketId}/${randomUUID()}.${detected.extension}`;
  await putFile(storageKey, file.buffer, detected.type);

  // Step 5: record it.
  const [row] = await db
    .insert(ticketAttachments)
    .values({
      organizationId: auth.organizationId,
      ticketId,
      uploadedBy: auth.userId,
      storageKey,
      fileName: cleanFileName(file.originalname, detected.extension),
      contentType: detected.type,
      sizeBytes: file.size,
    })
    .returning();
  res.status(201).json({ data: await withLink(row!) });
});

attachmentsRouter.get("/", loadTicket, async (req, res) => {
  const auth = getAuth(req);
  const rows = await db
    .select()
    .from(ticketAttachments)
    .where(
      and(eq(ticketAttachments.organizationId, auth.organizationId), eq(ticketAttachments.ticketId, res.locals.ticketId)),
    )
    .orderBy(asc(ticketAttachments.createdAt), asc(ticketAttachments.id));
  res.status(200).json({ data: await Promise.all(rows.map(withLink)) });
});
