import "dotenv/config";

// Validate required environment variables once at startup so the app fails
// fast with a clear message instead of misbehaving later.

const NODE_ENVS = ["development", "test", "production"] as const;
type NodeEnv = (typeof NODE_ENVS)[number];

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return 3000;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: must be an integer between 1 and 65535`);
  }
  return port;
}

function parseNodeEnv(raw: string | undefined): NodeEnv {
  const value = raw ?? "development";
  if (!(NODE_ENVS as readonly string[]).includes(value)) {
    throw new Error(`Invalid NODE_ENV: must be one of ${NODE_ENVS.join(", ")}`);
  }
  return value as NodeEnv;
}

function parseDatabaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Never echo the value: it contains the database password.
    throw new Error("Invalid DATABASE_URL: not a valid URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("Invalid DATABASE_URL: must start with postgres:// or postgresql://");
  }
  return raw;
}

function parseOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

const nodeEnv = parseNodeEnv(process.env.NODE_ENV);

export const env = Object.freeze({
  nodeEnv,
  port: parsePort(process.env.PORT),
  databaseUrl: parseDatabaseUrl(required("DATABASE_URL")),
  // Browser origins allowed to call the API (the frontend), comma-separated.
  corsOrigins: parseOrigins(process.env.CORS_ORIGINS),
  // Redis for background job queues (BullMQ). Defaults to the Docker Compose one.
  redisUrl: process.env.REDIS_URL?.trim() || "redis://localhost:6379",
  // Where email is sent from. In development it defaults to Mailpit (Docker
  // Compose). In production, emails are skipped unless SMTP_URL is set.
  smtpUrl: process.env.SMTP_URL?.trim() || (nodeEnv === "production" ? undefined : "smtp://127.0.0.1:1025"),
  emailFrom: process.env.EMAIL_FROM?.trim() || "FixFlow <no-reply@fixflow.local>",
  // The frontend's address, for links in emails.
  appUrl: (process.env.APP_URL?.trim() || "http://localhost:5173").replace(/\/$/, ""),
  // File storage (S3 API): Cloudflare R2 in production, SeaweedFS locally.
  // In development everything defaults to the Docker Compose SeaweedFS; in
  // production all of these must be set or uploads are refused (503).
  s3: {
    endpoint: process.env.S3_ENDPOINT?.trim() || (nodeEnv === "production" ? undefined : "http://127.0.0.1:8333"),
    region: process.env.S3_REGION?.trim() || "auto",
    bucket: process.env.S3_BUCKET?.trim() || "fixflow",
    accessKeyId: process.env.S3_ACCESS_KEY_ID?.trim() || (nodeEnv === "production" ? undefined : "fixflow-dev"),
    secretAccessKey:
      process.env.S3_SECRET_ACCESS_KEY?.trim() || (nodeEnv === "production" ? undefined : "fixflow-dev-secret"),
  },
});

export const isProduction = env.nodeEnv === "production";
