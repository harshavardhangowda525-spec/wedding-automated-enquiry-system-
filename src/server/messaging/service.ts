import "server-only";
import { and, count, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { CLOSED_STATUSES, DEMO_LABEL, roleAtLeast } from "@/lib/domain";
import { nextBusinessMoment, isWithinBusinessHours } from "@/lib/time";
import { parseStudioSettings } from "@/lib/studio-settings";
import type { ServiceContext } from "@/server/auth/context";
import { asSystem, type Queryable, type Tx } from "@/server/db/client";
import { leads, messageTemplates, messages, studioIntegrations, studios } from "@/server/db/schema";
import { env } from "@/server/env";
import { enqueueJob, PermanentJobError } from "@/server/jobs/queue";
import { decryptSecret, sha256 } from "@/server/lib/crypto";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/lib/errors";
import { recordActivity } from "@/server/services/activity";
import {
  ChannelNotConfiguredError,
  DemoAdapter,
  PermanentSendError,
  SmtpAdapter,
  WhatsAppCloudAdapter,
  isSmtpConfigured,
  type ChannelAdapter,
} from "./adapters";
import { renderTemplate, templateVars, whatsappTemplateParams } from "./templates";

export type Message = typeof messages.$inferSelect;
type Lead = typeof leads.$inferSelect;
type Studio = typeof studios.$inferSelect;

const WHATSAPP_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
const DUPLICATE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function requireWriter(svc: ServiceContext) {
  if (svc.role !== "system" && !roleAtLeast(svc.role, "staff")) throw new ForbiddenError();
}

export function contentHash(channel: string, body: string, templateName?: string | null) {
  return sha256(`${channel}|${templateName ?? ""}|${body.trim().toLowerCase().replace(/\s+/g, " ")}`);
}

// ---------------------------------------------------------------- adapters

let adapterOverride: ((studio: Studio, channel: "whatsapp" | "email") => ChannelAdapter) | null = null;
/** Test hook: replace adapter resolution (e.g. to simulate provider failures). */
export function setAdapterOverrideForTests(fn: typeof adapterOverride) {
  adapterOverride = fn;
}

/**
 * Chooses how a message is delivered. Demo mode and demo studios ALWAYS use the demo
 * adapter, even if real credentials exist, so sample data can never reach a real person.
 */
export async function resolveAdapter(q: Queryable, studio: Studio, channel: "whatsapp" | "email"): Promise<ChannelAdapter> {
  if (env().APP_MODE === "demo" || studio.isDemo) return new DemoAdapter();
  if (adapterOverride) return adapterOverride(studio, channel);
  if (channel === "email") {
    if (!isSmtpConfigured()) throw new ChannelNotConfiguredError("email");
    return new SmtpAdapter();
  }
  const [integration] = await q
    .select()
    .from(studioIntegrations)
    .where(and(eq(studioIntegrations.studioId, studio.id), eq(studioIntegrations.provider, "whatsapp_cloud")));
  if (!integration?.secretEncrypted || !integration.config.phoneNumberId || integration.status === "not_configured") {
    throw new ChannelNotConfiguredError("whatsapp");
  }
  return new WhatsAppCloudAdapter(integration.config.phoneNumberId, decryptSecret(integration.secretEncrypted));
}

/** For the UI: whether a channel can currently send, and how. */
export async function channelStatus(q: Queryable, studio: Studio) {
  const demo = env().APP_MODE === "demo" || studio.isDemo;
  const [wa] = await q
    .select({ status: studioIntegrations.status })
    .from(studioIntegrations)
    .where(and(eq(studioIntegrations.studioId, studio.id), eq(studioIntegrations.provider, "whatsapp_cloud")));
  return {
    demo,
    whatsapp: demo ? "demo" : wa && wa.status !== "not_configured" ? wa.status : "not_configured",
    email: demo ? "demo" : isSmtpConfigured() ? "configured" : "not_configured",
  } as const;
}

// ---------------------------------------------------------------- drafts

export const draftSchema = z.object({
  leadId: z.string().uuid(),
  channel: z.enum(["whatsapp", "email"]),
  subject: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v ? v : undefined)),
  body: z.string().trim().min(1, "Message cannot be empty").max(4096),
  templateId: z.string().uuid().optional(),
  purpose: z.enum(["acknowledgement", "follow_up", "quotation", "general"]).default("general"),
});

