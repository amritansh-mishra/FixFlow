
import "dotenv/config";
import express from "express";
import { pool } from "./db/index.js";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Parse incoming JSON request bodies
app.use(express.json());

// Root route
app.get("/", (_req, res) => {
  res.send("FixFlow API is running. Check /health for status.");
});

// Health-check endpoint (includes database connectivity check)
app.get("/health", async (_req, res) => {
  try {
    const dbResult = await pool.query("SELECT NOW() as current_time, current_database()");
    res.status(200).json({
      status: "ok",
      message: "FixFlow API is running",
      database: {
        connected: true,
        database: dbResult.rows[0]?.current_database,
        serverTime: dbResult.rows[0]?.current_time,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      status: "degraded",
      message: "FixFlow API is running, but database connection failed",
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    });
  }
});

// Start the server
app.listen(PORT, async () => {
  console.log(`FixFlow API running at http://localhost:${PORT}`);
  try {
    const check = await pool.query("SELECT NOW()");
    console.log("Successfully connected to PostgreSQL at:", check.rows[0]?.now);
  } catch (err) {
    console.error("PostgreSQL connection error on startup:", err);
  }
});
