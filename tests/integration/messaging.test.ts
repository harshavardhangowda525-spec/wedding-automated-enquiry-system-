import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { asSystem } from "@/server/db/client";
import { leads, messages, studioIntegrations, studios, webhookEvents } from "@/server/db/schema";
import { resetEnvCache } from "@/server/env";
import { DemoAdapter, PermanentSendError, type ChannelAdapter } from "@/server/messaging/adapters";
import { approveMessage, createDraft, processSendJob, setAdapterOverrideForTests } from "@/server/messaging/service";
import { isOptOutText, processWhatsAppWebhook, verifyWhatsAppSignature } from "@/server/messaging/whatsapp-webhook";
import { submitEnquiry } from "@/server/services/enquiries";
import { optOutLead } from "@/server/services/leads";
import { asMember, createTestStudio, drainJobs, enquiryPayload } from "../helpers";

async function setup(name: string, opts: { inboundRecently?: boolean } = {}) {
  const ctx = await createTestStudio(name);
  const res = await submitEnquiry(ctx.studio.slug, enquiryPayload(ctx.studio.id, [ctx.services[0].id]), { ip: `7.7.${Math.floor(Math.random() * 250)}.7` });
  if (!res.ok) throw new Error("enquiry failed");
  const [lead] = await asSystem((tx) => tx.select().from(leads).where(eq(leads.reference, res.reference)));
  if (opts.inboundRecently) await asSystem((tx) => tx.update(leads).set({ lastInboundAt: new Date() }).where(eq(leads.id, lead.id)));
  // Cancel automation drafts so tests control the outbox.
  await asSystem((tx) => tx.update(messages).set({ status: "cancelled" }).where(eq(messages.leadId, lead.id)));
  return { ...ctx, lead };
}

async function draftAndApprove(studioId: string, userId: string, leadId: string, body = `Hello there ${Math.random()}`) {
  return asMember(studioId, userId, "owner", async (svc) => {
    const msg = await createDraft(svc, { leadId, channel: "whatsapp", body });
    await approveMessage(svc, msg.id);
    return msg;
  });
}
const getMsg = async (id: string) => (await asSystem((tx) => tx.select().from(messages).where(eq(messages.id, id))))[0];

function useProductionMode() {
  process.env.APP_MODE = "production";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  resetEnvCache();
}

afterEach(() => {
  process.env.APP_MODE = "demo";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "";
  resetEnvCache();
  setAdapterOverrideForTests(null);
});

