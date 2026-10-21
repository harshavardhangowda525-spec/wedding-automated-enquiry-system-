import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asSystem } from "@/server/db/client";
import { activities, calendarEntries, leads, studios } from "@/server/db/schema";
import { ForbiddenError, ValidationError } from "@/server/lib/errors";
import { createCalendarEntry, getAvailability, setDateAvailability } from "@/server/services/calendar";
import { submitEnquiry } from "@/server/services/enquiries";
import {
  addNote,
  assignLead,
  bulkUpdateLeads,
  changeLeadStatus,
  createLeadManually,
  exportLeadsCsv,
  recordDeposit,
  updateLead,
} from "@/server/services/leads";
import { createQuotation, quotationDefaults, setQuotationStatus } from "@/server/services/quotations";
import { createTask, listTasks, setTaskStatus } from "@/server/services/tasks";
import { addMember, asMember, createTestStudio, enquiryPayload } from "../helpers";

async function setup(name: string) {
  const ctx = await createTestStudio(name);
  const res = await submitEnquiry(ctx.studio.slug, enquiryPayload(ctx.studio.id, [ctx.services[0].id]), { ip: `5.4.${Math.floor(Math.random() * 250)}.3` });
  if (!res.ok) throw new Error("enquiry failed");
  const [lead] = await asSystem((tx) => tx.select().from(leads).where(eq(leads.reference, res.reference)));
  return { ...ctx, lead };
}
const reload = async (id: string) => (await asSystem((tx) => tx.select().from(leads).where(eq(leads.id, id))))[0];