export async function createDraft(
  svc: ServiceContext,
  input: z.input<typeof draftSchema>,
  extra: { aiGenerated?: boolean; automationRunId?: string; reviewNotes?: string | null; status?: "draft" | "awaiting_approval" } = {},
) {
  requireWriter(svc);
  const data = draftSchema.parse(input);
  const [lead] = await svc.tx.select().from(leads).where(and(eq(leads.id, data.leadId), eq(leads.studioId, svc.studioId)));
  if (!lead) throw new NotFoundError("Lead");
  let whatsappTemplateName: string | null = null;
  let templateParams: string[] | null = null;
  if (data.templateId) {
    const [tpl] = await svc.tx
      .select()
      .from(messageTemplates)
      .where(and(eq(messageTemplates.id, data.templateId), eq(messageTemplates.studioId, svc.studioId)));
    if (!tpl) throw new NotFoundError("Template");
    if (tpl.channel !== data.channel) throw new ValidationError("Template channel does not match");
    if (tpl.channel === "whatsapp" && tpl.whatsappTemplateName) {
      const [studio] = await svc.tx.select().from(studios).where(eq(studios.id, svc.studioId));
      whatsappTemplateName = tpl.whatsappTemplateName;
      templateParams = whatsappTemplateParams(tpl.body, templateVars(lead, studio));
    }
  }
  const [msg] = await svc.tx
    .insert(messages)
    .values({
      studioId: svc.studioId,
      leadId: data.leadId,
      channel: data.channel,
      direction: "outbound",
      status: extra.status ?? "awaiting_approval",
      subject: data.subject ?? null,
      body: data.body,
      templateId: data.templateId ?? null,
      whatsappTemplateName,
      templateParams,
      toAddress: data.channel === "email" ? lead.email : lead.phone,
      purpose: data.purpose,
      aiGenerated: extra.aiGenerated ?? false,
      reviewNotes: extra.reviewNotes ?? null,
      automationRunId: extra.automationRunId ?? null,
      createdByType: svc.actorType,
      createdBy: svc.userId,
      contentHash: contentHash(data.channel, data.body, whatsappTemplateName),
    })
    .returning();
  await recordActivity(svc, {
    leadId: data.leadId,
    type: "message_drafted",
    summary: `${extra.aiGenerated ? "AI draft" : "Draft"} ${data.channel === "whatsapp" ? "WhatsApp message" : "email"} prepared for approval`,
    data: { messageId: msg.id },
  });
  return msg;
}

/** Renders a studio template into a draft for a lead. */
export async function createDraftFromTemplate(svc: ServiceContext, leadId: string, templateId: string, extra: Parameters<typeof createDraft>[2] = {}) {
  const [tpl] = await svc.tx.select().from(messageTemplates).where(and(eq(messageTemplates.id, templateId), eq(messageTemplates.studioId, svc.studioId)));
  if (!tpl) throw new NotFoundError("Template");
  const [lead] = await svc.tx.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.studioId, svc.studioId)));
  if (!lead) throw new NotFoundError("Lead");
  const [studio] = await svc.tx.select().from(studios).where(eq(studios.id, svc.studioId));
  const vars = templateVars(lead, studio);
  return createDraft(
    svc,
    {
      leadId,
      channel: tpl.channel,
      subject: tpl.subject ? renderTemplate(tpl.subject, vars) : undefined,
      body: renderTemplate(tpl.body, vars),
      templateId: tpl.id,
      purpose: (["acknowledgement", "follow_up", "quotation"].includes(tpl.purpose) ? tpl.purpose : "general") as "general",
    },
    extra,
  );
}

async function getMessage(svc: Pick<ServiceContext, "tx" | "studioId">, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Message");
  const [msg] = await svc.tx.select().from(messages).where(and(eq(messages.id, id), eq(messages.studioId, svc.studioId)));
  if (!msg) throw new NotFoundError("Message");
  return msg;
}

