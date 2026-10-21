import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { asSystem } from "@/server/db/client";
import { aiUsage, leads, messages, quotationItems, studios } from "@/server/db/schema";
import { AiInvalidOutputError, AiUnavailableError, setAiProviderForTests, type AiProvider, type GenerateRequest } from "@/server/ai/provider";
import { draftQuotation, draftReply, findUnsupportedAmounts, suggestPriority, summarizeEnquiry } from "@/server/ai/service";
import { submitEnquiry } from "@/server/services/enquiries";
import { asMember, createTestStudio, enquiryPayload } from "../helpers";

function fakeProvider(respond: (req: GenerateRequest<unknown>) => unknown): AiProvider & { calls: GenerateRequest<unknown>[] } {
  const calls: GenerateRequest<unknown>[] = [];
  return {
    name: "fake",
    model: "fake-model",
    calls,
    async generate<T>(req: GenerateRequest<T>) {
      calls.push(req as GenerateRequest<unknown>);
      return { data: respond(req as GenerateRequest<unknown>) as T, model: "fake-model", inputTokens: 120, outputTokens: 80 };
    },
  };
}

async function setup(name: string) {
  const ctx = await createTestStudio(name);
  const res = await submitEnquiry(ctx.studio.slug, enquiryPayload(ctx.studio.id, [ctx.services[0].id, ctx.services[2].id]), { ip: `6.6.${Math.floor(Math.random() * 250)}.6` });
  if (!res.ok) throw new Error("enquiry failed");
  const [lead] = await asSystem((tx) => tx.select().from(leads).where(eq(leads.reference, res.reference)));
  return { ...ctx, lead };
}
const usageFor = (studioId: string) => asSystem((tx) => tx.select().from(aiUsage).where(eq(aiUsage.studioId, studioId)));

afterEach(() => setAiProviderForTests(undefined));

