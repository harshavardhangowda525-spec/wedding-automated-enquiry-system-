import "server-only";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { CurrentUser } from "@/server/auth/context";
import { asSystem } from "@/server/db/client";
import {
  aiUsage,
  auditLogs,
  automationRuns,
  jobs,
  messages,
  studioIntegrations,
  studios,
  supportNotes,
  webhookEvents,
} from "@/server/db/schema";
import { env, isSupabaseConfigured } from "@/server/env";
import { ForbiddenError, NotFoundError } from "@/server/lib/errors";
import { retryJob } from "@/server/jobs/queue";
import { audit } from "./activity";

function assertAdmin(user: CurrentUser) {
  if (!user.isPlatformAdmin) throw new ForbiddenError("Platform administration is restricted");
}

export async function adminOverview(user: CurrentUser) {
  assertAdmin(user);
  return asSystem(async (tx) => {
    const studioRows = await tx.execute<{
      id: string; name: string; slug: string; status: string; is_demo: boolean; automation_paused: boolean; created_at: string;
      members: number; leads: number; leads_30d: number;
    }>(sql`
      select s.id, s.name, s.slug, s.status, s.is_demo, s.automation_paused, s.created_at,
        (select count(*)::int from wf.studio_members m where m.studio_id = s.id) as members,
        (select count(*)::int from wf.leads l where l.studio_id = s.id) as leads,
        (select count(*)::int from wf.leads l where l.studio_id = s.id and l.created_at > now() - interval '30 days') as leads_30d
      from wf.studios s order by s.created_at desc`);
    const since = new Date(Date.now() - 7 * 86_400_000);
    const [jobStats] = (
      await tx.execute<{ pending: number; dead: number; running: number; overdue: number }>(sql`
        select count(*) filter (where status = 'pending')::int as pending,
          count(*) filter (where status = 'dead')::int as dead,
          count(*) filter (where status = 'running')::int as running,
          count(*) filter (where status = 'pending' and run_at < now() - interval '10 minutes')::int as overdue
        from wf.jobs`)
    ).rows;
    const runStats = await tx
      .select({ status: automationRuns.status, n: sql<number>`count(*)::int` })
      .from(automationRuns)
      .where(gte(automationRuns.createdAt, since))
      .groupBy(automationRuns.status);
    const integrations = await tx
      .select({ studioId: studioIntegrations.studioId, provider: studioIntegrations.provider, status: studioIntegrations.status, lastError: studioIntegrations.lastError, lastVerifiedAt: studioIntegrations.lastVerifiedAt })
      .from(studioIntegrations);
    return {
      studios: studioRows.rows,
      jobs: jobStats,
      runsLast7Days: Object.fromEntries(runStats.map((r) => [r.status, Number(r.n)])),
      integrations,
      platform: {
        mode: env().APP_MODE,
        ai: env().AI_PROVIDER !== "none" && Boolean(env().XAI_API_KEY) && env().AI_MODEL ? `xAI Grok (${env().AI_MODEL})` : "not configured",
        smtp: env().SMTP_HOST && env().EMAIL_FROM ? "configured" : "not configured",
        whatsappWebhook: env().WHATSAPP_APP_SECRET && env().WHATSAPP_VERIFY_TOKEN ? "configured" : "not configured",
        supabase: isSupabaseConfigured() ? "configured" : "not configured (local demo login)",
      },
    };
  });
}

export async function adminFailures(user: CurrentUser) {
  assertAdmin(user);
  return asSystem(async (tx) => {
    const deadJobs = await tx
      .select({ job: jobs, studioName: studios.name })
      .from(jobs)
      .leftJoin(studios, eq(studios.id, jobs.studioId))
      .where(inArray(jobs.status, ["dead", "failed"]))
      .orderBy(desc(jobs.updatedAt))
      .limit(100);
    const failedRuns = await tx
      .select({ run: automationRuns, studioName: studios.name })
      .from(automationRuns)
      .innerJoin(studios, eq(studios.id, automationRuns.studioId))
      .where(eq(automationRuns.status, "failed"))
      .orderBy(desc(automationRuns.createdAt))
      .limit(100);
    const failedMessages = await tx
      .select({ id: messages.id, studioName: studios.name, channel: messages.channel, error: messages.error, provider: messages.provider, failedAt: messages.failedAt })
      .from(messages)
      .innerJoin(studios, eq(studios.id, messages.studioId))
      .where(eq(messages.status, "failed"))
      .orderBy(desc(messages.updatedAt))
      .limit(100);
    const webhookErrors = await tx
      .select({ id: webhookEvents.id, provider: webhookEvents.provider, eventKey: webhookEvents.eventKey, error: webhookEvents.error, receivedAt: webhookEvents.receivedAt })
      .from(webhookEvents)
      .where(eq(webhookEvents.status, "error"))
      .orderBy(desc(webhookEvents.receivedAt))
      .limit(50);
    return { deadJobs, failedRuns, failedMessages, webhookErrors };
  });
}

