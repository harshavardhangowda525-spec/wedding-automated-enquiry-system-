import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asSystem } from "@/server/db/client";
import { activities, consents, jobs, leads } from "@/server/db/schema";
import { issueFormToken, submitEnquiry, verifyFormToken } from "@/server/services/enquiries";
import { createTestStudio, enquiryPayload } from "../helpers";

describe("public enquiry submission", () => {
  it("persists the lead with reference, consent, activity and a durable automation event", async () => {
    const { studio, services } = await createTestStudio("Enquiry Studio");
    const res = await submitEnquiry(studio.slug, enquiryPayload(studio.id, [services[0].id, services[1].id]), { ip: "1.2.3.4", userAgent: "vitest" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.reference).toMatch(/^ENQ-[A-Z0-9]{6}$/);
    expect(res.duplicate).toBe(false);

    const [lead] = await asSystem((tx) => tx.select().from(leads).where(and(eq(leads.studioId, studio.id), eq(leads.reference, res.reference))));
    expect(lead.status).toBe("new_enquiry");
    expect(lead.phone).toMatch(/^\+9198\d{8}$/);
    expect(lead.serviceIds).toHaveLength(2);
    expect(lead.consentContact).toBe(true);

    const consentRows = await asSystem((tx) => tx.select().from(consents).where(eq(consents.leadId, lead.id)));
    expect(consentRows).toHaveLength(1);
    expect(consentRows[0].ipHash).not.toBe("1.2.3.4");

    const acts = await asSystem((tx) => tx.select().from(activities).where(eq(activities.leadId, lead.id)));
    expect(acts.map((a) => a.type)).toContain("lead_created");

    const events = await asSystem((tx) => tx.select().from(jobs).where(eq(jobs.idempotencyKey, `evt:${studio.id}:lead_created:${lead.id}`)));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("automation.dispatch");
  });

  it("rejects invalid input with field errors", async () => {
    const { studio, services } = await createTestStudio("Validation Studio");
    const res = await submitEnquiry(studio.slug, enquiryPayload(studio.id, [services[0].id], { contactName: "", phone: "12", consent: false }), { ip: "1.1.1.1" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(Object.keys(res.fieldErrors ?? {})).toEqual(expect.arrayContaining(["contactName", "consent"]));
  });

  it("requires a date unless the client says it is not decided", async () => {
    const { studio, services } = await createTestStudio("Date Studio");
    const missing = await submitEnquiry(studio.slug, enquiryPayload(studio.id, [services[0].id], { eventDate: "" }), { ip: "1.1.1.2" });
    expect(missing.ok).toBe(false);
    const undecided = await submitEnquiry(studio.slug, enquiryPayload(studio.id, [services[0].id], { eventDate: "", dateKnown: "no" }), { ip: "1.1.1.2" });
    expect(undecided.ok).toBe(true);
  });

  it("blocks honeypot, missing token and instant submissions", async () => {
    const { studio, services } = await createTestStudio("Spam Studio");
    const honeypot = await submitEnquiry(studio.slug, enquiryPayload(studio.id, [services[0].id], { website: "http://spam" }), { ip: "2.2.2.2" });
    expect(honeypot.ok).toBe(false);
    const fast = await submitEnquiry(studio.slug, enquiryPayload(studio.id, [services[0].id], { formToken: issueFormToken(studio.id) }), { ip: "2.2.2.2" });
    expect(fast.ok).toBe(false);
    const forged = await submitEnquiry(studio.slug, enquiryPayload(studio.id, [services[0].id], { formToken: `${studio.id}.123.abc` }), { ip: "2.2.2.2" });
    expect(forged.ok).toBe(false);
    expect(verifyFormToken(issueFormToken(studio.id, Date.now() - 5000), studio.id)).toBe("ok");
    expect(verifyFormToken(issueFormToken(studio.id, Date.now() - 5000), "other")).toBe("invalid");
  });

  it("detects duplicate submissions and returns the existing reference", async () => {
    const { studio, services } = await createTestStudio("Dup Studio");
    const payload = enquiryPayload(studio.id, [services[0].id]);
    const first = await submitEnquiry(studio.slug, payload, { ip: "3.3.3.3" });
    const second = await submitEnquiry(studio.slug, { ...payload, formToken: issueFormToken(studio.id, Date.now() - 5000) }, { ip: "3.3.3.3" });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.duplicate).toBe(true);
    expect(second.reference).toBe(first.reference);
    const rows = await asSystem((tx) => tx.select().from(leads).where(eq(leads.studioId, studio.id)));
    expect(rows).toHaveLength(1);
  });

  it("rate limits repeated submissions from one connection", async () => {
    const { studio, services } = await createTestStudio("Rate Studio");
    const results = [];
    for (let i = 0; i < 6; i++) {
      results.push(
        await submitEnquiry(studio.slug, enquiryPayload(studio.id, [services[0].id]), { ip: "4.4.4.4" }).catch((e: Error) => e),
      );
    }
    expect(results.slice(0, 5).every((r) => !(r instanceof Error) && r.ok)).toBe(true);
    expect(results[5]).toBeInstanceOf(Error);
  });

  it("ignores services from another studio and unknown studios", async () => {
    const a = await createTestStudio("Svc A");
    const b = await createTestStudio("Svc B");
    const res = await submitEnquiry(a.studio.slug, enquiryPayload(a.studio.id, [b.services[0].id]), { ip: "5.5.5.5" });
    expect(res.ok).toBe(false);
    const unknown = await submitEnquiry("does-not-exist", enquiryPayload(a.studio.id, [a.services[0].id]), { ip: "5.5.5.5" });
    expect(unknown.ok).toBe(false);
  });
});
