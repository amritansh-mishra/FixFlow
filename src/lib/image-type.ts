// Works out what kind of image a file really is from its first bytes (its
// "magic number"), instead of trusting the file name or the type the browser
// sent. Both of those are chosen by the client and easy to fake: a file named
// photo.jpg could be a script or an HTML page.

import type { AttachmentType } from "../db/schema.js";

const startsWith = (bytes: Buffer, signature: number[], offset = 0) =>
  bytes.length >= offset + signature.length && signature.every((b, i) => bytes[offset + i] === b);

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

export function detectImageType(bytes: Buffer): { type: AttachmentType; extension: string } | null {
  // JPEG: FF D8 FF
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { type: "image/jpeg", extension: "jpg" };
  // PNG: 89 "PNG" CR LF SUB LF
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { type: "image/png", extension: "png" };
  // WebP: "RIFF" <4-byte size> "WEBP"
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return { type: "image/webp", extension: "webp" };
  return null;
}
