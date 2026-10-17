import type { ErrorRequestHandler, RequestHandler } from "express";
import { isProduction } from "../config/env.js";

// Throw this from routes/services for expected failures (bad input, not found,
// forbidden). Anything else is treated as an unexpected 500.
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new HttpError(404, "NOT_FOUND", `Route ${req.method} ${req.path} not found`));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined && { details: err.details }),
      },
    });
    return;
  }

  // Errors raised by Express's body parser (malformed JSON, payload too large)
  // carry a 4xx status and are safe to report in general terms.
  const status = typeof err?.status === "number" ? err.status : 500;
  if (status >= 400 && status < 500) {
    const known: Record<string, { code: string; message: string }> = {
      "entity.parse.failed": { code: "BAD_REQUEST", message: "Malformed JSON body" },
      "entity.too.large": { code: "PAYLOAD_TOO_LARGE", message: "Request body too large" },
    };
    res.status(status).json({
      error: known[err.type] ?? { code: "BAD_REQUEST", message: "Bad request" },
    });
    return;
  }

  // Unexpected error: log full detail server-side, return a generic message.
  console.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, err);
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
      ...(!isProduction && err instanceof Error && { debug: err.message }),
    },
  });
};
