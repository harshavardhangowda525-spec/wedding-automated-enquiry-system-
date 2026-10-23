import "server-only";
import { and, asc, count, eq, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { actionsSchema, conditionsSchema, type AutomationAction } from "@/lib/automation-schema";
import { CLOSED_STATUSES, LEAD_STATUSES, type AutomationTrigger } from "@/lib/domain";
import { parseStudioSettings } from "@/lib/studio-settings";
import { addBusinessDays, addDaysToDateString, dateInTz, nextBusinessMoment, zonedInstant } from "@/lib/time";
import type { ServiceContext } from "@/server/auth/context";
import { asSystem, withStudio } from "@/server/db/client";
import {
  automationRules,
  automationRuns,
  calendarEntries,
  leads,
  messageTemplates,
  messages,
  notifications,
  quotations,
  studioMembers,
  studios,
  tasks,
} from "@/server/db/schema";
import { emitEvent, enqueueJob, PermanentJobError, type Job } from "@/server/jobs/queue";
import { draftReply } from "@/server/ai/service";
import { AiUnavailableError } from "@/server/ai/provider";
import { createDraftFromTemplate, queueAutomatedMessage } from "@/server/messaging/service";
import { renderTemplate, templateVars } from "@/server/messaging/templates";
import { audit, recordActivity } from "@/server/services/activity";
import { assignLead, setTags } from "@/server/services/leads";
import { createTask } from "@/server/services/tasks";
import { firstFailingCondition } from "./conditions";

/** Events produced by automations may trigger further automations only this many hops deep. */
export const MAX_AUTOMATION_DEPTH = 2;

type DispatchPayload = { trigger: AutomationTrigger; leadId?: string | null; key: string; data?: Record<string, unknown>; depth?: number };

// ---------------------------------------------------------------- dispatch

/** Turns one event into scheduled runs for every enabled matching rule (idempotent per rule+event). */
export async function dispatchEvent(job: Job, now = new Date()) {
  const payload = job.payload as DispatchPayload;
  if (!job.studioId) throw new PermanentJobError("Event has no studio");
  const depth = payload.depth ?? 0;
  if (depth > MAX_AUTOMATION_DEPTH) {
    console.warn(`[automation] dropping ${payload.trigger} at depth ${depth} (loop protection)`);
    return { scheduled: 0 };
  }
  return asSystem(async (tx) => {
    const [studio] = await tx.select().from(studios).where(eq(studios.id, job.studioId!));
    if (!studio) return { scheduled: 0 };
    const settings = parseStudioSettings(studio.settings);
    const rules = await tx
      .select()
      .from(automationRules)
      .where(and(eq(automationRules.studioId, studio.id), eq(automationRules.trigger, payload.trigger), eq(automationRules.enabled, true)));
    let scheduled = 0;
    for (const rule of rules) {
      let at = new Date(now.getTime() + rule.delayMinutes * 60_000);
      if (rule.delayBusinessDays > 0) at = addBusinessDays(at, rule.delayBusinessDays, studio.timezone, settings.businessHours);
      if (rule.respectBusinessHours) at = nextBusinessMoment(at, studio.timezone, settings.businessHours);
      const [run] = await tx
        .insert(automationRuns)
        .values({
          studioId: studio.id,
          ruleId: rule.id,
          leadId: payload.leadId ?? null,
          triggerKey: payload.key,
          status: "scheduled",
          dryRun: rule.dryRun,
          depth,
          scheduledFor: at,
          result: [],
        })
        .onConflictDoNothing({ target: [automationRuns.ruleId, automationRuns.triggerKey] })
        .returning({ id: automationRuns.id });
      if (!run) continue; // already scheduled for this event
      await enqueueJob(tx, {
        type: "automation.execute",
        studioId: studio.id,
        payload: { runId: run.id, data: payload.data ?? {} },
        runAt: at,
        idempotencyKey: `run:${run.id}`,
        maxAttempts: rule.maxAttempts,
      });
      scheduled++;
    }
    return { scheduled };
  });
}

// ---------------------------------------------------------------- execution

type ActionResult = { action: AutomationAction["type"]; outcome: "done" | "skipped" | "planned"; detail: string };

/** Executes a scheduled run. Re-checks everything at execution time; safe to retry. */
export async function executeRun(job: Job, now = new Date()) {
  const { runId, data } = job.payload as { runId: string; data?: Record<string, string> };
  const claim = await asSystem(async (tx) => {
    const locked = await tx.execute<{ id: string }>(sql`select id from wf.automation_runs where id = ${runId} for update`);
    if (!locked.rows.length) return null;
    const [run] = await tx.select().from(automationRuns).where(eq(automationRuns.id, runId));
    if (run.status !== "scheduled" && run.status !== "running" && run.status !== "failed") return null;
    await tx
      .update(automationRuns)
      .set({ status: "running", startedAt: run.startedAt ?? now, attempts: run.attempts + 1 })
      .where(eq(automationRuns.id, runId));
    return run;
  });
  if (!claim) return { status: "noop" as const };

  const finish = (status: "completed" | "dry_run" | "skipped" | "failed", fields: { result?: ActionResult[]; skipReason?: string; error?: string }) =>
    asSystem((tx) =>
      tx
        .update(automationRuns)
        .set({ status, finishedAt: new Date(), result: fields.result ?? [], skipReason: fields.skipReason ?? null, error: fields.error ?? null })
        .where(eq(automationRuns.id, runId)),
    );

  try {
    const outcome = await withStudio(claim.studioId, async (tx) => {
      const [studio] = await tx.select().from(studios).where(eq(studios.id, claim.studioId));
      const [rule] = await tx.select().from(automationRules).where(eq(automationRules.id, claim.ruleId));
      if (!rule || !rule.enabled) return { status: "skipped" as const, skipReason: "Rule was disabled or deleted" };
      if (studio.automationPaused) return { status: "skipped" as const, skipReason: "Automation is paused for this studio" };
      const conditions = conditionsSchema.parse(rule.conditions);
      const actions = actionsSchema.parse(rule.actions);
      let lead: typeof leads.$inferSelect | undefined;
      if (claim.leadId) {
        [lead] = await tx.select().from(leads).where(eq(leads.id, claim.leadId));
        if (!lead) return { status: "skipped" as const, skipReason: "Lead no longer exists" };
        const failing = firstFailingCondition(conditions, lead, now, studio.timezone);
        if (failing) return { status: "skipped" as const, skipReason: `Condition no longer met: ${failing}` };
      }
      const vars = lead ? templateVars(lead, studio, data ?? {}) : { studio_name: studio.name, ...(data ?? {}) };
      if (rule.dryRun || claim.dryRun) {
        return { status: "dry_run" as const, result: actions.map((a) => ({ action: a.type, outcome: "planned" as const, detail: describeAction(a, vars) })) };
      }
      const svc: ServiceContext = { tx, studioId: studio.id, userId: null, role: "system", actorType: "automation" };
      const results: ActionResult[] = [];
      for (const action of actions) results.push(await performAction(svc, action, lead, studio, vars, claim.id, claim.depth, now));
      if (lead) {
        await recordActivity(svc, {
          leadId: lead.id,
          type: "automation_ran",
          summary: `Automation "${rule.name}": ${results.map((r) => `${r.detail}${r.outcome === "skipped" ? " (skipped)" : ""}`).join("; ")}`,
          data: { runId: claim.id, ruleId: rule.id },
          touchLead: false,
        });
      }
      return { status: "completed" as const, result: results };
    });
    await finish(outcome.status, outcome);
    return outcome;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const lastAttempt = job.attempts >= job.maxAttempts || err instanceof PermanentJobError;
    // Leave as "failed" (retryable) – the job queue retries with backoff until max attempts.
    await finish("failed", { error: `${message}${lastAttempt ? "" : " (will retry)"}` });
    throw err;
  }
}

function describeAction(a: AutomationAction, vars: Record<string, string>): string {
  switch (a.type) {
    case "create_task":
      return `Create task "${renderTemplate(a.title, vars)}"`;
    case "assign_lead":
      return a.strategy === "round_robin" ? "Assign lead (round robin)" : "Assign lead to selected member";
    case "notify_staff":
      return `Notify staff: ${renderTemplate(a.title, vars)}`;
    case "queue_email":
      return `Prepare email from template${a.requireApproval ? " for approval" : " and queue it"}`;
    case "queue_whatsapp_template":
      return `Prepare WhatsApp template${a.requireApproval ? " for approval" : " and queue it"}`;
    case "create_ai_reply_draft":
      return `Prepare ${a.purpose.replace("_", "-")} draft for approval`;
    case "add_tag":
      return `Add tag "${a.tag}"`;
    case "record_activity":
      return `Record: ${renderTemplate(a.summary, vars)}`;
    case "update_field":
      return `Set ${a.field.replace("_", " ")} to "${a.value}"`;
  }
}

async function performAction(
  svc: ServiceContext,
  action: AutomationAction,
  lead: typeof leads.$inferSelect | undefined,
  studio: typeof studios.$inferSelect,
  vars: Record<string, string>,
  runId: string,
  depth: number,
  now: Date,
): Promise<ActionResult> {
  const tx = svc.tx;
  const detail = describeAction(action, vars);
  const skip = (why: string): ActionResult => ({ action: action.type, outcome: "skipped", detail: `${detail} – ${why}` });
  const done = (extra?: string): ActionResult => ({ action: action.type, outcome: "done", detail: extra ? `${detail} – ${extra}` : detail });

  switch (action.type) {
    case "create_task": {
      const title = renderTemplate(action.title, vars);
      if (lead) {
        const [open] = await tx
          .select({ n: count() })
          .from(tasks)
          .where(and(eq(tasks.leadId, lead.id), eq(tasks.status, "open"), eq(tasks.title, title)));
        if (Number(open.n) > 0) return skip("an identical open task already exists");
      }
      await createTask(
        svc,
        {
          title,
          description: action.description ? renderTemplate(action.description, vars) : undefined,
          type: action.taskType,
          dueAt: new Date(now.getTime() + action.dueInHours * 3600_000),
          leadId: lead?.id,
          assignedTo: lead?.assignedTo ?? undefined,
        },
        { automationRunId: runId },
      );
      return done();
    }
    case "assign_lead": {
      if (!lead) return skip("no lead");
      if (lead.assignedTo) return skip("already assigned");
      let userId = action.strategy === "specific" ? action.userId : undefined;
      if (action.strategy === "round_robin") {
        const candidates = await tx
          .select({ userId: studioMembers.userId, open: sql<number>`(select count(*) from wf.leads l where l.assigned_to = ${studioMembers.userId} and l.studio_id = ${studio.id} and l.status not in ('booking_confirmed','won','lost','not_interested'))` })
          .from(studioMembers)
          .where(and(eq(studioMembers.studioId, studio.id), inArray(studioMembers.role, ["owner", "admin", "staff"])))
          .orderBy(asc(sql`2`), asc(studioMembers.createdAt));
        userId = candidates[0]?.userId;
      }
      if (!userId) return skip("no eligible team member");
      await assignLead(svc, lead.id, userId);
      return done();
    }
    case "notify_staff": {
      await tx.insert(notifications).values({
        studioId: studio.id,
        userId: lead?.assignedTo ?? null,
        leadId: lead?.id ?? null,
        title: renderTemplate(action.title, vars).slice(0, 200),
        body: action.body ? renderTemplate(action.body, vars).slice(0, 1000) : null,
      });
      return done();
    }
    case "queue_email":
    case "queue_whatsapp_template": {
      if (!lead) return skip("no lead");
      if (lead.optedOut) return skip("client opted out");
      if (!lead.consentContact) return skip("no consent recorded");
      const [tpl] = await tx.select().from(messageTemplates).where(and(eq(messageTemplates.id, action.templateId), eq(messageTemplates.studioId, studio.id)));
      if (!tpl || !tpl.active) return skip("template missing or inactive");
      const channel = action.type === "queue_email" ? "email" : "whatsapp";
      if (tpl.channel !== channel) return skip("template channel mismatch");
      if (channel === "email" && !lead.email) return skip("client has no email");
      if (channel === "whatsapp" && !tpl.whatsappTemplateName) return skip("WhatsApp template name not set");
      const msg = await createDraftFromTemplate(svc, lead.id, tpl.id, { automationRunId: runId, status: "awaiting_approval" });
      if (!action.requireApproval && tpl.approved) {
        await queueAutomatedMessage(tx, studio.id, msg.id);
        return done("queued (pre-approved template)");
      }
      return done("awaiting approval");
    }
    case "create_ai_reply_draft": {
      if (!lead) return skip("no lead");
      if (lead.optedOut) return skip("client opted out");
      if (CLOSED_STATUSES.includes(lead.status)) return skip("lead is closed");
      const [pending] = await tx
        .select({ n: count() })
        .from(messages)
        .where(
          and(
            eq(messages.leadId, lead.id),
            eq(messages.purpose, action.purpose),
            // An acknowledgement already sent (e.g. the chatbot's automatic WhatsApp confirmation) is not repeated.
            inArray(messages.status, action.purpose === "acknowledgement" ? ["draft", "awaiting_approval", "queued", "sending", "sent", "delivered"] : ["draft", "awaiting_approval", "queued"]),
          ),
        );
      if (Number(pending.n) > 0) return skip(action.purpose === "acknowledgement" ? "an acknowledgement is already waiting or was sent" : "a draft for this purpose is already waiting");
      const channel = action.channel === "auto" ? (lead.preferredChannel === "email" && lead.email ? "email" : "whatsapp") : action.channel;
      if (channel === "email" && !lead.email) return skip("client has no email");
      try {
        await draftReply(svc, lead.id, { purpose: action.purpose, channel, automationRunId: runId });
        return done("AI draft awaiting approval");
      } catch (err) {
        if (!(err instanceof AiUnavailableError)) throw err;
        // Graceful fallback: the studio's own template, still requiring approval.
        const [tpl] = await tx
          .select()
          .from(messageTemplates)
          .where(and(eq(messageTemplates.studioId, studio.id), eq(messageTemplates.channel, channel), eq(messageTemplates.purpose, action.purpose), eq(messageTemplates.active, true)))
          .limit(1);
        if (!tpl) return skip(`AI unavailable (${err.reason}) and no ${channel} template for this purpose`);
        await createDraftFromTemplate(svc, lead.id, tpl.id, { automationRunId: runId, status: "awaiting_approval", reviewNotes: `AI unavailable (${err.reason}); prepared from your template.` });
        return done("template draft awaiting approval (AI unavailable)");
      }
    }
    case "add_tag": {
      if (!lead) return skip("no lead");
      if (lead.tags.includes(action.tag.toLowerCase())) return skip("tag already present");
      await setTags(svc, lead.id, [...lead.tags, action.tag]);
      return done();
    }
    case "record_activity": {
      await recordActivity(svc, { leadId: lead?.id, type: "automation_note", summary: renderTemplate(action.summary, vars), touchLead: false });
      return done();
    }
    case "update_field": {
      if (!lead) return skip("no lead");
      if (action.field === "priority") {
        if (!["low", "medium", "high"].includes(action.value)) return skip("invalid priority");
        await tx.update(leads).set({ priority: action.value as "low", priorityReason: "Set by automation", updatedAt: new Date() }).where(eq(leads.id, lead.id));
      } else {
        await tx.update(leads).set({ nextAction: action.value, updatedAt: new Date() }).where(eq(leads.id, lead.id));
      }
      await recordActivity(svc, { leadId: lead.id, type: "lead_updated", summary: `Automation set ${action.field.replace("_", " ")} to "${action.value}"`, data: { depth } });
      return done();
    }
  }
}

// ---------------------------------------------------------------- periodic sweep

export const SWEEP_INTERVAL_MS = 5 * 60_000;

/** Ensures one sweep job exists for the current 5-minute bucket (idempotent). */
export async function ensureSweepScheduled(now = new Date()) {
  const bucket = Math.floor(now.getTime() / SWEEP_INTERVAL_MS);
  await asSystem((tx) => enqueueJob(tx, { type: "automation.sweep", payload: { bucket }, idempotencyKey: `sweep:${bucket}`, maxAttempts: 3 }));
}

/** Emits time-based events (due follow-ups, approaching dates, inactivity) and expires quotations. */
export async function runSweep(now = new Date()) {
  const counts = { followUpDue: 0, consultations: 0, quotationsAwaiting: 0, quotationsExpired: 0, eventsApproaching: 0, inactive: 0, retentionDeleted: 0 };
  const activeStudios = await asSystem((tx) => tx.select().from(studios).where(eq(studios.status, "active")));
  for (const studio of activeStudios) {
    const settings = parseStudioSettings(studio.settings);
    const today = dateInTz(now, studio.timezone);
    await withStudio(studio.id, async (tx) => {
      // Follow-up tasks that became due.
      const due = await tx
        .select({ id: tasks.id, leadId: tasks.leadId, title: tasks.title })
        .from(tasks)
        .where(and(eq(tasks.studioId, studio.id), eq(tasks.status, "open"), inArray(tasks.type, ["follow_up", "call"]), lte(tasks.dueAt, now), isNull(tasks.dueNotifiedAt)))
        .limit(500);
      for (const t of due) {
        await tx.update(tasks).set({ dueNotifiedAt: now }).where(eq(tasks.id, t.id));
        await emitEvent(tx, studio.id, { trigger: "follow_up_due", leadId: t.leadId, key: `follow_up_due:${t.id}`, data: { task_title: t.title } });
        counts.followUpDue++;
      }

      // Consultations starting within the reminder window.
      const horizon = addDaysToDateString(today, Math.ceil(settings.followUp.consultationReminderHours / 24) + 1);
      const consults = await tx
        .select()
        .from(calendarEntries)
        .where(
          and(
            eq(calendarEntries.studioId, studio.id),
            eq(calendarEntries.type, "consultation"),
            isNull(calendarEntries.reminderSentAt),
            sql`${calendarEntries.entryDate} between ${today} and ${horizon}`,
          ),
        );
      for (const c of consults) {
        const start = zonedInstant(c.entryDate, (c.startTime ?? "10:00").slice(0, 5), studio.timezone);
        const msUntil = start.getTime() - now.getTime();
        if (msUntil < 0 || msUntil > settings.followUp.consultationReminderHours * 3600_000) continue;
        await tx.update(calendarEntries).set({ reminderSentAt: now }).where(eq(calendarEntries.id, c.id));
        await emitEvent(tx, studio.id, { trigger: "consultation_approaching", leadId: c.leadId, key: `consultation:${c.id}`, data: { entry_title: c.title, entry_date: c.entryDate } });
        counts.consultations++;
      }

      // Sent quotations with no response.
      const awaiting = await tx
        .select()
        .from(quotations)
        .where(
          and(
            eq(quotations.studioId, studio.id),
            eq(quotations.status, "sent"),
            isNull(quotations.awaitingNotifiedAt),
            lt(quotations.sentAt, new Date(now.getTime() - settings.followUp.quotationAwaitingDays * 86_400_000)),
          ),
        );
      for (const q of awaiting) {
        await tx.update(quotations).set({ awaitingNotifiedAt: now }).where(eq(quotations.id, q.id));
        await emitEvent(tx, studio.id, { trigger: "quotation_awaiting_response", leadId: q.leadId, key: `quotation_awaiting:${q.id}`, data: { quotation_number: q.number } });
        counts.quotationsAwaiting++;
      }

      // Expire sent quotations past their validity date.
      const expired = await tx
        .update(quotations)
        .set({ status: "expired", updatedAt: now })
        .where(and(eq(quotations.studioId, studio.id), eq(quotations.status, "sent"), lt(quotations.validUntil, today)))
        .returning({ id: quotations.id, leadId: quotations.leadId, number: quotations.number });
      for (const q of expired) {
        await recordActivity({ tx, studioId: studio.id, userId: null, actorType: "system" }, { leadId: q.leadId, type: "quotation_expired", summary: `Quotation ${q.number} expired`, touchLead: false });
        counts.quotationsExpired++;
      }

      // Event dates approaching.
      const target = addDaysToDateString(today, settings.followUp.eventApproachingDays);
      const approaching = await tx
        .select({ id: leads.id, eventDate: leads.eventDate })
        .from(leads)
        .where(and(eq(leads.studioId, studio.id), sql`${leads.eventDate} between ${today} and ${target}`));
      for (const l of approaching) {
        await emitEvent(tx, studio.id, { trigger: "event_date_approaching", leadId: l.id, key: `event_approaching:${l.id}:${l.eventDate}` });
        counts.eventsApproaching++;
      }

      // Open leads with no activity for the configured period.
      const cutoff = new Date(now.getTime() - settings.followUp.inactiveAfterDays * 86_400_000);
      const openStatuses = LEAD_STATUSES.filter((s) => !CLOSED_STATUSES.includes(s));
      const inactive = await tx
        .select({ id: leads.id, lastActivityAt: leads.lastActivityAt })
        .from(leads)
        .where(and(eq(leads.studioId, studio.id), inArray(leads.status, openStatuses), lt(leads.lastActivityAt, cutoff)))
        .limit(500);
      for (const l of inactive) {
        await emitEvent(tx, studio.id, { trigger: "lead_inactive", leadId: l.id, key: `inactive:${l.id}:${l.lastActivityAt.toISOString()}` });
        counts.inactive++;
      }
    });

    // Data retention: delete closed leads older than the studio's retention period.
    if (studio.dataRetentionDays) {
      const retentionCutoff = new Date(now.getTime() - studio.dataRetentionDays * 86_400_000);
      const deleted = await withStudio(studio.id, async (tx) => {
        const rows = await tx
          .delete(leads)
          .where(and(eq(leads.studioId, studio.id), inArray(leads.status, CLOSED_STATUSES), lt(leads.updatedAt, retentionCutoff)))
          .returning({ id: leads.id });
        if (rows.length) await audit(tx, { studioId: studio.id, actorUserId: null, actorType: "system", action: "retention.leads_deleted", metadata: { count: rows.length, retentionDays: studio.dataRetentionDays } });
        return rows.length;
      });
      counts.retentionDeleted += deleted;
    }
  }
  return counts;
}

