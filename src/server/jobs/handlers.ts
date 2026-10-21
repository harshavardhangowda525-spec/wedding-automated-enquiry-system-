import "server-only";
import { dispatchEvent, ensureSweepScheduled, executeRun, runSweep } from "@/server/automation/engine";
import { markMessageFailedAfterRetries, processSendJob } from "@/server/messaging/service";
import { PermanentJobError, runDueJobs, type JobHandler } from "./queue";

export const jobHandlers: Record<string, JobHandler> = {
  "automation.dispatch": async (job) => {
    await dispatchEvent(job);
  },
  "automation.execute": async (job) => {
    await executeRun(job);
  },
  "automation.sweep": async () => {
    await runSweep();
  },
  "message.send": async (job) => {
    const { messageId } = job.payload as { messageId: string };
    try {
      await processSendJob(messageId);
    } catch (err) {
      if (!(err instanceof PermanentJobError) && job.attempts >= job.maxAttempts) {
        await markMessageFailedAfterRetries(messageId, err instanceof Error ? err.message : String(err));
      }
      throw err;
    }
  },
};

/** One scheduler tick: make sure the periodic sweep exists, then run due jobs. */
export async function tick(workerId: string, limit = 25) {
  await ensureSweepScheduled();
  return runDueJobs(jobHandlers, { workerId, limit });
}
