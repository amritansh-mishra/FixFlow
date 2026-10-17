import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "../config/env.js";
import * as schema from "./schema.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle PostgreSQL client", err);
});

// Typed query builder. Shares the pool above, so both use the same connections.
export const db = drizzle(pool, { schema });

// Always pass user input through `params`, never by building the SQL string.
export const query = <R extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
) => {
  return pool.query<R>(text, params);
};
