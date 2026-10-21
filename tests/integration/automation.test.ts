import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asSystem } from "@/server/db/client";
import { automationRules, automationRuns, jobs, leads, messages, notifications, studios, tasks } from "@/server/db/schema";
import { dispatchEvent, executeRun, runSweep } from "@/server/automation/engine";
import { emitEvent, type Job } from "@/server/jobs/queue";
import { submitEnquiry } from "@/server/services/enquiries";
import { logContact } from "@/server/services/leads";
import { createTask } from "@/server/services/tasks";
import { setAiProviderForTests } from "@/server/ai/provider";
import { asMember, createTestStudio, drainJobs, enquiryPayload } from "../helpers";

async function newLead(name = "Auto Studio") {
  const ctx = await createTestStudio(name);
  const res = await submitEnquiry(ctx.studio.slug, enquiryPayload(ctx.studio.id, [ctx.services[0].id]), { ip: `9.9.${Math.floor(Math.random() * 250)}.1` });
  if (!res.ok) throw new Error("enquiry failed");
  const [lead] = await asSystem((tx) => tx.select().from(leads).where(eq(leads.reference, res.reference)));
  return { ...ctx, lead };
}

const runsFor = (studioId: string) => asSystem((tx) => tx.select().from(automationRuns).where(eq(automationRuns.studioId, studioId)));

