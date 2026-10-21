import { describe, expect, it } from "vitest";
import { dateInTz } from "@/lib/time";
import { getAnalytics } from "@/server/services/analytics";
import { submitEnquiry } from "@/server/services/enquiries";
import { createLeadManually, logContact } from "@/server/services/leads";
import { asMember, createTestStudio, enquiryPayload } from "../helpers";

describe("analytics", () => {
  it("is calculated from real records only and scoped to the studio", async () => {
    const { studio, owner, services } = await createTestStudio("Analytics Studio");
    const other = await createTestStudio("Other Analytics");
    await submitEnquiry(other.studio.slug, enquiryPayload(other.studio.id, [other.services[0].id]), { ip: "4.3.2.1" });

    const empty = await asMember(studio.id, owner.id, "owner", (svc) => getAnalytics(svc, { from: "2020-01-01", to: "2030-01-01" }, "Asia/Kolkata"));
    expect(empty.totalEnquiries).toBe(0);
    expect(empty.conversionRate).toBeNull();
    expect(empty.firstResponse.medianHours).toBeNull();

    await submitEnquiry(studio.slug, enquiryPayload(studio.id, [services[0].id, services[1].id]), { ip: "4.3.2.2" });
    const manual = await asMember(studio.id, owner.id, "owner", (svc) =>
      createLeadManually(svc, { contactName: "Referral Couple", phone: "9555555555", eventType: "Wedding", source: "referral" }),
    );
    await asMember(studio.id, owner.id, "owner", (svc) => logContact(svc, manual.id, { channel: "phone", outcome: "reached" }));

    const today = dateInTz(new Date(), "Asia/Kolkata");
    const a = await asMember(studio.id, owner.id, "owner", (svc) => getAnalytics(svc, { from: today, to: today }, "Asia/Kolkata"));
    expect(a.totalEnquiries).toBe(2);
    expect(a.sources.map((s) => s.source).sort()).toEqual(["referral", "website_form"]);
    expect(a.serviceDemand.reduce((n, s) => n + s.count, 0)).toBe(2);
    expect(a.firstResponse.responded).toBe(1);
    expect(a.daily).toHaveLength(1);
    expect(a.daily[0].count).toBe(2);
  });
});
