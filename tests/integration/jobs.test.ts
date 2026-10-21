import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asSystem } from "@/server/db/client";
import { jobs } from "@/server/db/schema";
import { backoffMs, claimJobs, enqueueJob, PermanentJobError, runDueJobs } from "@/server/jobs/queue";

async function getJob(id: string) {
  const [j] = await asSystem((tx) => tx.select().from(jobs).where(eq(jobs.id, id)));
  return j;
}

describe("durable job queue", () => {
  it("deduplicates jobs by idempotency key", async () => {
    const key = `test-dedupe-${Date.now()}`;
    const a = await asSystem((tx) => enqueueJob(tx, { type: "test.noop", idempotencyKey: key }));
    const b = await asSystem((tx) => enqueueJob(tx, { type: "test.noop", idempotencyKey: key }));
    expect(a).toBeTruthy();
    expect(b).toBeNull();
    await asSystem((tx) => tx.update(jobs).set({ status: "cancelled" }).where(eq(jobs.id, a!)));
  });

  it("retries failures with exponential backoff and marks the job dead after max attempts", async () => {
    const id = (await asSystem((tx) => enqueueJob(tx, { type: "test.flaky", maxAttempts: 2, payload: { n: 1 } })))!;
    let calls = 0;
    const handlers = { "test.flaky": async () => { calls++; throw new Error("boom"); } };
    await runDueJobs(handlers, { workerId: "t", limit: 50 });
    let job = await getJob(id);
    expect(job.status).toBe("pending");
    expect(job.attempts).toBe(1);
    expect(job.lastError).toBe("boom");
    expect(job.runAt.getTime()).toBeGreaterThan(Date.now() + 20_000); // backed off
    await asSystem((tx) => tx.execute(sql`update wf.jobs set run_at = now() where id = ${id}`));
    await runDueJobs(handlers, { workerId: "t", limit: 50 });
    job = await getJob(id);
    expect(job.status).toBe("dead");
    expect(job.attempts).toBe(2);
    expect(calls).toBe(2);
  });

  it("does not retry permanent errors", async () => {
    const id = (await asSystem((tx) => enqueueJob(tx, { type: "test.permanent", maxAttempts: 5 })))!;
    await runDueJobs({ "test.permanent": async () => { throw new PermanentJobError("bad input"); } }, { workerId: "t" });
    expect((await getJob(id)).status).toBe("dead");
  });

  it("backoff grows exponentially and is capped", () => {
    expect(backoffMs(1)).toBeGreaterThanOrEqual(30_000);
    expect(backoffMs(3)).toBeGreaterThanOrEqual(120_000);
    expect(backoffMs(20)).toBeLessThanOrEqual(60 * 60 * 1000 * 1.2);
  });

  it("never hands the same job to two concurrent workers", async () => {
    const ids = [];
    for (let i = 0; i < 10; i++) ids.push(await asSystem((tx) => enqueueJob(tx, { type: "test.concurrent" })));
    const [a, b] = await Promise.all([claimJobs("w1", 10), claimJobs("w2", 10)]);
    const claimed = [...a, ...b].filter((j) => j.type === "test.concurrent").map((j) => j.id);
    expect(new Set(claimed).size).toBe(claimed.length);
    expect(claimed.length).toBe(10);
    await asSystem((tx) => tx.execute(sql`update wf.jobs set status = 'completed' where type = 'test.concurrent'`));
  });

  it("recovers jobs whose worker crashed (stale lock)", async () => {
    const id = (await asSystem((tx) => enqueueJob(tx, { type: "test.stale" })))!;
    await asSystem((tx) => tx.execute(sql`update wf.jobs set status = 'running', locked_at = now() - interval '30 minutes', locked_by = 'dead-worker' where id = ${id}`));
    const ran: string[] = [];
    await runDueJobs({ "test.stale": async (j) => { ran.push(j.id); } }, { workerId: "t" });
    expect(ran).toContain(id);
    expect((await getJob(id)).status).toBe("completed");
  });
});