export async function updateDraft(svc: ServiceContext, id: string, input: { subject?: string; body: string }) {
  requireWriter(svc);
  const msg = await getMessage(svc, id);
  if (!["draft", "awaiting_approval"].includes(msg.status)) throw new ValidationError("Only drafts can be edited");
  const body = z.string().trim().min(1).max(4096).parse(input.body);
  if (msg.whatsappTemplateName && body !== msg.body) {
    throw new ValidationError("Approved WhatsApp templates cannot be edited here; edit the template in WhatsApp Manager instead");
  }
  const [updated] = await svc.tx
    .update(messages)
    .set({ body, subject: input.subject?.trim() || null, contentHash: contentHash(msg.channel, body, msg.whatsappTemplateName), updatedAt: new Date() })
    .where(eq(messages.id, id))
    .returning();
  return updated;
}

/** Human approval: the message is queued and a durable send job is created. */
export async function approveMessage(svc: ServiceContext, id: string) {
  requireWriter(svc);
  const msg = await getMessage(svc, id);
  if (!["draft", "awaiting_approval"].includes(msg.status)) throw new ValidationError(`This message is already ${msg.status}`);
  const now = new Date();
  await svc.tx
    .update(messages)
    .set({ status: "queued", approvedBy: svc.userId, approvedAt: now, queuedAt: now, updatedAt: now })
    .where(eq(messages.id, id));
  await enqueueJob(svc.tx, { type: "message.send", studioId: svc.studioId, payload: { messageId: id }, idempotencyKey: `send:${id}`, maxAttempts: 5 });
  await recordActivity(svc, { leadId: msg.leadId, type: "message_approved", summary: `${msg.channel === "whatsapp" ? "WhatsApp message" : "Email"} approved and queued`, data: { messageId: id } });
}

/** Queues a message without per-message approval (only for explicitly enabled automations). */
export async function queueAutomatedMessage(tx: Tx, studioId: string, messageId: string) {
  const now = new Date();
  await tx.update(messages).set({ status: "queued", queuedAt: now, updatedAt: now }).where(and(eq(messages.id, messageId), eq(messages.studioId, studioId)));
  await enqueueJob(tx, { type: "message.send", studioId, payload: { messageId }, idempotencyKey: `send:${messageId}`, maxAttempts: 5 });
}

export async function cancelMessage(svc: ServiceContext, id: string) {
  requireWriter(svc);
  const msg = await getMessage(svc, id);
  if (!["draft", "awaiting_approval", "queued"].includes(msg.status)) throw new ValidationError(`A ${msg.status} message cannot be cancelled`);
  await svc.tx.update(messages).set({ status: "cancelled", skipReason: "Cancelled by staff", updatedAt: new Date() }).where(eq(messages.id, id));
  await recordActivity(svc, { leadId: msg.leadId, type: "message_cancelled", summary: "Message cancelled", data: { messageId: id } });
}

export async function listMessages(svc: ServiceContext, filter: { status?: Message["status"][]; leadId?: string; limit?: number } = {}) {
  const parts = [eq(messages.studioId, svc.studioId)];
  if (filter.status?.length) parts.push(inArray(messages.status, filter.status));
  if (filter.leadId) parts.push(eq(messages.leadId, filter.leadId));
  return svc.tx
    .select({ message: messages, leadName: leads.contactName, leadReference: leads.reference, leadOptedOut: leads.optedOut })
    .from(messages)
    .innerJoin(leads, eq(leads.id, messages.leadId))
    .where(and(...parts))
    .orderBy(desc(messages.createdAt))
    .limit(filter.limit ?? 100);
}

// ---------------------------------------------------------------- policy

export type PolicyDecision = { action: "send" } | { action: "skip"; reason: string } | { action: "defer"; until: Date; reason: string };

/**
 * Checked immediately before every outbound send (not just at approval time), because
 * lead state can change between approval and delivery.
 */
