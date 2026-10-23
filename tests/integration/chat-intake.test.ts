import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { EMPTY_CHAT_FIELDS, type ChatFields } from "@/lib/chat-intake";
import { setAiProviderForTests, type AiProvider } from "@/server/ai/provider";
import { asSystem } from "@/server/db/client";
import { activities, leads, messageTemplates, messages } from "@/server/db/schema";
import { processSendJob } from "@/server/messaging/service";
import { processChatTurn, submitChatEnquiry } from "@/server/services/chat-intake";
import { issueFormToken } from "@/server/services/enquiries";
import { createTestStudio, drainJobs } from "../helpers";

type Input = { text?: string; choice?: string; choices?: string[]; date?: string; skip?: boolean };

async function turn(slug: string, fields: ChatFields, input: Input, ip = "7.6.5.4") {
  const res = await processChatTurn(slug, { fields, input }, { ip });
  if (!res.ok) throw new Error(res.error);
  return res;
}

const extraction = (over: Record<string, unknown> = {}) => ({
  contactName: null,
  partnerName: null,
  phone: null,
  email: null,
  eventType: null,
  eventDate: null,
  dateNotDecided: false,
  city: null,
  venue: null,
  services: [],
  budgetRange: null,
  additionalRequirements: null,
  acknowledgement: "",
  ...over,
});

function fakeAi(result: (prompt: string) => unknown): AiProvider {
  return { name: "fake", model: "fake", generate: async (req) => ({ data: result(req.prompt) as never, model: "fake", inputTokens: 10, outputTokens: 10 }) };
}

/** Walks the whole guided conversation using buttons/choices only (no AI). */
async function completeGuided(slug: string, serviceId: string, phone = `98${String(Date.now()).slice(-8)}`) {
  let r = await turn(slug, EMPTY_CHAT_FIELDS, { text: "Priya Sharma" });
  expect(r.step).toBe("phone");
  r = await turn(slug, r.fields, { text: phone });
  expect(r.step).toBe("eventType");
  r = await turn(slug, r.fields, { choice: "Wedding" });
  expect(r.step).toBe("eventDate");
  r = await turn(slug, r.fields, { date: "2027-12-12" });
  expect(r.step).toBe("city");
  r = await turn(slug, r.fields, { text: "Udaipur" });
  expect(r.step).toBe("services");
  r = await turn(slug, r.fields, { choices: [serviceId] });
  for (const optional of ["partnerName", "email", "budgetRange", "message"]) {
    expect(r.step).toBe(optional);
    r = await turn(slug, r.fields, { skip: true });
  }
  expect(r.step).toBe("consent");
  r = await turn(slug, r.fields, { choice: "agree" });
  expect(r.step).toBe("confirm");
  return r.fields;
}

afterEach(() => setAiProviderForTests(undefined));

