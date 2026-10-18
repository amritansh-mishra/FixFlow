import express from "express";
import { isProduction } from "./config/env.js";
import { docsRouter } from "./docs/docs.routes.js";
import { cors } from "./middleware/cors.js";
import { openApiDocument } from "./docs/openapi.js";
import { yoga } from "./graphql/server.js";
import { pool } from "./db/index.js";
import { errorHandler, notFoundHandler } from "./middleware/errors.js";
import { attachmentsRouter } from "./modules/attachments/attachments.routes.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { notificationsRouter } from "./modules/notifications/notifications.routes.js";
import { organizationRouter } from "./modules/organization/organization.routes.js";
import { propertiesRouter } from "./modules/properties/properties.routes.js";
import { statsRouter } from "./modules/stats/stats.routes.js";
import { ticketsRouter } from "./modules/tickets/tickets.routes.js";
import { usersRouter } from "./modules/users/users.routes.js";

// Builds the Express app without starting a listener, so tests can import it.
export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  // In production the app runs behind the host's proxy (Render). Trust one
  // proxy hop so req.ip is the real client address; otherwise every user
  // would share the proxy's IP and its login rate limit.
  if (isProduction) app.set("trust proxy", 1);
  app.use(cors);
  app.use(express.json({ limit: "100kb" }));

  // A short index for anyone opening the API in a browser.
  app.get("/", (_req, res) => {
    res.json({
      name: "FixFlow API",
      description: "Multi-tenant maintenance and work-order management",
      docs: "/docs",
      source: "https://github.com/amritansh-mishra/FixFlow",
      health: "/health",
      // Listed from the OpenAPI document, so this can't drift from the docs.
      endpoints: Object.entries(openApiDocument.paths).flatMap(([path, ops]) =>
        Object.keys(ops).map((method) => `${method.toUpperCase()} ${path}`),
      ),
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

  app.use(docsRouter);
  // GraphQL: one endpoint, same login and the same rules as the REST API.
  app.use(yoga.graphqlEndpoint, (req, res) => void yoga(req, res, { req, res }));
  app.use("/api/auth", authRouter);
  app.use("/api/notifications", notificationsRouter);
  app.use("/api/organization", organizationRouter);
  app.use("/api/properties", propertiesRouter);
  app.use("/api/stats", statsRouter);
  app.use("/api/tickets/:id/attachments", attachmentsRouter);
  app.use("/api/tickets", ticketsRouter);
  app.use("/api/users", usersRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
