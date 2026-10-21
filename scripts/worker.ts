/**
 * Durable background worker. Run alongside the web server:
 *   pnpm worker
 * Jobs live in PostgreSQL, so restarts lose nothing; several workers can run safely
 * (jobs are claimed with FOR UPDATE SKIP LOCKED).
 */
import "dotenv/config";
import { hostname } from "node:os";
import { closeDb } from "@/server/db/client";
import { tick } from "@/server/jobs/handlers";

const workerId = `${hostname()}:${process.pid}`;
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 2000);
let stopping = false;

async function loop() {
  console.log(`[worker] ${workerId} started (poll ${POLL_MS}ms)`);
  while (!stopping) {
    try {
      const { processed, failed } = await tick(workerId);
      if (processed) console.log(`[worker] processed ${processed} job(s), ${failed} failed`);
      if (processed === 0) await new Promise((r) => setTimeout(r, POLL_MS));
    } catch (err) {
      console.error("[worker] tick failed:", err);
      await new Promise((r) => setTimeout(r, POLL_MS * 2));
    }
  }
  await closeDb();
  console.log("[worker] stopped");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

loop().catch((err) => {
  console.error(err);
  process.exit(1);
});
