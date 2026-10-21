import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asSystem, withStudio } from "@/server/db/client";
import { leads, studios, tasks } from "@/server/db/schema";
import { NotFoundError } from "@/server/lib/errors";
import { addNote, getLead, listLeads } from "@/server/services/leads";
import { submitEnquiry } from "@/server/services/enquiries";
import { asMember, createTestStudio, enquiryPayload, pgErrorMessage } from "../helpers";

describe("tenant isolation", () => {
  it("row-level security hides other studios' leads even without an application filter", async () => {
    const a = await createTestStudio("Studio A");
    const b = await createTestStudio("Studio B");
    const resA = await submitEnquiry(a.studio.slug, enquiryPayload(a.studio.id, [a.services[0].id]), { ip: "10.0.0.1" });
    const resB = await submitEnquiry(b.studio.slug, enquiryPayload(b.studio.id, [b.services[0].id]), { ip: "10.0.0.2" });
    expect(resA.ok && resB.ok).toBe(true);

    // Raw unfiltered select inside studio A's scope returns only studio A's rows.
    const visible = await withStudio(a.studio.id, (tx) => tx.select({ studioId: leads.studioId }).from(leads));
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.every((r) => r.studioId === a.studio.id)).toBe(true);

    const studiosVisible = await withStudio(a.studio.id, (tx) => tx.select({ id: studios.id }).from(studios));
    expect(studiosVisible.map((s) => s.id)).toEqual([a.studio.id]);
  });

  it("blocks reading, updating and inserting rows for another studio", async () => {
    const a = await createTestStudio("Iso A");
    const b = await createTestStudio("Iso B");
    const res = await submitEnquiry(b.studio.slug, enquiryPayload(b.studio.id, [b.services[0].id]), { ip: "10.0.0.3" });
    expect(res.ok).toBe(true);
    const [bLead] = await asSystem((tx) => tx.select().from(leads).where(eq(leads.studioId, b.studio.id)));

    // Service-level access with a foreign id → not found.
    await expect(asMember(a.studio.id, a.owner.id, "owner", (svc) => getLead(svc, bLead.id))).rejects.toBeInstanceOf(NotFoundError);
    await expect(asMember(a.studio.id, a.owner.id, "owner", (svc) => addNote(svc, bLead.id, "sneaky"))).rejects.toBeInstanceOf(NotFoundError);

    // Even a direct UPDATE without a studio filter affects zero rows.
    const updated = await withStudio(a.studio.id, (tx) =>
      tx.update(leads).set({ contactName: "Hacked" }).where(eq(leads.id, bLead.id)).returning({ id: leads.id }),
    );
    expect(updated).toHaveLength(0);

    // Inserting a row tagged with another studio id is rejected by the policy.
    expect(
      await pgErrorMessage(withStudio(a.studio.id, (tx) => tx.insert(tasks).values({ studioId: b.studio.id, title: "x", dueAt: new Date() }))),
    ).toMatch(/row-level security/);

    const [after] = await asSystem((tx) => tx.select().from(leads).where(eq(leads.id, bLead.id)));
    expect(after.contactName).not.toBe("Hacked");
  });

  it("the restricted role cannot read platform-only tables", async () => {
    const a = await createTestStudio("Iso C");
    expect(await pgErrorMessage(withStudio(a.studio.id, (tx) => tx.execute(sql`select * from wf.webhook_events`)))).toMatch(/permission denied/);
    expect(await pgErrorMessage(withStudio(a.studio.id, (tx) => tx.execute(sql`select * from wf.local_auth_users`)))).toMatch(/permission denied/);
  });

  it("list queries are scoped to the active studio", async () => {
    const a = await createTestStudio("List A");
    const b = await createTestStudio("List B");
    await submitEnquiry(b.studio.slug, enquiryPayload(b.studio.id, [b.services[0].id]), { ip: "10.0.0.4" });
    const result = await asMember(a.studio.id, a.owner.id, "owner", (svc) => listLeads(svc, {}));
    expect(result.total).toBe(0);
  });
});
