// Runs once before all tests: recreate the test database from the migrations,
// so every test run starts from exactly the schema in drizzle/.

import path from "node:path";
import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { TEST_DB_NAME, testDatabaseUrl } from "./test-db.js";

// The local SeaweedFS (Docker Compose locally, a container in CI).
const TEST_BUCKET = "fixflow-test";

// Create the test bucket if needed and empty it, so each run starts clean.
async function resetTestBucket() {
  const s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT ?? "http://127.0.0.1:8333",
    region: "auto",
    forcePathStyle: true,
    credentials: { accessKeyId: "fixflow-dev", secretAccessKey: "fixflow-dev-secret" },
  });
  try {
    await s3.send(new HeadBucketCommand({ Bucket: TEST_BUCKET }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: TEST_BUCKET }));
  }
  for (;;) {
    const { Contents = [] } = await s3.send(new ListObjectsV2Command({ Bucket: TEST_BUCKET }));
    if (Contents.length === 0) break;
    await s3.send(
      new DeleteObjectsCommand({ Bucket: TEST_BUCKET, Delete: { Objects: Contents.map((o) => ({ Key: o.Key! })) } }),
    );
  }
  s3.destroy();
}

export default async function setup() {
  await resetTestBucket();

  const admin = new pg.Client({ connectionString: testDatabaseUrl("admin", "postgres") });
  await admin.connect();
  try {
    // TEST_DB_NAME is a constant, never user input, so building SQL with it is safe.
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  } finally {
    await admin.end();
  }

  const pool = new pg.Pool({ connectionString: testDatabaseUrl("admin") });
  try {
    await migrate(drizzle(pool), {
      migrationsFolder: path.resolve(import.meta.dirname, "../drizzle"),
    });
  } finally {
    await pool.end();
  }
}