describe("AI service", () => {
  it("reports unavailability clearly when no credentials are configured", async () => {
    const { studio, owner, lead } = await setup("No AI");
    // Real resolution path: ANTHROPIC_API_KEY is empty in the test env.
    await expect(asMember(studio.id, owner.id, "owner", (svc) => summarizeEnquiry(svc, lead.id))).rejects.toBeInstanceOf(AiUnavailableError);
    await expect(asMember(studio.id, owner.id, "owner", (svc) => summarizeEnquiry(svc, lead.id))).rejects.toThrow(/not configured/);
  });

  it("respects the per-studio AI switch", async () => {
    const { studio, owner, lead } = await setup("AI Off");
    setAiProviderForTests(fakeProvider(() => ({})));
    await asSystem((tx) => tx.update(studios).set({ aiEnabled: false }).where(eq(studios.id, studio.id)));
    await expect(asMember(studio.id, owner.id, "owner", (svc) => summarizeEnquiry(svc, lead.id))).rejects.toThrow(/turned off/);
  });

  it("summarises an enquiry using only provided context and records usage", async () => {
    const { studio, owner, lead } = await setup("Summary AI");
    const provider = fakeProvider(() => ({
      summary: "Ananya and Vikram are planning a wedding in Bengaluru.",
      requestedServices: ["Candid Photography"],
      eventDetails: "Wedding on 2027-02-14 in Bengaluru",
      missingInformation: ["Venue", "Number of event days"],
      suggestedNextStep: "Call to confirm the venue",
    }));
    setAiProviderForTests(provider);
    const result = await asMember(studio.id, owner.id, "owner", (svc) => summarizeEnquiry(svc, lead.id));
    expect(result.missingInformation).toContain("Venue");
    expect(provider.calls[0].system).toMatch(/Never invent/);
    expect(provider.calls[0].prompt).toContain(lead.reference);
    const [stored] = await asSystem((tx) => tx.select().from(leads).where(eq(leads.id, lead.id)));
    expect(stored.aiSummary).toBeTruthy();
    const usage = await usageFor(studio.id);
    expect(usage.at(-1)).toMatchObject({ feature: "summarize_enquiry", status: "ok", inputTokens: 120, outputTokens: 80 });
  });

  it("rejects output that fails schema validation", async () => {
    const { studio, owner, lead } = await setup("Invalid AI");
    setAiProviderForTests(fakeProvider(() => ({ summary: 42 })));
    await expect(asMember(studio.id, owner.id, "owner", (svc) => summarizeEnquiry(svc, lead.id))).rejects.toBeInstanceOf(AiInvalidOutputError);
    expect((await usageFor(studio.id)).at(-1)?.status).toBe("invalid_output");
  });

  it("degrades gracefully when the provider fails", async () => {
    const { studio, owner, lead } = await setup("Down AI");
    setAiProviderForTests({ name: "fake", model: "m", generate: async () => { throw new Error("503 overloaded"); } });
    await expect(asMember(studio.id, owner.id, "owner", (svc) => suggestPriority(svc, lead.id))).rejects.toBeInstanceOf(AiUnavailableError);
    expect((await usageFor(studio.id)).at(-1)).toMatchObject({ status: "error" });
  });

  it("creates reply drafts that require approval and flags unsupported amounts", async () => {
    const { studio, owner, lead, services } = await setup("Draft AI");
    setAiProviderForTests(
      fakeProvider(() => ({
        subject: "",
        body: `Hi Ananya! Candid photography is ₹${(services[0].priceMinor ?? 5_000_000) / 100} per day, and we can offer a special ₹9,999 discount.`,
        factsUsed: ["event date"],
        needsStaffInput: ["Confirm availability for 14 Feb"],
      })),
    );
    const msg = await asMember(studio.id, owner.id, "owner", (svc) => draftReply(svc, lead.id, { purpose: "follow_up", channel: "whatsapp" }));
    expect(msg.status).toBe("awaiting_approval");
    expect(msg.aiGenerated).toBe(true);
    expect(msg.reviewNotes).toMatch(/₹9,999/);
    expect(msg.reviewNotes).not.toMatch(/₹50000\b/);
    expect(msg.reviewNotes).toMatch(/Confirm availability/);
    const all = await asSystem((tx) => tx.select().from(messages).where(eq(messages.leadId, lead.id)));
    expect(all.filter((m) => m.status === "sent")).toHaveLength(0);
  });

  it("drafts quotations from configured prices only", async () => {
    const { studio, owner, lead, services } = await setup("Quote AI");
    setAiProviderForTests(
      fakeProvider(() => ({
        items: [
          { serviceId: services[0].id, quantity: 2, reason: "Two event days" },
          { serviceId: "00000000-0000-0000-0000-000000000000", quantity: 1, reason: "Invented" },
        ],
        missingInformation: ["Exact number of hours"],
        notesForStaff: "Client asked for candid coverage",
      })),
    );
    const quotation = await asMember(studio.id, owner.id, "owner", (svc) => draftQuotation(svc, lead.id));
    expect(quotation.status).toBe("draft");
    expect(quotation.aiAssisted).toBe(true);
    const items = await asSystem((tx) => tx.select().from(quotationItems).where(eq(quotationItems.quotationId, quotation.id)));
    expect(items).toHaveLength(1);
    expect(items[0].unitPriceMinor).toBe(5_000_000); // from the database, not the model
    expect(quotation.subtotalMinor).toBe(10_000_000);
    expect(quotation.totalMinor).toBe(11_800_000); // + 18% GST
    expect(quotation.internalNotes).toMatch(/discarded/);
  });

  it("finds unsupported currency amounts", () => {
    expect(findUnsupportedAmounts("Price is ₹50,000 or Rs. 75000", [5_000_000])).toEqual(["Rs. 75000"]);
    expect(findUnsupportedAmounts("No prices here, see you on 14 Feb 2027", [])).toEqual([]);
  });
});
