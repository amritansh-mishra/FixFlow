import express from "express";
import { isProduction } from "./config/env.js";
import { pool } from "./db/index.js";
import { errorHandler, notFoundHandler } from "./middleware/errors.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { propertiesRouter } from "./modules/properties/properties.routes.js";
import { statsRouter } from "./modules/stats/stats.routes.js";
import { ticketsRouter } from "./modules/tickets/tickets.routes.js";

// Builds the Express app without starting a listener, so tests can import it.
export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  // In production the app runs behind the host's proxy (Render). Trust one
  // proxy hop so req.ip is the real client address; otherwise every user
  // would share the proxy's IP and its login rate limit.
  if (isProduction) app.set("trust proxy", 1);
  app.use(express.json({ limit: "100kb" }));

  // A short index for anyone opening the API in a browser.
  app.get("/", (_req, res) => {
    res.json({
      name: "FixFlow API",
      description: "Multi-tenant maintenance and work-order management",
      docs: "https://github.com/amritansh-mishra/FixFlow#api",
      health: "/health",
      endpoints: [
        "POST /api/auth/login",
        "POST /api/auth/logout",
        "GET  /api/auth/me",
        "GET  /api/properties",
        "GET  /api/stats",
        "GET  /api/tickets",
        "POST /api/tickets",
        "GET  /api/tickets/:id",
        "GET  /api/tickets/:id/history",
        "GET  /api/tickets/:id/comments",
        "POST /api/tickets/:id/comments",
        "PATCH /api/tickets/:id/assign",
        "PATCH /api/tickets/:id/status",
      ],
    });
  });

  // Health check, including database connectivity
  app.get("/health", async (_req, res) => {
    const timestamp = new Date().toISOString();
    try {
      await pool.query("SELECT 1");
      res.status(200).json({ status: "ok", database: "connected", timestamp });
    } catch (err) {
      console.error("Health check: database unreachable", err);
      res.status(503).json({ status: "degraded", database: "unreachable", timestamp });
    }
  });

  app.use("/api/auth", authRouter);
  app.use("/api/properties", propertiesRouter);
  app.use("/api/stats", statsRouter);
  app.use("/api/tickets", ticketsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
