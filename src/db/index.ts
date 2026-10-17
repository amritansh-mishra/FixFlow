import pg from "pg";
import { env } from "../config/env.js";

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

// Always pass user input through `params`, never by building the SQL string.
export const query = <R extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
) => {
  return pool.query<R>(text, params);
};
