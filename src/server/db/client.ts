import "server-only";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/server/env";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Anything that can run queries: the root database or a transaction. */
export type Queryable = Database | Tx;

const globalForDb = globalThis as unknown as { __wfPool?: Pool; __wfDb?: Database };

function createPool() {
  return new Pool({
    connectionString: env().DATABASE_URL,
    max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

export function getDb(): Database {
  if (!globalForDb.__wfDb) {
    globalForDb.__wfPool = createPool();
    globalForDb.__wfPool.on("error", (err) => console.error("[db] idle client error", err));
    globalForDb.__wfDb = drizzle(globalForDb.__wfPool, { schema });
  }
  return globalForDb.__wfDb;
}

export async function closeDb() {
  await globalForDb.__wfPool?.end();
  globalForDb.__wfPool = undefined;
  globalForDb.__wfDb = undefined;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Run `fn` inside a transaction scoped to one studio. The transaction switches to the
 * restricted `wf_app` role, so PostgreSQL row-level security rejects any row that
 * belongs to another studio, even if application code forgets a filter.
 */
export async function withStudio<T>(studioId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID_RE.test(studioId)) throw new Error("Invalid studio id");
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.studio_id', ${studioId}, true)`);
    await tx.execute(sql`set local role wf_app`);
    return fn(tx);
  });
}

/**
 * Run `fn` with the owning role (no RLS). Only for trusted server code paths that
 * must work across studios: background jobs, webhooks, public enquiry intake,
 * authentication bootstrap and platform administration. Callers must filter by
 * studio_id themselves.
 */
export async function asSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return getDb().transaction(fn);
}