describe("enquiry chatbot", () => {
  it("collects every required detail step by step without AI and creates a chat lead", async () => {
    setAiProviderForTests(null);
    const { studio, services } = await createTestStudio("Chat Guided");
    const fields = await completeGuided(studio.slug, services[0].id);
    const res = await submitChatEnquiry(studio.slug, { fields, formToken: issueFormToken(studio.id, Date.now() - 60_000) }, { ip: "7.6.5.4" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [lead] = await asSystem((tx) => tx.select().from(leads).where(eq(leads.id, res.leadId)));
    expect(lead).toMatchObject({ source: "website_chat", contactName: "Priya Sharma", city: "Udaipur", eventDate: "2027-12-12", consentContact: true });
    // The default template is not marked approved, so the automatic WhatsApp is skipped with a clear reason.
    expect(res.autoAcknowledgement).toBe("skipped");
    const [skipped] = await asSystem((tx) => tx.select().from(messages).where(eq(messages.leadId, lead.id)));
    expect(skipped).toMatchObject({ status: "skipped", channel: "whatsapp" });
    expect(skipped.skipReason).toMatch(/marked approved/);
  });

  it("re-asks on invalid answers and rejects past dates", async () => {
    setAiProviderForTests(null);
    const { studio } = await createTestStudio("Chat Validation");
    let r = await turn(studio.slug, EMPTY_CHAT_FIELDS, { text: "My name is Arjun" });
    expect(r.fields.contactName).toBe("Arjun");
    r = await turn(studio.slug, r.fields, { text: "12345" });
    expect(r.step).toBe("phone");
    expect(r.bot[0]).toMatch(/valid phone/);
    r = await turn(studio.slug, r.fields, { text: "98765 43210" });
    expect(r.fields.phone).toBe("+919876543210");
    r = await turn(studio.slug, r.fields, { text: "our engagement" });
    expect(r.fields.eventType).toBe("Engagement");
    r = await turn(studio.slug, r.fields, { date: "2020-01-01" });
    expect(r.step).toBe("eventDate");
    expect(r.bot[0]).toMatch(/already passed/);
    r = await turn(studio.slug, r.fields, { text: "not decided yet" });
    expect(r.fields.dateKnown).toBe("no");
    expect(r.step).toBe("city");
  });

  it("understands a natural message with Grok and only asks for what is missing", async () => {
    const { studio, services } = await createTestStudio("Chat AI");
    let prompt = "";
    setAiProviderForTests(
      fakeAi((p) => {
        prompt = p;
        return extraction({
          contactName: "Meera",
          eventType: "Wedding",
          eventDate: "2027-02-14",
          city: "Jaipur",
          services: [services[0].name, "Made-up Service"],
          acknowledgement: "Congratulations on your upcoming wedding!",
        });
      }),
    );
    const r = await turn(studio.slug, EMPTY_CHAT_FIELDS, { text: "Hi, I'm Meera, getting married in Jaipur on 14 Feb 2027, need candid photos" });
    expect(r.aiUsed).toBe(true);
    expect(r.fields).toMatchObject({ contactName: "Meera", eventType: "Wedding", eventDate: "2027-02-14", dateKnown: "yes", city: "Jaipur", serviceIds: [services[0].id] });
    expect(r.step).toBe("phone");
    expect(r.bot[0]).toBe("Congratulations on your upcoming wedding!");
    expect(prompt).toContain("<client_message>");
  });

  it("drops unsafe AI acknowledgements and falls back when the AI fails", async () => {
    const { studio } = await createTestStudio("Chat AI Safety");
    setAiProviderForTests(fakeAi(() => extraction({ contactName: "Ravi", acknowledgement: "Great news, your date is available and costs ₹50,000!" })));
    let r = await turn(studio.slug, EMPTY_CHAT_FIELDS, { text: "Ravi" });
    expect(r.fields.contactName).toBe("Ravi");
    expect(r.bot.join(" ")).not.toMatch(/available|₹/);

    setAiProviderForTests({ name: "fake", model: "m", generate: async () => { throw new Error("503"); } });
    r = await turn(studio.slug, r.fields, { text: "98765 11111" });
    expect(r.fields.phone).toBe("+919876511111");
  });

  it("ignores services from another studio sent by a tampered browser", async () => {
    setAiProviderForTests(null);
    const a = await createTestStudio("Chat Tamper A");
    const b = await createTestStudio("Chat Tamper B");
    let r = await turn(a.studio.slug, EMPTY_CHAT_FIELDS, { text: "Neha" });
    r = await turn(a.studio.slug, { ...r.fields, serviceIds: [b.services[0].id] }, { text: "98765 22222" });
    expect(r.fields.serviceIds).toEqual([]);
  });

  it("sends the WhatsApp confirmation automatically once the template is approved, and never duplicates it", async () => {
    setAiProviderForTests(null);
    const { studio, services } = await createTestStudio("Chat Auto WA");
    await asSystem((tx) =>
      tx
        .update(messageTemplates)
        .set({ approved: true })
        .where(and(eq(messageTemplates.studioId, studio.id), eq(messageTemplates.channel, "whatsapp"), eq(messageTemplates.purpose, "acknowledgement"))),
    );
    const fields = await completeGuided(studio.slug, services[0].id);
    const res = await submitChatEnquiry(studio.slug, { fields, formToken: issueFormToken(studio.id, Date.now() - 60_000) }, { ip: "7.6.5.4" });
    expect(res.ok && res.autoAcknowledgement).toBe("queued");
    if (!res.ok) return;
    const [queued] = await asSystem((tx) => tx.select().from(messages).where(eq(messages.leadId, res.leadId)));
    expect(queued).toMatchObject({ status: "queued", channel: "whatsapp", whatsappTemplateName: "enquiry_acknowledgement", approvedBy: null });
    expect(await processSendJob(queued.id)).toBe("sent"); // demo mode → simulated
    const [sent] = await asSystem((tx) => tx.select().from(messages).where(eq(messages.id, queued.id)));
    expect(sent.isDemo).toBe(true);

    // The default "new enquiry" automation must not draft a second acknowledgement.
    await drainJobs();
    const acks = await asSystem((tx) => tx.select().from(messages).where(and(eq(messages.leadId, res.leadId), eq(messages.purpose, "acknowledgement"))));
    expect(acks).toHaveLength(1);
    const acts = await asSystem((tx) => tx.select().from(activities).where(eq(activities.leadId, res.leadId)));
    expect(acts.map((a) => a.type)).toEqual(expect.arrayContaining(["lead_created", "auto_acknowledgement"]));
  });

  it("refuses to submit without consent", async () => {
    const { studio, services } = await createTestStudio("Chat Consent");
    const res = await submitChatEnquiry(
      studio.slug,
      { fields: { ...EMPTY_CHAT_FIELDS, contactName: "X Y", phone: "+919876500000", eventType: "Wedding", dateKnown: "no", city: "Goa", serviceIds: [services[0].id] }, formToken: issueFormToken(studio.id, Date.now() - 60_000) },
      { ip: "7.6.5.9" },
    );
    expect(res.ok).toBe(false);
  });
});
