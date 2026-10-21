import "server-only";
import { and, arrayContains, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  CLOSED_STATUSES,
  EVENT_TYPES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  PREFERRED_CHANNELS,
  PRIORITIES,
  canTransition,
  roleAtLeast,
  type LeadStatus,
} from "@/lib/domain";
import { formatMoney } from "@/lib/money";
import { normalizePhone } from "@/lib/phone";
import { parseStudioSettings } from "@/lib/studio-settings";
import type { ServiceContext } from "@/server/auth/context";
import type { Queryable, Tx } from "@/server/db/client";
import {
  activities,
  calendarEntries,
  consents,
  leads,
  messages,
  profiles,
  quotations,
  studioMembers,
  studios,
} from "@/server/db/schema";
import { emitEvent } from "@/server/jobs/queue";
import { randomCode } from "@/server/lib/crypto";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/lib/errors";
import { audit, recordActivity } from "./activity";
import { getAvailability } from "./calendar";

export type Lead = typeof leads.$inferSelect;

function requireWriter(svc: ServiceContext) {
  if (svc.role !== "system" && !roleAtLeast(svc.role, "staff")) throw new ForbiddenError();
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));
const optionalDate = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined))
  .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), "Use YYYY-MM-DD");

// ---------------------------------------------------------------- references

export async function generateReference(q: Queryable, studioId: string): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const candidate = `ENQ-${randomCode(6)}`;
    const [hit] = await q.select({ id: leads.id }).from(leads).where(and(eq(leads.studioId, studioId), eq(leads.reference, candidate)));
    if (!hit) return candidate;
  }
  throw new AppError("Could not generate a unique reference");
}

// ---------------------------------------------------------------- listing

