// Prepares an uploaded photo with sharp:
// - strips hidden metadata (EXIF), which on phone photos often includes the
//   GPS location where it was taken, e.g. a resident's home;
// - applies the camera's rotation, so photos aren't sideways once that
//   metadata is gone;
// - makes a small WebP thumbnail for the photo grid.
//
// Decoding the whole image is also a stronger check than the first-bytes
// test: a file with an image's signature but garbage after it fails here.

import sharp from "sharp";
import type { AttachmentType } from "../db/schema.js";

export const THUMBNAIL_SIZE = 320;
// Refuse absurdly large images (e.g. a tiny file that decodes to 100,000 ×
// 100,000 pixels, a "decompression bomb" meant to exhaust memory).
const MAX_PIXELS = 40_000_000;

export async function preparePhoto(
  input: Buffer,
  type: AttachmentType,
): Promise<{ original: Buffer; thumbnail: Buffer } | null> {
  try {
    const image = () => sharp(input, { limitInputPixels: MAX_PIXELS }).rotate();
    // sharp drops all metadata on output unless asked to keep it.
    const reencoded =
      type === "image/jpeg"
        ? image().jpeg({ quality: 90, mozjpeg: true })
        : type === "image/png"
          ? image().png({ compressionLevel: 9 })
          : image().webp({ quality: 90 });
    const [original, thumbnail] = await Promise.all([
      reencoded.toBuffer(),
      image()
        .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 75 })
        .toBuffer(),
    ]);
    return { original, thumbnail };
  } catch {
    return null; // not a decodable image
  }
}
