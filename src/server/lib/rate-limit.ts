import "server-only";
import { sql } from "drizzle-orm";
import { asSystem } from "@/server/db/client";

/**
 * Durable fixed-window rate limiter stored in Postgres, so limits hold across
 * multiple server instances and restarts. Returns true when the call is allowed.
 */
export async function checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const windowStart = new Date(Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000);
  const result = await asSystem((tx) =>
    tx.execute<{ count: number }>(sql`
      insert into wf.rate_limits (key, window_start, count) values (${key}, ${windowStart.toISOString()}, 1)
      on conflict (key) do update set
        count = case when wf.rate_limits.window_start = excluded.window_start then wf.rate_limits.count + 1 else 1 end,
        window_start = excluded.window_start
      returning count`),
  );
  return Number(result.rows[0]?.count ?? 0) <= limit;
}