export async function checkSendPolicy(q: Queryable, msg: Message, lead: Lead, studio: Studio, now = new Date()): Promise<PolicyDecision> {
  const settings = parseStudioSettings(studio.settings);
  if (lead.optedOut) return { action: "skip", reason: "Client has opted out" };
  if (!lead.consentContact) return { action: "skip", reason: "No recorded consent to contact this client" };
  if (CLOSED_STATUSES.includes(lead.status) && msg.purpose !== "general" && msg.purpose !== "quotation") {
    return { action: "skip", reason: `Lead is ${lead.status.replace(/_/g, " ")}; follow-up no longer relevant` };
  }
  const to = msg.channel === "email" ? lead.email : lead.phone;
  if (!to) return { action: "skip", reason: msg.channel === "email" ? "Client has no email address" : "Client has no phone number" };

  if (msg.contentHash) {
    const [dup] = await q
      .select({ n: count() })
      .from(messages)
      .where(
        and(
          eq(messages.leadId, lead.id),
          ne(messages.id, msg.id),
          eq(messages.contentHash, msg.contentHash),
          inArray(messages.status, ["sending", "sent", "delivered"]),
          gte(messages.createdAt, new Date(now.getTime() - DUPLICATE_WINDOW_MS)),
        ),
      );
    if (Number(dup.n) > 0) return { action: "skip", reason: "An identical message was already sent to this client in the last 7 days" };
  }

  if (msg.channel === "whatsapp" && !msg.whatsappTemplateName) {
    const windowOpen = lead.lastInboundAt && now.getTime() - lead.lastInboundAt.getTime() < WHATSAPP_SERVICE_WINDOW_MS;
    if (!windowOpen) {
      return { action: "skip", reason: "Outside WhatsApp's 24-hour customer service window; use an approved template" };
    }
  }

  const automated = msg.createdByType === "automation" && !msg.approvedBy;
  if (automated) {
    const [sentAuto] = await q
      .select({ n: count() })
      .from(messages)
      .where(and(eq(messages.leadId, lead.id), eq(messages.createdByType, "automation"), inArray(messages.status, ["sent", "delivered"])));
    if (Number(sentAuto.n) >= settings.followUp.maxAutomatedMessagesPerLead) {
      return { action: "skip", reason: "Automated message limit for this lead reached" };
    }
    const [last] = await q
      .select({ sentAt: messages.sentAt })
      .from(messages)
      .where(and(eq(messages.leadId, lead.id), eq(messages.direction, "outbound"), inArray(messages.status, ["sent", "delivered"])))
      .orderBy(sql`${messages.sentAt} desc nulls last`)
      .limit(1);
    const minGap = settings.followUp.minHoursBetweenMessages * 3600 * 1000;
    if (last?.sentAt && now.getTime() - last.sentAt.getTime() < minGap) {
      return { action: "skip", reason: `Another message was sent less than ${settings.followUp.minHoursBetweenMessages} hours ago` };
    }
    if (!isWithinBusinessHours(now, studio.timezone, settings.businessHours)) {
      return { action: "defer", until: nextBusinessMoment(now, studio.timezone, settings.businessHours), reason: "Outside business hours" };
    }
  }
  return { action: "send" };
}

// ---------------------------------------------------------------- sending (job handler)

