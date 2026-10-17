// CORS: lets the separately deployed frontend call this API from the browser.
//
// Browsers block a page on one origin (e.g. https://fixflow-web.onrender.com)
// from reading responses from another origin (the API) unless the API says the
// page's origin is allowed. Only origins listed in CORS_ORIGINS are allowed.
//
// Auth uses the Authorization header, not cookies, so credentials mode isn't needed.

import type { RequestHandler } from "express";
import { env } from "../config/env.js";

export const cors: RequestHandler = (req, res, next) => {
  const origin = req.get("origin");
  if (origin && env.corsOrigins.includes(origin)) {
    res.set({
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      // Let the frontend read these response headers too.
      "Access-Control-Expose-Headers": "Location, Retry-After",
      "Access-Control-Max-Age": "600",
    });
  }
  // Responses differ by Origin, so caches must keep them apart.
  res.vary("Origin");

  // The browser's "may I?" request before the real one.
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
};