describe("automation engine", () => {
  it("schedules the default follow-up policy from a new enquiry, with business-day delays", async () => {
    setAiProviderForTests(null); // AI not configured
    const { studio, lead } = await newLead("Policy Studio");
    await drainJobs(); // dispatch + immediate runs only
    const runs = await runsFor(studio.id);
    // 4 default rules listen to lead_created.
    expect(runs).toHaveLength(4);
    const delayed = runs.filter((r) => r.status === "scheduled");
    expect(delayed).toHaveLength(3);
    for (const r of delayed) expect(r.scheduledFor.getTime()).toBeGreaterThan(Date.now() + 12 * 3600_000);

    // Immediate rule ran: staff notified and an acknowledgement draft prepared from the template (AI unavailable).
    const immediate = runs.find((r) => r.status !== "scheduled")!;
    expect(immediate.status).toBe("completed");
    const notes = await asSystem((tx) => tx.select().from(notifications).where(eq(notifications.leadId, lead.id)));
    expect(notes).toHaveLength(1);
    const drafts = await asSystem((tx) => tx.select().from(messages).where(eq(messages.leadId, lead.id)));
    expect(drafts).toHaveLength(1);
    expect(drafts[0].status).toBe("awaiting_approval");
    expect(drafts[0].reviewNotes).toMatch(/AI unavailable/);
    expect(drafts[0].body).toContain(lead.reference);
    setAiProviderForTests(undefined);
  });

  it("is idempotent: the same event never schedules duplicate runs", async () => {
    setAiProviderForTests(null);
    const { studio, lead } = await newLead("Idem Studio");
    await drainJobs();
    // Re-emit the same event key and re-dispatch directly.
    await asSystem((tx) => emitEvent(tx, studio.id, { trigger: "lead_created", leadId: lead.id, key: `lead_created:${lead.id}` }));
    const fakeJob = { studioId: studio.id, payload: { trigger: "lead_created", leadId: lead.id, key: `lead_created:${lead.id}` }, attempts: 1, maxAttempts: 3 } as unknown as Job;
    const again = await dispatchEvent(fakeJob);
    expect(again.scheduled).toBe(0);
    expect(await runsFor(studio.id)).toHaveLength(4);
    setAiProviderForTests(undefined);
  });

  it("re-checks conditions at execution time and skips when the lead was already contacted", async () => {
    setAiProviderForTests(null);
    const { studio, owner, lead } = await newLead("Recheck Studio");
    await drainJobs();
    await asMember(studio.id, owner.id, "owner", (svc) => logContact(svc, lead.id, { channel: "phone", outcome: "reached" }));
    await drainJobs({ includeDelayed: true });
    const runs = await runsFor(studio.id);
    const [taskRule] = await asSystem((tx) =>
      tx.select().from(automationRules).where(and(eq(automationRules.studioId, studio.id), eq(automationRules.name, "Follow-up task after 1 business day"))),
    );
    const taskRun = runs.find((r) => r.ruleId === taskRule.id)!;
    expect(taskRun.status).toBe("skipped");
    expect(taskRun.skipReason).toMatch(/Condition no longer met/);
    const created = await asSystem((tx) => tx.select().from(tasks).where(and(eq(tasks.leadId, lead.id), eq(tasks.title, `Follow up with ${lead.contactName}`))));
    expect(created).toHaveLength(0);
    setAiProviderForTests(undefined);
  });

  it("creates the follow-up task when nobody contacted the client, exactly once", async () => {
    setAiProviderForTests(null);
    const { studio, lead } = await newLead("Task Studio");
    await drainJobs({ includeDelayed: true });
    const created = await asSystem((tx) => tx.select().from(tasks).where(and(eq(tasks.leadId, lead.id), eq(tasks.createdByType, "automation"))));
    const titles = created.map((t) => t.title).sort();
    expect(titles).toEqual([`Final review: decide next step for ${lead.contactName}`, `Follow up with ${lead.contactName}`].sort());
    // Re-running a finished run is a no-op.
    const [run] = (await runsFor(studio.id)).filter((r) => r.status === "completed");
    const job = { payload: { runId: run.id }, attempts: 1, maxAttempts: 3 } as unknown as Job;
    expect((await executeRun(job)).status).toBe("noop");
    setAiProviderForTests(undefined);
  });

  it("honours the studio pause switch and dry-run mode", async () => {
    setAiProviderForTests(null);
    const paused = await newLead("Paused Studio");
    await asSystem((tx) => tx.update(studios).set({ automationPaused: true }).where(eq(studios.id, paused.studio.id)));
    await drainJobs({ includeDelayed: true });
    const pausedRuns = await runsFor(paused.studio.id);
    expect(pausedRuns.every((r) => r.status === "skipped" && /paused/.test(r.skipReason ?? ""))).toBe(true);
    expect(await asSystem((tx) => tx.select().from(tasks).where(eq(tasks.leadId, paused.lead.id)))).toHaveLength(0);

    const dry = await createTestStudio("Dry Studio");
    await asSystem((tx) => tx.update(automationRules).set({ dryRun: true }).where(eq(automationRules.studioId, dry.studio.id)));
    const res = await submitEnquiry(dry.studio.slug, enquiryPayload(dry.studio.id, [dry.services[0].id]), { ip: "8.8.1.1" });
    expect(res.ok).toBe(true);
    await drainJobs({ includeDelayed: true });
    const dryRuns = await runsFor(dry.studio.id);
    expect(dryRuns.length).toBe(4);
    expect(dryRuns.every((r) => r.status === "dry_run" || r.status === "skipped")).toBe(true);
    expect(dryRuns.some((r) => r.status === "dry_run" && (r.result as unknown[]).length > 0)).toBe(true);
    const dryTasks = await asSystem((tx) => tx.select().from(tasks).where(eq(tasks.studioId, dry.studio.id)));
    expect(dryTasks).toHaveLength(0);
    setAiProviderForTests(undefined);
  });

  it("drops events beyond the maximum automation depth (loop protection)", async () => {
    const { studio, lead } = await newLead("Loop Studio");
    const job = { studioId: studio.id, payload: { trigger: "lead_created", leadId: lead.id, key: `loop:${lead.id}`, depth: 5 }, attempts: 1, maxAttempts: 3 } as unknown as Job;
    expect((await dispatchEvent(job)).scheduled).toBe(0);
  });

  it("sweep emits follow-up-due events once per task", async () => {
    setAiProviderForTests(null);
    const { studio, owner, lead } = await newLead("Sweep Studio");
    await drainJobs();
    const task = await asMember(studio.id, owner.id, "owner", (svc) =>
      createTask(svc, { title: "Call the couple", type: "follow_up", dueAt: new Date(Date.now() - 60_000), leadId: lead.id }),
    );
    await runSweep();
    await runSweep();
    const evts = await asSystem((tx) => tx.select().from(jobs).where(eq(jobs.idempotencyKey, `evt:${studio.id}:follow_up_due:${task.id}`)));
    expect(evts).toHaveLength(1);
    await drainJobs();
    const notes = await asSystem((tx) => tx.select().from(notifications).where(eq(notifications.leadId, lead.id)));
    expect(notes.some((n) => n.title.startsWith("Follow-up due"))).toBe(true);
    setAiProviderForTests(undefined);
  });
});
