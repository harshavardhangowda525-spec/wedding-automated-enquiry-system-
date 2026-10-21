import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { asSystem } from "@/server/db/client";
import { leads, messages, studioIntegrations, webhookEvents } from "@/server/db/schema";
import { env } from "@/server/env";
import { recordActivity } from "@/server/services/activity";
import { optOutLead } from "@/server/services/leads";

export const OPT_OUT_KEYWORDS = ["stop", "unsubscribe", "opt out", "optout", "cancel messages", "no more messages"];

export function isOptOutText(text: string): boolean {
  const t = text.trim().toLowerCase();
  return OPT_OUT_KEYWORDS.some((k) => t === k || t.startsWith(`${k} `) || t.startsWith(`${k}.`) || t.startsWith(`${k}!`));
}

/** Verifies Meta's X-Hub-Signature-256 header over the raw request body. */
export function verifyWhatsAppSignature(rawBody: string, header: string | null): boolean {
  const secret = env().WHATSAPP_APP_SECRET;
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(header.slice(7), "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

type StatusEvent = { id: string; status: string; timestamp?: string; recipient_id?: string; errors?: { title?: string; message?: string; code?: number }[] };
type InboundMessage = { id: string; from: string; timestamp?: string; type: string; text?: { body?: string }; button?: { text?: string } };
type ChangeValue = {
  metadata?: { phone_number_id?: string };
  statuses?: StatusEvent[];
  messages?: InboundMessage[];
};
export type WhatsAppWebhookPayload = { object?: string; entry?: { id?: string; changes?: { field?: string; value?: ChangeValue }[] }[] };

const STATUS_RANK: Record<string, number> = { sending: 0, sent: 1, delivered: 2, read: 3 };

/**
 * Stores each event once (unique provider+key). Returns false if it was already handled.
 * An event whose earlier processing errored is claimed again so a provider retry can succeed.
 */
async function claimEvent(eventKey: string, payload: unknown): Promise<boolean> {
  const inserted = await asSystem((tx) =>
    tx
      .insert(webhookEvents)
      .values({ provider: "whatsapp", eventKey, payload: payload as object })
      .onConflictDoUpdate({
        target: [webhookEvents.provider, webhookEvents.eventKey],
        set: { status: "received", error: null },
        setWhere: sql`${webhookEvents.status} = 'error'`,
      })
      .returning({ id: webhookEvents.id }),
  );
  return inserted.length > 0;
}

async function finishEvent(eventKey: string, status: "processed" | "ignored" | "error", error?: string) {
  await asSystem((tx) =>
    tx
      .update(webhookEvents)
      .set({ status, error: error ?? null, processedAt: new Date() })
      .where(and(eq(webhookEvents.provider, "whatsapp"), eq(webhookEvents.eventKey, eventKey))),
  );
}

export async function processWhatsAppWebhook(payload: WhatsAppWebhookPayload): Promise<{ processed: number; duplicates: number }> {
  let processed = 0;
  let duplicates = 0;
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      for (const status of value.statuses ?? []) {
        const key = `status:${status.id}:${status.status}`;
        if (!(await claimEvent(key, status))) {
          duplicates++;
          continue;
        }
        try {
          const handled = await applyStatus(status);
          await finishEvent(key, handled ? "processed" : "ignored");
          processed++;
        } catch (err) {
          await finishEvent(key, "error", (err as Error).message);
          throw err;
        }
      }
      for (const message of value.messages ?? []) {
        const key = `msg:${message.id}`;
        if (!(await claimEvent(key, { ...message, phone_number_id: value.metadata?.phone_number_id }))) {
          duplicates++;
          continue;
        }
        try {
          const handled = await applyInbound(message, value.metadata?.phone_number_id);
          await finishEvent(key, handled ? "processed" : "ignored");
          processed++;
        } catch (err) {
          await finishEvent(key, "error", (err as Error).message);
          throw err;
        }
      }
    }
  }
  return { processed, duplicates };
}

async function applyStatus(event: StatusEvent): Promise<boolean> {
  return asSystem(async (tx) => {
    const [msg] = await tx
      .select()
      .from(messages)
      .where(and(eq(messages.provider, "whatsapp_cloud"), eq(messages.providerMessageId, event.id)));
    if (!msg) return false;
    const at = event.timestamp ? new Date(Number(event.timestamp) * 1000) : new Date();
    const svc = { tx, studioId: msg.studioId, userId: null, actorType: "system" as const };
    if (event.status === "failed") {
      const reason = event.errors?.map((e) => e.message ?? e.title).filter(Boolean).join("; ") || "Delivery failed";
      await tx.update(messages).set({ status: "failed", error: reason, failedAt: at, updatedAt: new Date() }).where(eq(messages.id, msg.id));
      await recordActivity(svc, { leadId: msg.leadId, type: "message_failed", summary: `WhatsApp delivery failed: ${reason}`, data: { messageId: msg.id } });
      return true;
    }
    const current = msg.status === "delivered" ? (msg.readAt ? 3 : 2) : STATUS_RANK[msg.status] ?? -1;
    const incoming = STATUS_RANK[event.status];
    if (incoming === undefined || incoming <= current) return true; // never downgrade (events can arrive out of order)
    if (event.status === "delivered" || event.status === "read") {
      await tx
        .update(messages)
        .set({
          status: "delivered",
          deliveredAt: msg.deliveredAt ?? at,
          readAt: event.status === "read" ? at : msg.readAt,
          updatedAt: new Date(),
        })
        .where(eq(messages.id, msg.id));
      if (event.status === "delivered") {
        await recordActivity(svc, { leadId: msg.leadId, type: "message_delivered", summary: "WhatsApp message delivered (confirmed by WhatsApp)", data: { messageId: msg.id }, touchLead: false });
      }
    }
    return true;
  });
}

async function applyInbound(message: InboundMessage, phoneNumberId: string | undefined): Promise<boolean> {
  if (!phoneNumberId) return false;
  return asSystem(async (tx) => {
    const [integration] = await tx
      .select({ studioId: studioIntegrations.studioId })
      .from(studioIntegrations)
      .where(and(eq(studioIntegrations.provider, "whatsapp_cloud"), sql`${studioIntegrations.config}->>'phoneNumberId' = ${phoneNumberId}`));
    if (!integration) return false;
    const phone = `+${message.from.replace(/\D/g, "")}`;
    const [lead] = await tx
      .select()
      .from(leads)
      .where(and(eq(leads.studioId, integration.studioId), eq(leads.phone, phone)))
      .orderBy(desc(leads.createdAt))
      .limit(1);
    if (!lead) return false;
    const text = message.text?.body ?? message.button?.text ?? `[${message.type} message]`;
    const at = message.timestamp ? new Date(Number(message.timestamp) * 1000) : new Date();
    await tx.insert(messages).values({
      studioId: integration.studioId,
      leadId: lead.id,
      channel: "whatsapp",
      direction: "inbound",
      status: "delivered",
      body: text.slice(0, 4096),
      provider: "whatsapp_cloud",
      providerMessageId: message.id,
      createdByType: "client",
      deliveredAt: at,
    });
    await tx.update(leads).set({ lastInboundAt: at, updatedAt: new Date() }).where(eq(leads.id, lead.id));
    const svc = { tx, studioId: integration.studioId, userId: null, actorType: "client" as const };
    await recordActivity(svc, { leadId: lead.id, type: "message_received", summary: `WhatsApp from client: ${text.slice(0, 200)}` });
    if (isOptOutText(text)) await optOutLead(svc, lead.id, "whatsapp_reply");
    return true;
  });
}
