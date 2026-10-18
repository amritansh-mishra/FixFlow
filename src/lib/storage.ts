// File storage over the S3 API: Cloudflare R2 in production, SeaweedFS in
// local development and CI. Same code; only the settings differ.

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env.js";
import { HttpError } from "../middleware/errors.js";

// How long a download link works.
export const DOWNLOAD_LINK_SECONDS = 5 * 60;

let client: S3Client | undefined;

function s3(): S3Client {
  const { endpoint, region, accessKeyId, secretAccessKey } = env.s3;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new HttpError(503, "STORAGE_UNAVAILABLE", "File storage isn't configured on this server");
  }
  client ??= new S3Client({
    endpoint,
    region, // "auto" for R2
    // host/bucket/key addresses, supported by both R2 and SeaweedFS.
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
  return client;
}

export async function putFile(key: string, body: Buffer, contentType: string): Promise<void> {
  await s3().send(new PutObjectCommand({ Bucket: env.s3.bucket, Key: key, Body: body, ContentType: contentType }));
}

// A link that downloads the file directly from storage and stops working
// after a few minutes, so it can't be shared around indefinitely. The
// signature in the link proves it was issued by this server.
export async function downloadLink(key: string): Promise<string> {
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: env.s3.bucket, Key: key }), {
    expiresIn: DOWNLOAD_LINK_SECONDS,
  });
}

// Creates the bucket if it doesn't exist yet: convenient for local
// development and tests. In production the R2 bucket is created once in the
// Cloudflare dashboard, and the app's key needn't be allowed to create buckets.
export async function ensureBucket(): Promise<void> {
  try {
    await s3().send(new HeadBucketCommand({ Bucket: env.s3.bucket }));
  } catch {
    await s3().send(new CreateBucketCommand({ Bucket: env.s3.bucket }));
  }
}

export async function deleteFile(key: string): Promise<void> {
  await s3().send(new DeleteObjectCommand({ Bucket: env.s3.bucket, Key: key }));
}
