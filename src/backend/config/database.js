import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema/index.js';

const { Pool } = pg;

/**
 * Pool sizing: a 180-student lecture triggers ~9 DB round-trips per scan
 * plus concurrent instructor reads. Default max of 10 saturates quickly.
 * 25 balances throughput vs Neon's per-project connection limit (default
 * 100 across all clients on the free tier).
 *
 * statement_timeout: 15s. A single query that exceeds this either hit a
 * missing index, a lock wait, or an upstream outage — cheaper to let it
 * fail fast and surface the error than to hold the pool connection.
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
  max: Number(process.env.PG_POOL_MAX) || 25,
  idleTimeoutMillis: 30_000,
  statement_timeout: 15_000,
});

export const db = drizzle(pool, { schema });
export { pool };