describe("outbound messaging", () => {
  it("demo mode sends through the demo adapter only and labels it, without marking the client contacted", async () => {
    const { studio, owner, lead } = await setup("Demo Msg", { inboundRecently: true });
    const before = DemoAdapter.sent.length;
    const msg = await draftAndApprove(studio.id, owner.id, lead.id);
    expect((await getMsg(msg.id)).status).toBe("queued");
    await drainJobs();
    const sent = await getMsg(msg.id);
    expect(sent.status).toBe("sent");
    expect(sent.isDemo).toBe(true);
    expect(sent.provider).toBe("demo");
    expect(sent.deliveredAt).toBeNull();
    expect(DemoAdapter.sent.length).toBe(before + 1);
    const [l] = await asSystem((tx) => tx.select().from(leads).where(eq(leads.id, lead.id)));
    expect(l.lastContactedAt).toBeNull();
  });

  it("demo studios never use real adapters, even in production mode with credentials", async () => {
    const { studio, owner, lead } = await setup("Demo Prod", { inboundRecently: true });
    await asSystem((tx) => tx.update(studios).set({ isDemo: true }).where(eq(studios.id, studio.id)));
    useProductionMode();
    let realCalls = 0;
    setAdapterOverrideForTests(() => ({ provider: "whatsapp_cloud", isDemo: false, send: async () => { realCalls++; return { providerMessageId: "real" }; } }));
    const msg = await draftAndApprove(studio.id, owner.id, lead.id);
    await processSendJob(msg.id);
    expect(realCalls).toBe(0);
    expect((await getMsg(msg.id)).isDemo).toBe(true);
  });

  it("production mode without credentials fails clearly instead of simulating", async () => {
    const { studio, owner, lead } = await setup("No Creds", { inboundRecently: true });
    useProductionMode();
    const msg = await draftAndApprove(studio.id, owner.id, lead.id);
    expect(await processSendJob(msg.id)).toBe("failed");
    const failed = await getMsg(msg.id);
    expect(failed.status).toBe("failed");
    expect(failed.error).toMatch(/not configured/);
    expect(failed.isDemo).toBe(false);
  });

  it("enforces opt-out: pending messages are cancelled and queued ones are skipped at send time", async () => {
    const { studio, owner, lead } = await setup("Opt Out", { inboundRecently: true });
    const queued = await draftAndApprove(studio.id, owner.id, lead.id);
    const draft = await asMember(studio.id, owner.id, "owner", (svc) => createDraft(svc, { leadId: lead.id, channel: "whatsapp", body: "Draft text" }));
    // Simulate a send that was already claimed before the opt-out by forcing it back to queued afterwards.
    await asMember(studio.id, owner.id, "owner", (svc) => optOutLead(svc, lead.id, "phone_call"));
    expect((await getMsg(draft.id)).status).toBe("cancelled");
    expect((await getMsg(queued.id)).status).toBe("cancelled");
    await asSystem((tx) => tx.update(messages).set({ status: "queued" }).where(eq(messages.id, queued.id)));
    expect(await processSendJob(queued.id)).toBe("skipped");
    expect((await getMsg(queued.id)).skipReason).toMatch(/opted out/);
  });

  it("blocks free-form WhatsApp outside the 24-hour window and duplicate content", async () => {
    const { studio, owner, lead } = await setup("Window");
    const outside = await draftAndApprove(studio.id, owner.id, lead.id);
    expect(await processSendJob(outside.id)).toBe("skipped");
    expect((await getMsg(outside.id)).skipReason).toMatch(/24-hour/);

    await asSystem((tx) => tx.update(leads).set({ lastInboundAt: new Date() }).where(eq(leads.id, lead.id)));
    const first = await draftAndApprove(studio.id, owner.id, lead.id, "Same words");
    expect(await processSendJob(first.id)).toBe("sent");
    const second = await draftAndApprove(studio.id, owner.id, lead.id, "Same   words");
    expect(await processSendJob(second.id)).toBe("skipped");
    expect((await getMsg(second.id)).skipReason).toMatch(/identical/);
  });

  it("is idempotent: processing the same send job twice sends once", async () => {
    const { studio, owner, lead } = await setup("Idem Send", { inboundRecently: true });
    const before = DemoAdapter.sent.length;
    const msg = await draftAndApprove(studio.id, owner.id, lead.id);
    await processSendJob(msg.id);
    expect(await processSendJob(msg.id)).toBe("noop");
    expect(DemoAdapter.sent.length).toBe(before + 1);
  });

  it("retries transient provider failures and records permanent ones", async () => {
    const { studio, owner, lead } = await setup("Provider Fail", { inboundRecently: true });
    useProductionMode();
    let attempts = 0;
    const flaky: ChannelAdapter = {
      provider: "whatsapp_cloud",
      isDemo: false,
      send: async () => {
        attempts++;
        if (attempts === 1) throw new Error("ETIMEDOUT");
        return { providerMessageId: `wamid.${Date.now()}` };
      },
    };
    setAdapterOverrideForTests(() => flaky);
    const msg = await draftAndApprove(studio.id, owner.id, lead.id);
    await expect(processSendJob(msg.id)).rejects.toThrow(/ETIMEDOUT/);
    expect((await getMsg(msg.id)).status).toBe("queued");
    expect(await processSendJob(msg.id)).toBe("sent");
    const ok = await getMsg(msg.id);
    expect(ok.status).toBe("sent"); // accepted by provider, not "delivered"
    expect(ok.deliveredAt).toBeNull();
    const [l] = await asSystem((tx) => tx.select().from(leads).where(eq(leads.id, lead.id)));
    expect(l.lastContactedAt).not.toBeNull();

    setAdapterOverrideForTests(() => ({ provider: "whatsapp_cloud", isDemo: false, send: async () => { throw new PermanentSendError("WhatsApp rejected the message: invalid number"); } }));
    const bad = await draftAndApprove(studio.id, owner.id, lead.id);
    await expect(processSendJob(bad.id)).rejects.toThrow(/invalid number/);
    expect((await getMsg(bad.id)).status).toBe("failed");
  });
});

