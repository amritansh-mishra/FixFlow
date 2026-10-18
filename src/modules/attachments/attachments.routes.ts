// Photos on a ticket.
//
//   POST /api/tickets/:id/attachments   upload one photo (form field "photo")
//   GET  /api/tickets/:id/attachments   list photos, each with a short-lived download link
//   DELETE /api/tickets/:id/attachments/:attachmentId   remove one (uploader, manager, admin)
//
// Anyone who can see the ticket can add and view its photos.

import { randomUUID } from "node:crypto";
import { and, asc, count, eq } from "drizzle-orm";
import { Router, type RequestHandler } from "express";
import multer from "multer";
import { z } from "zod";
import { db } from "../../db/index.js";
import { MAX_ATTACHMENT_BYTES, ticketAttachments, type TicketAttachment } from "../../db/schema.js";
import { detectImageType } from "../../lib/image-type.js";
import { preparePhoto } from "../../lib/images.js";
import { deleteFile, downloadLink, putFile } from "../../lib/storage.js";
import { validate } from "../../lib/validate.js";
import { getAuth, requireUser } from "../../middleware/auth.js";
import { HttpError } from "../../middleware/errors.js";
import { ticketIdParams } from "../tickets/tickets.schemas.js";
import { getTicket } from "../tickets/tickets.service.js";

export const MAX_ATTACHMENTS_PER_TICKET = 10;

const attachmentIdParams = z.object({ attachmentId: z.uuid() });

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

export async function withLink(row: TicketAttachment) {
  const { storageKey: _key, thumbnailKey: _thumb, organizationId: _org, ...rest } = row;
  const [url, thumbnailUrl] = await Promise.all([
    downloadLink(row.storageKey),
    // Older photos have no thumbnail: fall back to the full photo.
    row.thumbnailKey ? downloadLink(row.thumbnailKey) : undefined,
  ]);
  return { ...rest, url, thumbnailUrl: thumbnailUrl ?? url };
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

  // Step 4: decode it fully (rejects fakes), strip hidden metadata such as
  // GPS location, and make a thumbnail.
  const prepared = await preparePhoto(file.buffer, detected.type);
  if (!prepared) {
    throw new HttpError(415, "UNSUPPORTED_FILE_TYPE", "That file isn't a valid JPEG, PNG or WebP image");
  }
  if (prepared.original.length > MAX_ATTACHMENT_BYTES) {
    throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Photos can be at most 5 MB");
  }

  // Step 5: store both under keys the server chooses. The uploaded file name
  // never becomes part of the path, so names like "../../x" can't do anything.
  const base = `orgs/${auth.organizationId}/tickets/${ticketId}/${randomUUID()}`;
  const storageKey = `${base}.${detected.extension}`;
  const thumbnailKey = `${base}-thumb.webp`;
  await Promise.all([
    putFile(storageKey, prepared.original, detected.type),
    putFile(thumbnailKey, prepared.thumbnail, "image/webp"),
  ]);

  // Step 6: record it.
  const [row] = await db
    .insert(ticketAttachments)
    .values({
      organizationId: auth.organizationId,
      ticketId,
      uploadedBy: auth.userId,
      storageKey,
      thumbnailKey,
      fileName: cleanFileName(file.originalname, detected.extension),
      contentType: detected.type,
      sizeBytes: prepared.original.length,
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

// DELETE /api/tickets/:id/attachments/:attachmentId
// The uploader can remove their own photo; managers and admins can remove any.
attachmentsRouter.delete("/:attachmentId", loadTicket, async (req, res) => {
  const auth = getAuth(req);
  const { attachmentId } = validate(attachmentIdParams, req.params, "attachment id");

  const [photo] = await db
    .select({
      id: ticketAttachments.id,
      uploadedBy: ticketAttachments.uploadedBy,
      storageKey: ticketAttachments.storageKey,
      thumbnailKey: ticketAttachments.thumbnailKey,
    })
    .from(ticketAttachments)
    .where(
      and(
        eq(ticketAttachments.id, attachmentId),
        eq(ticketAttachments.ticketId, res.locals.ticketId),
        eq(ticketAttachments.organizationId, auth.organizationId),
      ),
    );
  if (!photo) throw new HttpError(404, "ATTACHMENT_NOT_FOUND", "Photo not found");

  const isManager = auth.role === "manager" || auth.role === "admin";
  if (photo.uploadedBy !== auth.userId && !isManager) {
    throw new HttpError(403, "FORBIDDEN", "Only the person who added a photo, or a manager, can remove it");
  }

  // Record first, then the file. If removing the file fails, the worst case
  // is an unused file in storage, never a broken photo on the page.
  await db.delete(ticketAttachments).where(eq(ticketAttachments.id, photo.id));
  try {
    await Promise.all([deleteFile(photo.storageKey), photo.thumbnailKey ? deleteFile(photo.thumbnailKey) : undefined]);
  } catch (err) {
    console.error(`Photo ${photo.id} removed, but deleting its file failed (orphaned: ${photo.storageKey}):`, err);
  }
  res.status(204).end();
});