export async function adminRetryJob(user: CurrentUser, jobId: string) {
  assertAdmin(user);
  z.string().uuid().parse(jobId);
  await retryJob(jobId);
  await asSystem((tx) => audit(tx, { studioId: null, actorUserId: user.id, actorType: "platform_admin", action: "admin.job_retried", targetType: "job", targetId: jobId }));
}

export async function adminAiUsage(user: CurrentUser, days = 30) {
  assertAdmin(user);
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await asSystem((tx) =>
    tx
      .select({
        studioId: aiUsage.studioId,
        studioName: studios.name,
        feature: aiUsage.feature,
        model: aiUsage.model,
        status: aiUsage.status,
        calls: sql<number>`count(*)::int`,
        inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}),0)::bigint`,
        outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}),0)::bigint`,
      })
      .from(aiUsage)
      .leftJoin(studios, eq(studios.id, aiUsage.studioId))
      .where(gte(aiUsage.createdAt, since))
      .groupBy(aiUsage.studioId, studios.name, aiUsage.feature, aiUsage.model, aiUsage.status),
  );
  const { AI_PRICE_INPUT_PER_MTOK_USD: inPrice, AI_PRICE_OUTPUT_PER_MTOK_USD: outPrice } = env();
  const pricingConfigured = inPrice !== undefined && outPrice !== undefined;
  return {
    days,
    pricingConfigured,
    rows: rows.map((r) => ({
      ...r,
      inputTokens: Number(r.inputTokens),
      outputTokens: Number(r.outputTokens),
      estimatedCostUsd: pricingConfigured ? (Number(r.inputTokens) * inPrice! + Number(r.outputTokens) * outPrice!) / 1_000_000 : null,
    })),
  };
}

export async function adminStudioDetail(user: CurrentUser, studioId: string, meta: { ipHash?: string | null }) {
  assertAdmin(user);
  if (!z.string().uuid().safeParse(studioId).success) throw new NotFoundError("Studio");
  return asSystem(async (tx) => {
    const [studio] = await tx.select().from(studios).where(eq(studios.id, studioId));
    if (!studio) throw new NotFoundError("Studio");
    // Access to a customer's account is always recorded.
    await audit(tx, { studioId, actorUserId: user.id, actorType: "platform_admin", action: "admin.studio_viewed", ipHash: meta.ipHash ?? null });
    const notes = await tx.select().from(supportNotes).where(eq(supportNotes.studioId, studioId)).orderBy(desc(supportNotes.createdAt));
    const auditTrail = await tx.select().from(auditLogs).where(eq(auditLogs.studioId, studioId)).orderBy(desc(auditLogs.createdAt)).limit(100);
    const integrations = await tx
      .select({ provider: studioIntegrations.provider, status: studioIntegrations.status, lastError: studioIntegrations.lastError, lastVerifiedAt: studioIntegrations.lastVerifiedAt })
      .from(studioIntegrations)
      .where(eq(studioIntegrations.studioId, studioId));
    const [counts] = (
      await tx.execute<{ leads: number; open_tasks: number; messages_failed: number; runs_failed: number }>(sql`
        select (select count(*)::int from wf.leads where studio_id = ${studioId}) as leads,
          (select count(*)::int from wf.tasks where studio_id = ${studioId} and status = 'open') as open_tasks,
          (select count(*)::int from wf.messages where studio_id = ${studioId} and status = 'failed') as messages_failed,
          (select count(*)::int from wf.automation_runs where studio_id = ${studioId} and status = 'failed') as runs_failed`)
    ).rows;
    return { studio, notes, auditTrail, integrations, counts };
  });
}

export async function adminAddSupportNote(user: CurrentUser, studioId: string, body: string) {
  assertAdmin(user);
  const text = z.string().trim().min(2).max(4000).parse(body);
  await asSystem(async (tx) => {
    await tx.insert(supportNotes).values({ studioId, authorId: user.id, body: text });
    await audit(tx, { studioId, actorUserId: user.id, actorType: "platform_admin", action: "admin.support_note_added" });
  });
}

export async function adminSetStudioStatus(user: CurrentUser, studioId: string, status: "active" | "suspended") {
  assertAdmin(user);
  await asSystem(async (tx) => {
    await tx.update(studios).set({ status, updatedAt: new Date() }).where(eq(studios.id, studioId));
    await audit(tx, { studioId, actorUserId: user.id, actorType: "platform_admin", action: `admin.studio_${status}` });
  });
}

export async function adminAuditEvents(user: CurrentUser) {
  assertAdmin(user);
  return asSystem((tx) =>
    tx
      .select({ log: auditLogs, studioName: studios.name })
      .from(auditLogs)
      .leftJoin(studios, eq(studios.id, auditLogs.studioId))
      .where(and(gte(auditLogs.createdAt, new Date(Date.now() - 30 * 86_400_000))))
      .orderBy(desc(auditLogs.createdAt))
      .limit(200),
  );
}