describe("WhatsApp webhooks", () => {
  function sign(body: string) {
    return `sha256=${createHmac("sha256", "test-whatsapp-app-secret").update(body).digest("hex")}`;
  }

  it("verifies signatures", () => {
    const body = JSON.stringify({ hello: "world" });
    expect(verifyWhatsAppSignature(body, sign(body))).toBe(true);
    expect(verifyWhatsAppSignature(body, sign("tampered"))).toBe(false);
    expect(verifyWhatsAppSignature(body, null)).toBe(false);
  });

  it("processes duplicate status callbacks once and never downgrades status", async () => {
    const { studio, owner, lead } = await setup("Webhook Status", { inboundRecently: true });
    const msg = await draftAndApprove(studio.id, owner.id, lead.id);
    await asSystem((tx) => tx.update(messages).set({ status: "sent", provider: "whatsapp_cloud", providerMessageId: `wamid.${msg.id}` }).where(eq(messages.id, msg.id)));
    const payload = (status: string) => ({ entry: [{ changes: [{ value: { statuses: [{ id: `wamid.${msg.id}`, status, timestamp: String(Math.floor(Date.now() / 1000)) }] } }] }] });
    expect((await processWhatsAppWebhook(payload("delivered"))).processed).toBe(1);
    expect((await processWhatsAppWebhook(payload("delivered"))).duplicates).toBe(1);
    expect((await getMsg(msg.id)).status).toBe("delivered");
    await processWhatsAppWebhook(payload("sent")); // late, out-of-order event
    const after = await getMsg(msg.id);
    expect(after.status).toBe("delivered");
    expect(after.deliveredAt).not.toBeNull();
    const events = await asSystem((tx) => tx.select().from(webhookEvents).where(eq(webhookEvents.eventKey, `status:wamid.${msg.id}:delivered`)));
    expect(events).toHaveLength(1);
  });

  it("records inbound replies and opts the client out on STOP", async () => {
    const { studio, lead } = await setup("Webhook Inbound");
    const phoneNumberId = `pn-${studio.id.slice(0, 8)}`;
    await asSystem((tx) => tx.insert(studioIntegrations).values({ studioId: studio.id, provider: "whatsapp_cloud", status: "configured", config: { phoneNumberId } }));
    const inbound = (id: string, text: string) => ({
      entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, messages: [{ id, from: lead.phone.slice(1), type: "text", text: { body: text }, timestamp: String(Math.floor(Date.now() / 1000)) }] } }] }],
    });
    await processWhatsAppWebhook(inbound(`in-1-${lead.id}`, "Hi, is Feb 14 open?"));
    let [l] = await asSystem((tx) => tx.select().from(leads).where(eq(leads.id, lead.id)));
    expect(l.lastInboundAt).not.toBeNull();
    expect(l.optedOut).toBe(false);
    await processWhatsAppWebhook(inbound(`in-2-${lead.id}`, "STOP"));
    await processWhatsAppWebhook(inbound(`in-2-${lead.id}`, "STOP")); // duplicate delivery
    [l] = await asSystem((tx) => tx.select().from(leads).where(eq(leads.id, lead.id)));
    expect(l.optedOut).toBe(true);
    const inboundMsgs = await asSystem((tx) => tx.select().from(messages).where(and(eq(messages.leadId, lead.id), eq(messages.direction, "inbound"))));
    expect(inboundMsgs).toHaveLength(2);
  });

  it("recognises opt-out phrases conservatively", () => {
    expect(isOptOutText("STOP")).toBe(true);
    expect(isOptOutText("unsubscribe please")).toBe(true);
    expect(isOptOutText("Please don't stop the music")).toBe(false);
  });
});
