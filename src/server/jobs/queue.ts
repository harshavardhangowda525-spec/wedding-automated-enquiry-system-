import "server-only";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type { AutomationTrigger } from "@/lib/domain";
import { asSystem, type Queryable } from "@/server/db/client";
import { jobs } from "@/server/db/schema";

export type Job = typeof jobs.$inferSelect;

export type EnqueueInput = {
  type: string;
  payload?: Record<string, unknown>;
  studioId?: string | null;
  runAt?: Date;
  /** Jobs with the same key are only ever created once (duplicate protection). */
  idempotencyKey?: string;
  maxAttempts?: number;
};

/**
 * Inserts a job in the caller's transaction (transactional outbox): if the business
 * change rolls back, the job disappears with it; if it commits, the job is durable.
 * Returns the job id, or null when an identical idempotency key already exists.
 */
export async function enqueueJob(q: Queryable, input: EnqueueInput): Promise<string | null> {
  const [row] = await q
    .insert(jobs)
    .values({
      type: input.type,
      payload: input.payload ?? {},
      studioId: input.studioId ?? null,
      runAt: input.runAt ?? new Date(),
      idempotencyKey: input.idempotencyKey ?? null,
      maxAttempts: input.maxAttempts ?? 5,
    })
    .onConflictDoNothing({ target: jobs.idempotencyKey })
    .returning({ id: jobs.id });
  return row?.id ?? null;
}

export type AutomationEvent = {
  trigger: AutomationTrigger;
  leadId?: string | null;
  /** Unique key for this occurrence, e.g. `lead_created:<leadId>`. Makes the event idempotent. */
  key: string;
  data?: Record<string, unknown>;
  /** How many automation hops produced this event (loop protection). */
  depth?: number;
};

export async function emitEvent(q: Queryable, studioId: string, event: AutomationEvent): Promise<void> {
  await enqueueJob(q, {
    type: "automation.dispatch",
    studioId,
    payload: { ...event, depth: event.depth ?? 0 },
    idempotencyKey: `evt:${studioId}:${event.key}`,
  });
}

export function backoffMs(attempt: number): number {
  const base = 30_000 * 2 ** Math.max(0, attempt - 1);
  const capped = Math.min(base, 60 * 60 * 1000);
  return Math.round(capped * (1 + Math.random() * 0.2));
}

const STALE_LOCK_MINUTES = 10;

/** Claims due jobs atomically. Concurrent workers never receive the same job. */
export async function claimJobs(workerId: string, limit: number): Promise<Job[]> {
  return asSystem(async (tx) => {
    // Recover jobs whose worker died mid-run.
    await tx
      .update(jobs)
      .set({ status: "pending", lockedAt: null, lockedBy: null, updatedAt: new Date() })
      .where(and(eq(jobs.status, "running"), lt(jobs.lockedAt, new Date(Date.now() - STALE_LOCK_MINUTES * 60_000))));

    const result = await tx.execute<{ id: string }>(sql`
      update wf.jobs set status = 'running', locked_at = now(), locked_by = ${workerId},
        attempts = attempts + 1, updated_at = now()
      where id in (
        select id from wf.jobs where status = 'pending' and run_at <= now()
        order by run_at limit ${limit} for update skip locked
      )
      returning id`);
    const ids = result.rows.map((r) => r.id);
    if (ids.length === 0) return [];
    return tx.select().from(jobs).where(inArray(jobs.id, ids));
  });
}

export async function completeJob(id: string): Promise<void> {
  await asSystem((tx) =>
    tx
      .update(jobs)
      .set({ status: "completed", completedAt: new Date(), lockedAt: null, lockedBy: null, lastError: null, updatedAt: new Date() })
      .where(eq(jobs.id, id)),
  );
}

/** Records a failure; retries with exponential backoff until max attempts, then marks the job dead. */
export async function failJob(job: Job, error: unknown, opts: { retryable?: boolean } = {}): Promise<"retry" | "dead"> {
  const message = error instanceof Error ? error.message : String(error);
  const retryable = opts.retryable !== false && job.attempts < job.maxAttempts;
  await asSystem((tx) =>
    tx
      .update(jobs)
      .set({
        status: retryable ? "pending" : "dead",
        runAt: retryable ? new Date(Date.now() + backoffMs(job.attempts)) : job.runAt,
        lastError: message.slice(0, 2000),
        lockedAt: null,
        lockedBy: null,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, job.id)),
  );
  return retryable ? "retry" : "dead";
}

/** Errors that should never be retried (bad input, permanent provider rejection). */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}

export type JobHandler = (job: Job) => Promise<void>;

export async function runDueJobs(
  handlers: Record<string, JobHandler>,
  opts: { workerId: string; limit?: number },
): Promise<{ processed: number; failed: number }> {
  const claimed = await claimJobs(opts.workerId, opts.limit ?? 20);
  let failed = 0;
  for (const job of claimed) {
    const handler = handlers[job.type];
    try {
      if (!handler) throw new PermanentJobError(`No handler registered for job type "${job.type}"`);
      await handler(job);
      await completeJob(job.id);
    } catch (err) {
      failed++;
      const outcome = await failJob(job, err, { retryable: !(err instanceof PermanentJobError) });
      console.error(`[jobs] ${job.type} ${job.id} failed (attempt ${job.attempts}/${job.maxAttempts}, ${outcome}):`, err instanceof Error ? err.message : err);
    }
  }
  return { processed: claimed.length, failed };
}

/** Retry a dead/failed job (platform admin action). */
export async function retryJob(id: string): Promise<void> {
  await asSystem((tx) =>
    tx
      .update(jobs)
      .set({ status: "pending", runAt: new Date(), attempts: 0, lastError: null, updatedAt: new Date() })
      .where(and(eq(jobs.id, id), inArray(jobs.status, ["dead", "failed", "cancelled"]))),
  );
}
