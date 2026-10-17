import express from "express";
import { pool } from "./db/index.js";
import { errorHandler, notFoundHandler } from "./middleware/errors.js";

// Builds the Express app without starting a listener, so tests can import it.
export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));

  app.get("/", (_req, res) => {
    res.send("FixFlow API is running. Check /health for status.");
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

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