/** Processes one `message.send` job. Safe to run more than once for the same message. */
export async function processSendJob(messageId: string, now = new Date()): Promise<"sent" | "skipped" | "deferred" | "noop" | "failed"> {
  // Phase 1: lock, re-validate, mark sending.
  const prepared = await asSystem(async (tx) => {
    const locked = await tx.execute<{ id: string }>(sql`select id from wf.messages where id = ${messageId} for update`);
    if (locked.rows.length === 0) return { kind: "noop" as const };
    const [msg] = await tx.select().from(messages).where(eq(messages.id, messageId));
    if (msg.status !== "queued") return { kind: "noop" as const }; // already sent, cancelled or in flight
    const [lead] = await tx.select().from(leads).where(eq(leads.id, msg.leadId));
    const [studio] = await tx.select().from(studios).where(eq(studios.id, msg.studioId));
    const svc = { tx, studioId: studio.id, userId: null, actorType: "system" as const };
    if (studio.automationPaused && msg.createdByType === "automation" && !msg.approvedBy) {
      await tx.update(messages).set({ status: "skipped", skipReason: "Automation is paused", updatedAt: now }).where(eq(messages.id, messageId));
      return { kind: "skipped" as const };
    }
    const decision = await checkSendPolicy(tx, msg, lead, studio, now);
    if (decision.action === "skip") {
      await tx.update(messages).set({ status: "skipped", skipReason: decision.reason, updatedAt: now }).where(eq(messages.id, messageId));
      await recordActivity(svc, { leadId: lead.id, type: "message_skipped", summary: `Message not sent: ${decision.reason}`, data: { messageId } });
      return { kind: "skipped" as const };
    }
    if (decision.action === "defer") {
      await enqueueJob(tx, {
        type: "message.send",
        studioId: studio.id,
        payload: { messageId },
        runAt: decision.until,
        idempotencyKey: `send:${messageId}:${decision.until.toISOString()}`,
      });
      return { kind: "deferred" as const };
    }
    let adapter: ChannelAdapter;
    try {
      adapter = await resolveAdapter(tx, studio, msg.channel);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Channel unavailable";
      await tx.update(messages).set({ status: "failed", error: reason, failedAt: now, updatedAt: now }).where(eq(messages.id, messageId));
      await recordActivity(svc, { leadId: lead.id, type: "message_failed", summary: `Message failed: ${reason}`, data: { messageId } });
      return { kind: "failed" as const };
    }
    await tx.update(messages).set({ status: "sending", provider: adapter.provider, isDemo: adapter.isDemo, updatedAt: now }).where(eq(messages.id, messageId));
    return { kind: "send" as const, msg, lead, studio, adapter };
  });
  if (prepared.kind !== "send") return prepared.kind;

  // Phase 2: call the provider outside the transaction.
  const { msg, lead, studio, adapter } = prepared;
  try {
    const result = await adapter.send({
      channel: msg.channel,
      to: msg.channel === "email" ? lead.email! : lead.phone,
      subject: msg.subject,
      body: msg.body,
      whatsappTemplateName: msg.whatsappTemplateName,
      templateParams: msg.templateParams,
      fromName: studio.name,
      replyTo: studio.email,
    });
    await asSystem(async (tx) => {
      const sentAt = new Date();
      await tx
        .update(messages)
        .set({ status: "sent", providerMessageId: result.providerMessageId, sentAt, error: null, updatedAt: sentAt })
        .where(eq(messages.id, msg.id));
      if (!adapter.isDemo) {
        await tx
          .update(leads)
          .set({ lastContactedAt: sentAt, firstContactedAt: lead.firstContactedAt ?? sentAt, updatedAt: sentAt })
          .where(eq(leads.id, lead.id));
      }
      await recordActivity(
        { tx, studioId: studio.id, userId: null, actorType: "system" },
        {
          leadId: lead.id,
          type: "message_sent",
          summary: adapter.isDemo
            ? `${DEMO_LABEL}: ${msg.channel === "whatsapp" ? "WhatsApp message" : "email"} simulated`
            : `${msg.channel === "whatsapp" ? "WhatsApp message" : "Email"} handed to provider (awaiting delivery confirmation)`,
          data: { messageId: msg.id, providerMessageId: result.providerMessageId, demo: adapter.isDemo },
        },
      );
    });
    return "sent";
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const permanent = err instanceof PermanentSendError;
    await asSystem(async (tx) => {
      const at = new Date();
      await tx
        .update(messages)
        .set(permanent ? { status: "failed", error: reason, failedAt: at, updatedAt: at } : { status: "queued", error: reason, updatedAt: at })
        .where(eq(messages.id, msg.id));
      if (permanent) {
        await recordActivity({ tx, studioId: studio.id, userId: null, actorType: "system" }, { leadId: lead.id, type: "message_failed", summary: `Message failed: ${reason}`, data: { messageId: msg.id } });
      }
    });
    if (permanent) throw new PermanentJobError(reason);
    throw err; // transient → job retries with backoff
  }
}

/** Called when a job for a message exhausts its retries. */
export async function markMessageFailedAfterRetries(messageId: string, reason: string) {
  await asSystem((tx) =>
    tx
      .update(messages)
      .set({ status: "failed", error: `Gave up after retries: ${reason}`, failedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(messages.id, messageId), eq(messages.status, "queued"))),
  );
}