export const leadFiltersSchema = z.object({
  q: optionalText(120),
  status: z.array(z.enum(LEAD_STATUSES)).optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assignedTo: z.union([z.string().uuid(), z.literal("unassigned")]).optional(),
  tag: optionalText(40),
  eventFrom: optionalDate,
  eventTo: optionalDate,
  view: z.enum(["open", "closed", "all"]).default("all"),
  sort: z.enum(["newest", "oldest", "event_date", "last_activity"]).default("newest"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(200).default(25),
});
export type LeadFilters = z.infer<typeof leadFiltersSchema>;

function filterWhere(studioId: string, f: LeadFilters): SQL {
  const parts: (SQL | undefined)[] = [eq(leads.studioId, studioId)];
  if (f.q) {
    const term = `%${f.q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    parts.push(
      or(
        ilike(leads.contactName, term),
        ilike(leads.partnerName, term),
        ilike(leads.phone, term),
        ilike(leads.email, term),
        ilike(leads.reference, term),
        ilike(leads.city, term),
        ilike(leads.venue, term),
      ),
    );
  }
  if (f.status?.length) parts.push(inArray(leads.status, f.status));
  else if (f.view === "open") parts.push(sql`${leads.status} not in ('booking_confirmed','won','lost','not_interested')`);
  else if (f.view === "closed") parts.push(inArray(leads.status, CLOSED_STATUSES));
  if (f.source) parts.push(eq(leads.source, f.source));
  if (f.priority) parts.push(eq(leads.priority, f.priority));
  if (f.assignedTo === "unassigned") parts.push(isNull(leads.assignedTo));
  else if (f.assignedTo) parts.push(eq(leads.assignedTo, f.assignedTo));
  if (f.tag) parts.push(arrayContains(leads.tags, [f.tag]));
  if (f.eventFrom) parts.push(gte(leads.eventDate, f.eventFrom));
  if (f.eventTo) parts.push(lte(leads.eventDate, f.eventTo));
  return and(...parts)!;
}

export async function listLeads(svc: ServiceContext, filters: Partial<LeadFilters>) {
  const f = leadFiltersSchema.parse(filters);
  const where = filterWhere(svc.studioId, f);
  const order =
    f.sort === "oldest"
      ? [asc(leads.createdAt)]
      : f.sort === "event_date"
        ? [sql`${leads.eventDate} asc nulls last`, desc(leads.createdAt)]
        : f.sort === "last_activity"
          ? [desc(leads.lastActivityAt)]
          : [desc(leads.createdAt)];
  const [rows, [{ total }]] = await Promise.all([
    svc.tx
      .select({
        id: leads.id,
        reference: leads.reference,
        contactName: leads.contactName,
        partnerName: leads.partnerName,
        phone: leads.phone,
        email: leads.email,
        eventType: leads.eventType,
        eventDate: leads.eventDate,
        city: leads.city,
        status: leads.status,
        priority: leads.priority,
        source: leads.source,
        tags: leads.tags,
        assignedTo: leads.assignedTo,
        assigneeName: profiles.fullName,
        assigneeEmail: profiles.email,
        nextAction: leads.nextAction,
        nextActionAt: leads.nextActionAt,
        quotationAmountMinor: leads.quotationAmountMinor,
        lastContactedAt: leads.lastContactedAt,
        lastActivityAt: leads.lastActivityAt,
        optedOut: leads.optedOut,
        isDemo: leads.isDemo,
        possibleDuplicateOf: leads.possibleDuplicateOf,
        createdAt: leads.createdAt,
      })
      .from(leads)
      .leftJoin(profiles, eq(profiles.id, leads.assignedTo))
      .where(where)
      .orderBy(...order)
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize),
    svc.tx.select({ total: count() }).from(leads).where(where),
  ]);
  return { rows, total: Number(total), page: f.page, pageSize: f.pageSize };
}

export type LeadListRow = Awaited<ReturnType<typeof listLeads>>["rows"][number];

export async function getLead(svc: Pick<ServiceContext, "tx" | "studioId">, id: string): Promise<Lead> {
  if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Lead");
  const [lead] = await svc.tx.select().from(leads).where(and(eq(leads.id, id), eq(leads.studioId, svc.studioId)));
  if (!lead) throw new NotFoundError("Lead");
  return lead;
}

export async function getLeadTimeline(svc: ServiceContext, leadId: string) {
  return svc.tx
    .select({
      id: activities.id,
      type: activities.type,
      summary: activities.summary,
      actorType: activities.actorType,
      actorName: profiles.fullName,
      actorEmail: profiles.email,
      data: activities.data,
      createdAt: activities.createdAt,
    })
    .from(activities)
    .leftJoin(profiles, eq(profiles.id, activities.actorId))
    .where(and(eq(activities.studioId, svc.studioId), eq(activities.leadId, leadId)))
    .orderBy(desc(activities.createdAt))
    .limit(200);
}

export async function listMembers(svc: Pick<ServiceContext, "tx" | "studioId">) {
  return svc.tx
    .select({ userId: studioMembers.userId, role: studioMembers.role, fullName: profiles.fullName, email: profiles.email })
    .from(studioMembers)
    .innerJoin(profiles, eq(profiles.id, studioMembers.userId))
    .where(eq(studioMembers.studioId, svc.studioId))
    .orderBy(asc(profiles.fullName));
}

// ---------------------------------------------------------------- creation (staff)

export const manualLeadSchema = z.object({
  contactName: z.string().trim().min(2, "Name is required").max(120),
  partnerName: optionalText(120),
  countryCode: z.string().default("+91"),
  phone: z.string().trim().min(5, "Phone is required").max(30),
  email: z
    .string()
    .trim()
    .email()
    .max(200)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  eventType: z.enum(EVENT_TYPES),
  eventDate: optionalDate,
  city: optionalText(120),
  venue: optionalText(200),
  serviceIds: z.array(z.string().uuid()).default([]),
  budgetRange: optionalText(80),
  message: optionalText(4000),
  source: z.enum(LEAD_SOURCES),
  sourceDetail: optionalText(200),
  preferredChannel: z.enum(PREFERRED_CHANNELS).default("any"),
  consentContact: z.boolean().default(false),
});

export async function createLeadManually(svc: ServiceContext, input: z.input<typeof manualLeadSchema>) {
  requireWriter(svc);
  const data = manualLeadSchema.parse(input);
  const phone = normalizePhone(data.countryCode, data.phone);
  if (!phone) throw new ValidationError("Enter a valid phone number", { phone: ["Enter a valid phone number"] });
  const reference = await generateReference(svc.tx, svc.studioId);
  const [existing] = await svc.tx
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.studioId, svc.studioId), eq(leads.phone, phone)))
    .orderBy(desc(leads.createdAt))
    .limit(1);
  const [lead] = await svc.tx
    .insert(leads)
    .values({
      studioId: svc.studioId,
      reference,
      contactName: data.contactName,
      partnerName: data.partnerName ?? null,
      phone,
      email: data.email?.toLowerCase() ?? null,
      eventType: data.eventType,
      eventDate: data.eventDate ?? null,
      city: data.city ?? null,
      venue: data.venue ?? null,
      serviceIds: data.serviceIds,
      budgetRange: data.budgetRange ?? null,
      message: data.message ?? null,
      source: data.source,
      sourceDetail: data.sourceDetail ?? null,
      preferredChannel: data.preferredChannel,
      consentContact: data.consentContact,
      consentAt: data.consentContact ? new Date() : null,
      possibleDuplicateOf: existing?.id ?? null,
      assignedTo: svc.userId,
    })
    .returning();
  if (data.consentContact) {
    await svc.tx.insert(consents).values({
      studioId: svc.studioId,
      leadId: lead.id,
      kind: "contact",
      granted: true,
      text: "Verbal/recorded consent to be contacted, entered by studio staff.",
      source: `staff:${svc.userId}`,
    });
  }
  await recordActivity(svc, {
    leadId: lead.id,
    type: "lead_created",
    summary: `Lead added manually (${data.source.replace("_", " ")})`,
    data: { reference, possibleDuplicateOf: existing?.id ?? null },
  });
  await emitEvent(svc.tx, svc.studioId, { trigger: "lead_created", leadId: lead.id, key: `lead_created:${lead.id}` });
  return lead;
}

// ---------------------------------------------------------------- updates

export const leadUpdateSchema = z.object({
  contactName: z.string().trim().min(2).max(120).optional(),
  partnerName: z.string().trim().max(120).nullable().optional(),
  email: z.string().trim().email().max(200).nullable().optional().or(z.literal("").transform(() => null)),
  eventType: z.enum(EVENT_TYPES).optional(),
  eventDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  city: z.string().trim().max(120).nullable().optional(),
  venue: z.string().trim().max(200).nullable().optional(),
  budgetRange: z.string().trim().max(80).nullable().optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  priority: z.enum(PRIORITIES).nullable().optional(),
  nextAction: z.string().trim().max(300).nullable().optional(),
  nextActionAt: z.coerce.date().nullable().optional(),
  quotationAmountMinor: z.number().int().min(0).nullable().optional(),
  serviceIds: z.array(z.string().uuid()).optional(),
  preferredChannel: z.enum(PREFERRED_CHANNELS).optional(),
});

const FIELD_LABELS: Record<string, string> = {
  contactName: "name",
  partnerName: "partner name",
  email: "email",
  eventType: "event type",
  eventDate: "event date",
  city: "city",
  venue: "venue",
  budgetRange: "budget",
  source: "source",
  priority: "priority",
  nextAction: "next action",
  nextActionAt: "next action date",
  quotationAmountMinor: "quotation amount",
  serviceIds: "services",
  preferredChannel: "preferred channel",
};

export async function updateLead(svc: ServiceContext, id: string, input: z.input<typeof leadUpdateSchema>) {
  requireWriter(svc);
  const lead = await getLead(svc, id);
  const patch = leadUpdateSchema.parse(input);
  const changed: string[] = [];
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const before = (lead as Record<string, unknown>)[key];
    const same =
      before instanceof Date && value instanceof Date
        ? before.getTime() === value.getTime()
        : JSON.stringify(before ?? null) === JSON.stringify(value ?? null);
    if (!same) {
      changed.push(FIELD_LABELS[key] ?? key);
      diff[key] = { from: before ?? null, to: value ?? null };
    }
  }
  if (changed.length === 0) return lead;
  const [updated] = await svc.tx
    .update(leads)
    .set({ ...patch, updatedAt: new Date(), ...(patch.priority !== undefined ? { priorityReason: patch.priority ? "Set by staff" : null } : {}) })
    .where(and(eq(leads.id, id), eq(leads.studioId, svc.studioId)))
    .returning();
  await recordActivity(svc, { leadId: id, type: "lead_updated", summary: `Updated ${changed.join(", ")}`, data: { diff } });
  return updated;
}

export const statusChangeSchema = z.object({
  status: z.enum(LEAD_STATUSES),
  lostReason: optionalText(300),
  note: optionalText(1000),
});

export type BookingCheck = { ok: boolean; problems: string[] };

/** Whether a lead meets the studio's configured conditions for a confirmed booking. */
export async function checkBookingConditions(q: Queryable, lead: Lead): Promise<BookingCheck> {
  const [studio] = await q.select({ settings: studios.settings }).from(studios).where(eq(studios.id, lead.studioId));
  const rules = parseStudioSettings(studio?.settings).booking;
  const problems: string[] = [];
  if (!lead.eventDate) problems.push("Add the event date before confirming the booking.");
  else {
    const availability = await getAvailability(q, lead.studioId, lead.eventDate, lead.id);
    if (availability.state === "confirmed_booking") problems.push(`The date ${lead.eventDate} is already fully booked.`);
    if (availability.state === "unavailable") problems.push(`The date ${lead.eventDate} is marked unavailable.`);
  }
  if (rules.requireAcceptedQuotation) {
    const [accepted] = await q
      .select({ id: quotations.id })
      .from(quotations)
      .where(and(eq(quotations.leadId, lead.id), eq(quotations.studioId, lead.studioId), eq(quotations.status, "accepted")))
      .limit(1);
    if (!accepted) problems.push("An accepted quotation is required (studio setting).");
  }
  if (rules.requireDepositRecorded && !lead.depositRecordedAt) problems.push("Record the deposit before confirming (studio setting).");
  if (lead.optedOut) problems.push("This client has opted out of communication; confirm directly with them first.");
  return { ok: problems.length === 0, problems };
}

export async function changeLeadStatus(svc: ServiceContext, id: string, input: z.input<typeof statusChangeSchema>) {
  requireWriter(svc);
  const data = statusChangeSchema.parse(input);
  const lead = await getLead(svc, id);
  const to = data.status as LeadStatus;
  if (!canTransition(lead.status, to)) {
    throw new ValidationError(`A lead cannot move from ${LEAD_STATUS_LABELS[lead.status]} to ${LEAD_STATUS_LABELS[to]}.`);
  }
  if ((to === "lost" || to === "not_interested") && !data.lostReason) {
    throw new ValidationError("Please record a reason", { lostReason: ["Required"] });
  }
  if (to === "booking_confirmed") {
    const check = await checkBookingConditions(svc.tx, lead);
    if (!check.ok) throw new ValidationError(check.problems.join(" "), { status: check.problems });
  }

  const [updated] = await svc.tx
    .update(leads)
    .set({
      status: to,
      lostReason: to === "lost" || to === "not_interested" ? data.lostReason ?? null : lead.lostReason,
      revenueMinor: to === "won" || to === "booking_confirmed" ? (lead.revenueMinor ?? lead.quotationAmountMinor) : lead.revenueMinor,
      updatedAt: new Date(),
    })
    .where(and(eq(leads.id, id), eq(leads.studioId, svc.studioId)))
    .returning();

  const activityId = crypto.randomUUID();
  await recordActivity(svc, {
    leadId: id,
    type: "status_changed",
    summary: `Status changed from ${LEAD_STATUS_LABELS[lead.status]} to ${LEAD_STATUS_LABELS[to]}${data.lostReason ? ` – ${data.lostReason}` : ""}`,
    data: { from: lead.status, to, note: data.note ?? null, lostReason: data.lostReason ?? null, changeId: activityId },
  });

  if (to === "tentative_hold" && lead.eventDate) await ensureCalendarEntry(svc, lead, "tentative_hold");
  if (to === "booking_confirmed" && lead.eventDate) {
    await svc.tx
      .delete(calendarEntries)
      .where(and(eq(calendarEntries.leadId, id), eq(calendarEntries.studioId, svc.studioId), eq(calendarEntries.type, "tentative_hold")));
    await ensureCalendarEntry(svc, lead, "confirmed_booking");
  }
  if ((to === "lost" || to === "not_interested") && lead.eventDate) {
    await svc.tx
      .delete(calendarEntries)
      .where(and(eq(calendarEntries.leadId, id), eq(calendarEntries.studioId, svc.studioId), eq(calendarEntries.type, "tentative_hold")));
  }
  if (CLOSED_STATUSES.includes(to)) {
    await cancelPendingOutbound(svc.tx, svc.studioId, id, `Lead moved to ${LEAD_STATUS_LABELS[to]}`);
  }

  const depth = svc.actorType === "automation" ? 1 : 0;
  await emitEvent(svc.tx, svc.studioId, {
    trigger: "lead_status_changed",
    leadId: id,
    key: `status:${id}:${activityId}`,
    data: { from: lead.status, to },
    depth,
  });
  if (to === "booking_confirmed") {
    await emitEvent(svc.tx, svc.studioId, { trigger: "booking_confirmed", leadId: id, key: `booking_confirmed:${id}:${activityId}`, depth });
  }
  return updated;
}

async function ensureCalendarEntry(svc: ServiceContext, lead: Lead, type: "tentative_hold" | "confirmed_booking") {
  const [existing] = await svc.tx
    .select({ id: calendarEntries.id })
    .from(calendarEntries)
    .where(and(eq(calendarEntries.leadId, lead.id), eq(calendarEntries.type, type), eq(calendarEntries.entryDate, lead.eventDate!)));
  if (existing) return;
  await svc.tx.insert(calendarEntries).values({
    studioId: svc.studioId,
    leadId: lead.id,
    type,
    title: `${type === "confirmed_booking" ? "Booked" : "Hold"}: ${lead.contactName}${lead.partnerName ? ` & ${lead.partnerName}` : ""} – ${lead.eventType}`,
    entryDate: lead.eventDate!,
    createdBy: svc.userId,
  });
}

/** Cancels queued / awaiting-approval / draft outbound messages for a lead. */
export async function cancelPendingOutbound(tx: Tx, studioId: string, leadId: string, reason: string): Promise<number> {
  const cancelled = await tx
    .update(messages)
    .set({ status: "cancelled", skipReason: reason, updatedAt: new Date() })
    .where(
      and(
        eq(messages.studioId, studioId),
        eq(messages.leadId, leadId),
        eq(messages.direction, "outbound"),
        inArray(messages.status, ["draft", "awaiting_approval", "queued"]),
      ),
    )
    .returning({ id: messages.id });
  return cancelled.length;
}

export async function assignLead(svc: ServiceContext, id: string, userId: string | null) {
  requireWriter(svc);
  const lead = await getLead(svc, id);
  let name = "nobody";
  if (userId) {
    const [member] = await svc.tx
      .select({ userId: studioMembers.userId, fullName: profiles.fullName, email: profiles.email })
      .from(studioMembers)
      .innerJoin(profiles, eq(profiles.id, studioMembers.userId))
      .where(and(eq(studioMembers.studioId, svc.studioId), eq(studioMembers.userId, userId)));
    if (!member) throw new ValidationError("That person is not a member of this studio");
    name = member.fullName ?? member.email;
  }
  if (lead.assignedTo === userId) return lead;
  const [updated] = await svc.tx.update(leads).set({ assignedTo: userId, updatedAt: new Date() }).where(eq(leads.id, id)).returning();
  await recordActivity(svc, { leadId: id, type: "assigned", summary: `Assigned to ${name}`, data: { from: lead.assignedTo, to: userId } });
  return updated;
}

export async function addNote(svc: ServiceContext, id: string, body: string) {
  requireWriter(svc);
  const text = z.string().trim().min(1, "Note cannot be empty").max(4000).parse(body);
  await getLead(svc, id);
  await recordActivity(svc, { leadId: id, type: "note", summary: text });
}

export async function setTags(svc: ServiceContext, id: string, tags: string[]) {
  requireWriter(svc);
  const clean = [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
  if (clean.some((t) => t.length > 40)) throw new ValidationError("Tags must be 40 characters or fewer");
  const lead = await getLead(svc, id);
  if (JSON.stringify([...lead.tags].sort()) === JSON.stringify([...clean].sort())) return lead;
  const [updated] = await svc.tx.update(leads).set({ tags: clean, updatedAt: new Date() }).where(eq(leads.id, id)).returning();
  await recordActivity(svc, { leadId: id, type: "tags_changed", summary: clean.length ? `Tags: ${clean.join(", ")}` : "Tags cleared", data: { from: lead.tags, to: clean } });
  return updated;
}

export const contactLogSchema = z.object({
  channel: z.enum(["phone", "whatsapp", "email", "in_person", "instagram"]),
  outcome: z.enum(["reached", "no_answer", "left_message"]),
  summary: optionalText(2000),
});

/** Records a manual contact attempt (phone calls, personal WhatsApp etc.). */
export async function logContact(svc: ServiceContext, id: string, input: z.input<typeof contactLogSchema>) {
  requireWriter(svc);
  const data = contactLogSchema.parse(input);
  const lead = await getLead(svc, id);
  const now = new Date();
  const reached = data.outcome === "reached";
  await svc.tx
    .update(leads)
    .set({
      lastContactedAt: reached ? now : lead.lastContactedAt,
      firstContactedAt: reached ? (lead.firstContactedAt ?? now) : lead.firstContactedAt,
      updatedAt: now,
    })
    .where(eq(leads.id, id));
  await recordActivity(svc, {
    leadId: id,
    type: "contact_logged",
    summary: `${data.channel.replace("_", " ")} – ${data.outcome.replace("_", " ")}${data.summary ? `: ${data.summary}` : ""}`,
    data,
  });
  if (lead.status === "new_enquiry") {
    await changeLeadStatus(svc, id, { status: reached ? "contacted" : "contact_attempted" });
  } else if (lead.status === "contact_attempted" && reached) {
    await changeLeadStatus(svc, id, { status: "contacted" });
  }
}

export async function recordDeposit(svc: ServiceContext, id: string, amountMinor: number) {
  requireWriter(svc);
  const amount = z.number().int().positive("Enter the deposit amount").parse(amountMinor);
  const lead = await getLead(svc, id);
  const [studio] = await svc.tx.select({ currency: studios.currency }).from(studios).where(eq(studios.id, svc.studioId));
  await svc.tx.update(leads).set({ depositRecordedAt: new Date(), depositAmountMinor: amount, updatedAt: new Date() }).where(eq(leads.id, id));
  await recordActivity(svc, { leadId: id, type: "deposit_recorded", summary: `Deposit of ${formatMoney(amount, studio?.currency)} recorded`, data: { amountMinor: amount, previous: lead.depositAmountMinor } });
}

/** Records an opt-out from any source and stops all pending outbound communication. */
export async function optOutLead(svc: Pick<ServiceContext, "tx" | "studioId" | "userId" | "actorType">, id: string, source: string) {
  const lead = await getLead(svc, id);
  if (lead.optedOut) return lead;
  const now = new Date();
  const [updated] = await svc.tx.update(leads).set({ optedOut: true, optedOutAt: now, updatedAt: now }).where(eq(leads.id, id)).returning();
  await svc.tx.insert(consents).values({ studioId: svc.studioId, leadId: id, kind: "contact", granted: false, text: "Opted out of communication", source });
  const cancelled = await cancelPendingOutbound(svc.tx, svc.studioId, id, "Client opted out");
  await recordActivity(svc, { leadId: id, type: "opt_out", summary: `Client opted out (${source}); ${cancelled} pending message(s) cancelled`, data: { source } });
  await emitEvent(svc.tx, svc.studioId, { trigger: "client_opted_out", leadId: id, key: `opt_out:${id}:${now.getTime()}` });
  return updated;
}

export async function optInLead(svc: ServiceContext, id: string, note: string) {
  requireWriter(svc);
  const text = z.string().trim().min(5, "Describe how the client re-confirmed consent").max(500).parse(note);
  await getLead(svc, id);
  const now = new Date();
  await svc.tx.update(leads).set({ optedOut: false, optedOutAt: null, consentContact: true, consentAt: now, updatedAt: now }).where(eq(leads.id, id));
  await svc.tx.insert(consents).values({ studioId: svc.studioId, leadId: id, kind: "contact", granted: true, text, source: `staff:${svc.userId}` });
  await recordActivity(svc, { leadId: id, type: "opt_in", summary: `Consent re-recorded by staff: ${text}` });
}

// ---------------------------------------------------------------- bulk & export

export const bulkActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status"), status: z.enum(LEAD_STATUSES), lostReason: optionalText(300) }),
  z.object({ action: z.literal("assign"), userId: z.string().uuid().nullable() }),
  z.object({ action: z.literal("add_tag"), tag: z.string().trim().min(1).max(40) }),
]);

export async function bulkUpdateLeads(svc: ServiceContext, ids: string[], input: z.input<typeof bulkActionSchema>) {
  requireWriter(svc);
  const action = bulkActionSchema.parse(input);
  const unique = [...new Set(z.array(z.string().uuid()).max(200).parse(ids))];
  let updated = 0;
  const skipped: { id: string; reason: string }[] = [];
  for (const id of unique) {
    try {
      // Savepoint per lead so one invalid transition does not abort the rest.
      await svc.tx.transaction(async (inner) => {
        const s = { ...svc, tx: inner };
        if (action.action === "status") await changeLeadStatus(s, id, { status: action.status, lostReason: action.lostReason });
        else if (action.action === "assign") await assignLead(s, id, action.userId);
        else {
          const lead = await getLead(s, id);
          await setTags(s, id, [...lead.tags, action.tag]);
        }
      });
      updated++;
    } catch (err) {
      skipped.push({ id, reason: err instanceof Error ? err.message : "Failed" });
    }
  }
  return { updated, skipped };
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.join("; ") : String(value);
  // Prevent spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function exportLeadsCsv(svc: ServiceContext, filters: Partial<LeadFilters>, meta: { ipHash?: string | null }) {
  if (svc.role === "system" || !roleAtLeast(svc.role, "admin")) throw new ForbiddenError("Only studio owners and admins can export leads");
  const f = leadFiltersSchema.parse({ ...filters, page: 1, pageSize: 200 });
  const where = filterWhere(svc.studioId, f);
  const rows = await svc.tx.select().from(leads).where(where).orderBy(desc(leads.createdAt)).limit(10000);
  const header = [
    "reference", "status", "contact_name", "partner_name", "phone", "email", "event_type", "event_date", "city", "venue",
    "source", "priority", "tags", "budget_range", "quotation_amount", "last_contacted_at", "opted_out", "created_at",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.reference, r.status, r.contactName, r.partnerName, r.phone, r.email, r.eventType, r.eventDate, r.city, r.venue,
        r.source, r.priority, r.tags, r.budgetRange, r.quotationAmountMinor !== null ? r.quotationAmountMinor / 100 : null,
        r.lastContactedAt, r.optedOut, r.createdAt,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  await audit(svc.tx, {
    studioId: svc.studioId,
    actorUserId: svc.userId,
    actorType: "user",
    action: "leads.exported",
    ipHash: meta.ipHash ?? null,
    metadata: { count: rows.length, filters: f },
  });
  return { csv: lines.join("\n"), count: rows.length };
}

export async function deleteLead(svc: ServiceContext, id: string, meta: { ipHash?: string | null }) {
  if (svc.role === "system" || !roleAtLeast(svc.role, "admin")) throw new ForbiddenError("Only studio owners and admins can delete leads");
  const lead = await getLead(svc, id);
  await svc.tx.delete(leads).where(and(eq(leads.id, id), eq(leads.studioId, svc.studioId)));
  await audit(svc.tx, {
    studioId: svc.studioId,
    actorUserId: svc.userId,
    actorType: "user",
    action: "lead.deleted",
    targetType: "lead",
    targetId: id,
    ipHash: meta.ipHash ?? null,
    metadata: { reference: lead.reference },
  });
}

export async function leadCountsByStatus(svc: ServiceContext) {
  const rows = await svc.tx
    .select({ status: leads.status, n: count() })
    .from(leads)
    .where(eq(leads.studioId, svc.studioId))
    .groupBy(leads.status);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)])) as Partial<Record<LeadStatus, number>>;
}

export async function findOtherLeadsWithPhone(svc: ServiceContext, lead: Lead) {
  return svc.tx
    .select({ id: leads.id, reference: leads.reference, status: leads.status, createdAt: leads.createdAt })
    .from(leads)
    .where(and(eq(leads.studioId, svc.studioId), eq(leads.phone, lead.phone), ne(leads.id, lead.id)))
    .orderBy(desc(leads.createdAt))
    .limit(5);
}