describe("lead management", () => {
  it("persists status changes with activity history and validates transitions", async () => {
    const { studio, owner, lead } = await setup("Status Studio");
    await asMember(studio.id, owner.id, "owner", (svc) => changeLeadStatus(svc, lead.id, { status: "contacted" }));
    expect((await reload(lead.id)).status).toBe("contacted");
    await expect(asMember(studio.id, owner.id, "owner", (svc) => changeLeadStatus(svc, lead.id, { status: "won" }))).rejects.toBeInstanceOf(ValidationError);
    await expect(asMember(studio.id, owner.id, "owner", (svc) => changeLeadStatus(svc, lead.id, { status: "lost" }))).rejects.toThrow(/reason/);
    const acts = await asSystem((tx) => tx.select().from(activities).where(and(eq(activities.leadId, lead.id), eq(activities.type, "status_changed"))));
    expect(acts).toHaveLength(1);
    expect(acts[0].summary).toMatch(/New Enquiry to Contacted/);
  });

  it("records field edits, notes and assignment in the timeline", async () => {
    const { studio, owner, lead } = await setup("Edit Studio");
    const staff = await addMember(studio.id, "staff");
    await asMember(studio.id, owner.id, "owner", async (svc) => {
      await updateLead(svc, lead.id, { venue: "Leela Palace", priority: "high", nextAction: "Send portfolio" });
      await addNote(svc, lead.id, "Prefers candid style");
      await assignLead(svc, lead.id, staff.id);
    });
    const l = await reload(lead.id);
    expect(l).toMatchObject({ venue: "Leela Palace", priority: "high", assignedTo: staff.id });
    const types = (await asSystem((tx) => tx.select().from(activities).where(eq(activities.leadId, lead.id)))).map((a) => a.type);
    expect(types).toEqual(expect.arrayContaining(["lead_updated", "note", "assigned"]));
  });

  it("only confirms a booking when the studio's conditions are met, and blocks double-booking", async () => {
    const { studio, owner, lead } = await setup("Booking Studio");
    await asMember(studio.id, owner.id, "owner", (svc) => changeLeadStatus(svc, lead.id, { status: "negotiation" }));
    await expect(asMember(studio.id, owner.id, "owner", (svc) => changeLeadStatus(svc, lead.id, { status: "booking_confirmed" }))).rejects.toThrow(/accepted quotation/);

    // Accepted quotation alone is not enough: deposit is also required by default.
    await asMember(studio.id, owner.id, "owner", async (svc) => {
      const { defaults } = await quotationDefaults(svc, lead.id);
      const q = await createQuotation(svc, lead.id, { ...defaults, items: [{ description: "Candid", quantity: 1, unitPriceMinor: 10_000_000 }] });
      await setQuotationStatus(svc, q.id, "approved");
      await setQuotationStatus(svc, q.id, "sent");
      await setQuotationStatus(svc, q.id, "accepted");
    });
    expect((await reload(lead.id)).status).toBe("negotiation"); // acceptance never auto-confirms
    await expect(asMember(studio.id, owner.id, "owner", (svc) => changeLeadStatus(svc, lead.id, { status: "booking_confirmed" }))).rejects.toThrow(/deposit/);
    await asMember(studio.id, owner.id, "owner", (svc) => recordDeposit(svc, lead.id, 3_000_000));
    await asMember(studio.id, owner.id, "owner", (svc) => changeLeadStatus(svc, lead.id, { status: "booking_confirmed" }));
    const booked = await reload(lead.id);
    expect(booked.status).toBe("booking_confirmed");
    const entries = await asSystem((tx) => tx.select().from(calendarEntries).where(eq(calendarEntries.leadId, lead.id)));
    expect(entries.some((e) => e.type === "confirmed_booking" && e.entryDate === lead.eventDate)).toBe(true);

    // A second lead on the same date cannot be confirmed (capacity 1 per day).
    const other = await submitEnquiry(studio.slug, enquiryPayload(studio.id, [lead.serviceIds[0]], { eventDate: lead.eventDate }), { ip: "5.5.5.9" });
    if (!other.ok) throw new Error("failed");
    const [l2] = await asSystem((tx) => tx.select().from(leads).where(eq(leads.reference, other.reference)));
    await asSystem((tx) => tx.update(studios).set({ settings: { booking: { requireAcceptedQuotation: false, requireDepositRecorded: false, maxBookingsPerDay: 1 } } }).where(eq(studios.id, studio.id)));
    await asMember(studio.id, owner.id, "owner", (svc) => changeLeadStatus(svc, l2.id, { status: "tentative_hold" }));
    await expect(asMember(studio.id, owner.id, "owner", (svc) => changeLeadStatus(svc, l2.id, { status: "booking_confirmed" }))).rejects.toThrow(/fully booked/);
  });

  it("derives availability only from recorded data", async () => {
    const { studio, owner } = await createTestStudio("Avail Studio");
    await asMember(studio.id, owner.id, "owner", async (svc) => {
      expect((await getAvailability(svc.tx, studio.id, "2027-03-01")).state).toBe("not_checked");
      await setDateAvailability(svc, "2027-03-01", "available");
      expect((await getAvailability(svc.tx, studio.id, "2027-03-01")).state).toBe("available");
      const { warning } = await createCalendarEntry(svc, { type: "tentative_hold", title: "Hold", entryDate: "2027-03-01" });
      expect(warning).toBeNull();
      expect((await getAvailability(svc.tx, studio.id, "2027-03-01")).state).toBe("tentative_hold");
      const second = await createCalendarEntry(svc, { type: "tentative_hold", title: "Hold 2", entryDate: "2027-03-01" });
      expect(second.warning).toMatch(/tentative hold/);
      await createCalendarEntry(svc, { type: "confirmed_booking", title: "Booked", entryDate: "2027-03-01" });
      expect((await getAvailability(svc.tx, studio.id, "2027-03-01")).state).toBe("confirmed_booking");
    });
  });

  it("bulk operations apply valid changes and report skipped leads", async () => {
    const { studio, owner, lead } = await setup("Bulk Studio");
    const manual = await asMember(studio.id, owner.id, "owner", (svc) =>
      createLeadManually(svc, { contactName: "Rahul", phone: "9123456780", eventType: "Engagement", source: "referral" }),
    );
    await asMember(studio.id, owner.id, "owner", (svc) => changeLeadStatus(svc, manual.id, { status: "lost", lostReason: "Budget" }));
    const result = await asMember(studio.id, owner.id, "owner", (svc) => bulkUpdateLeads(svc, [lead.id, manual.id], { action: "status", status: "qualified" }));
    expect(result.updated).toBe(2); // lost → qualified (reopen) and new → qualified are both allowed
    const res2 = await asMember(studio.id, owner.id, "owner", (svc) => bulkUpdateLeads(svc, [lead.id, manual.id], { action: "status", status: "won" }));
    expect(res2.updated).toBe(0);
    expect(res2.skipped).toHaveLength(2);
  });

  it("tasks can be created, listed and completed", async () => {
    const { studio, owner, lead } = await setup("Task CRUD");
    const task = await asMember(studio.id, owner.id, "owner", (svc) => createTask(svc, { title: "Send portfolio", dueAt: new Date(Date.now() - 1000), leadId: lead.id }));
    const overdue = await asMember(studio.id, owner.id, "owner", (svc) => listTasks(svc, { scope: "overdue" }));
    expect(overdue.map((t) => t.id)).toContain(task.id);
    await asMember(studio.id, owner.id, "owner", (svc) => setTaskStatus(svc, task.id, "done"));
    const open = await asMember(studio.id, owner.id, "owner", (svc) => listTasks(svc, { scope: "open" }));
    expect(open.map((t) => t.id)).not.toContain(task.id);
  });
});

describe("authorization", () => {
  it("viewers cannot modify leads; staff cannot export; admins can export with an audit record", async () => {
    const { studio, lead } = await setup("Roles Studio");
    const viewer = await addMember(studio.id, "viewer");
    const staff = await addMember(studio.id, "staff");
    const admin = await addMember(studio.id, "admin");
    await expect(asMember(studio.id, viewer.id, "viewer", (svc) => addNote(svc, lead.id, "hi"))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(asMember(studio.id, viewer.id, "viewer", (svc) => changeLeadStatus(svc, lead.id, { status: "contacted" }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(asMember(studio.id, staff.id, "staff", (svc) => exportLeadsCsv(svc, {}, {}))).rejects.toBeInstanceOf(ForbiddenError);
    const { csv, count } = await asMember(studio.id, admin.id, "admin", (svc) => exportLeadsCsv(svc, {}, {}));
    expect(count).toBe(1);
    expect(csv.split("\n")[0]).toMatch(/^reference,status/);
  });

  it("neutralises spreadsheet formula injection in exports", async () => {
    const { studio, owner } = await createTestStudio("CSV Studio");
    await asMember(studio.id, owner.id, "owner", (svc) =>
      createLeadManually(svc, { contactName: "=HYPERLINK(\"x\")", phone: "9000000001", eventType: "Wedding", source: "phone" }),
    );
    const { csv } = await asMember(studio.id, owner.id, "owner", (svc) => exportLeadsCsv(svc, {}, {}));
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });
});
