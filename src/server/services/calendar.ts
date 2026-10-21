import "server-only";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import { CALENDAR_ENTRY_LABELS, CALENDAR_ENTRY_TYPES, type AvailabilityState } from "@/lib/domain";
import { parseStudioSettings } from "@/lib/studio-settings";
import type { ServiceContext } from "@/server/auth/context";
import type { Queryable } from "@/server/db/client";
import { calendarEntries, dateAvailability, leads, studios, tasks } from "@/server/db/schema";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/lib/errors";
import { recordActivity } from "./activity";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const timeStr = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .optional()
  .or(z.literal("").transform(() => undefined));

export const calendarEntrySchema = z.object({
  type: z.enum(CALENDAR_ENTRY_TYPES),
  title: z.string().trim().min(1).max(200),
  entryDate: dateStr,
  startTime: timeStr,
  endTime: timeStr,
  leadId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  notes: z.string().max(2000).optional(),
});

export type AvailabilityResult = {
  date: string;
  state: AvailabilityState;
  confirmedCount: number;
  tentativeCount: number;
  capacity: number;
  explanation: string;
  entries: { id: string; type: string; title: string; leadId: string | null }[];
};

/**
 * Availability is derived only from recorded data:
 *  - confirmed bookings at capacity          → confirmed_booking
 *  - a staff "blocked/unavailable" record    → unavailable
 *  - tentative holds                         → tentative_hold
 *  - an explicit staff "available" record    → available
 *  - otherwise                               → not_checked (never assumed available)
 */
export async function getAvailability(q: Queryable, studioId: string, date: string, excludeLeadId?: string): Promise<AvailabilityResult> {
  const [studio] = await q.select({ settings: studios.settings }).from(studios).where(eq(studios.id, studioId));
  const capacity = parseStudioSettings(studio?.settings).booking.maxBookingsPerDay;
  const entries = await q
    .select({ id: calendarEntries.id, type: calendarEntries.type, title: calendarEntries.title, leadId: calendarEntries.leadId })
    .from(calendarEntries)
    .where(
      and(
        eq(calendarEntries.studioId, studioId),
        eq(calendarEntries.entryDate, date),
        inArray(calendarEntries.type, ["confirmed_booking", "tentative_hold", "blocked"]),
      ),
    );
  const relevant = entries.filter((e) => !excludeLeadId || e.leadId !== excludeLeadId);
  const confirmedCount = relevant.filter((e) => e.type === "confirmed_booking").length;
  const tentativeCount = relevant.filter((e) => e.type === "tentative_hold").length;
  const blocked = relevant.some((e) => e.type === "blocked");
  const [explicit] = await q
    .select()
    .from(dateAvailability)
    .where(and(eq(dateAvailability.studioId, studioId), eq(dateAvailability.date, date)));

  let state: AvailabilityState = "not_checked";
  let explanation = "No availability has been recorded for this date yet.";
  if (confirmedCount >= capacity) {
    state = "confirmed_booking";
    explanation = `${confirmedCount} confirmed booking(s); capacity is ${capacity} per day.`;
  } else if (blocked || explicit?.state === "unavailable") {
    state = "unavailable";
    explanation = explicit?.note ? `Marked unavailable: ${explicit.note}` : "Marked unavailable by the studio.";
  } else if (tentativeCount > 0) {
    state = "tentative_hold";
    explanation = `${tentativeCount} tentative hold(s) on this date${confirmedCount ? ` and ${confirmedCount} confirmed booking(s)` : ""}.`;
  } else if (explicit?.state === "available") {
    state = "available";
    explanation = `Marked available by the studio${confirmedCount ? `; ${confirmedCount} of ${capacity} slots booked` : ""}.`;
  }
  return { date, state, confirmedCount, tentativeCount, capacity, explanation, entries: relevant };
}

export async function setDateAvailability(svc: ServiceContext, date: string, state: "available" | "unavailable" | "clear", note?: string) {
  if (svc.role === "viewer") throw new ForbiddenError();
  dateStr.parse(date);
  if (state === "clear") {
    await svc.tx.delete(dateAvailability).where(and(eq(dateAvailability.studioId, svc.studioId), eq(dateAvailability.date, date)));
    return;
  }
  await svc.tx
    .insert(dateAvailability)
    .values({ studioId: svc.studioId, date, state, note: note ?? null, setBy: svc.userId })
    .onConflictDoUpdate({
      target: [dateAvailability.studioId, dateAvailability.date],
      set: { state, note: note ?? null, setBy: svc.userId, updatedAt: new Date() },
    });
}

export async function listCalendar(svc: ServiceContext, from: string, to: string) {
  const entries = await svc.tx
    .select({
      id: calendarEntries.id,
      type: calendarEntries.type,
      title: calendarEntries.title,
      entryDate: calendarEntries.entryDate,
      startTime: calendarEntries.startTime,
      endTime: calendarEntries.endTime,
      leadId: calendarEntries.leadId,
      notes: calendarEntries.notes,
      leadName: leads.contactName,
    })
    .from(calendarEntries)
    .leftJoin(leads, eq(leads.id, calendarEntries.leadId))
    .where(and(eq(calendarEntries.studioId, svc.studioId), gte(calendarEntries.entryDate, from), lte(calendarEntries.entryDate, to)))
    .orderBy(asc(calendarEntries.entryDate), asc(calendarEntries.startTime));

  // Open lead event dates that are not yet on the calendar as entries.
  const leadEvents = await svc.tx
    .select({ id: leads.id, contactName: leads.contactName, eventDate: leads.eventDate, eventType: leads.eventType, status: leads.status })
    .from(leads)
    .where(and(eq(leads.studioId, svc.studioId), gte(leads.eventDate, from), lte(leads.eventDate, to)));

  const openTasks = await svc.tx
    .select({ id: tasks.id, title: tasks.title, dueAt: tasks.dueAt, leadId: tasks.leadId, type: tasks.type })
    .from(tasks)
    .where(
      and(
        eq(tasks.studioId, svc.studioId),
        eq(tasks.status, "open"),
        gte(tasks.dueAt, new Date(`${from}T00:00:00Z`)),
        lte(tasks.dueAt, new Date(`${to}T23:59:59Z`)),
      ),
    );

  const explicit = await svc.tx
    .select()
    .from(dateAvailability)
    .where(and(eq(dateAvailability.studioId, svc.studioId), gte(dateAvailability.date, from), lte(dateAvailability.date, to)));

  return { entries, leadEvents, tasks: openTasks, availability: explicit };
}

export async function createCalendarEntry(svc: ServiceContext, input: z.input<typeof calendarEntrySchema>) {
  if (svc.role === "viewer") throw new ForbiddenError();
  const data = calendarEntrySchema.parse(input);
  if (data.leadId) {
    const [lead] = await svc.tx.select({ id: leads.id }).from(leads).where(and(eq(leads.id, data.leadId), eq(leads.studioId, svc.studioId)));
    if (!lead) throw new NotFoundError("Lead");
  }
  if (data.startTime && data.endTime && data.endTime <= data.startTime) {
    throw new ValidationError("End time must be after start time", { endTime: ["Must be after start time"] });
  }
  const warning = await conflictWarning(svc.tx, svc.studioId, data.entryDate, data.type, data.leadId);
  const [entry] = await svc.tx
    .insert(calendarEntries)
    .values({
      studioId: svc.studioId,
      type: data.type,
      title: data.title,
      entryDate: data.entryDate,
      startTime: data.startTime ?? null,
      endTime: data.endTime ?? null,
      leadId: data.leadId ?? null,
      notes: data.notes ?? null,
      createdBy: svc.userId,
    })
    .returning();
  if (data.leadId) {
    await recordActivity(svc, {
      leadId: data.leadId,
      type: "calendar_entry_created",
      summary: `${CALENDAR_ENTRY_LABELS[data.type]} added for ${data.entryDate}`,
      data: { entryId: entry.id },
    });
  }
  return { entry, warning };
}

export async function deleteCalendarEntry(svc: ServiceContext, id: string) {
  if (svc.role === "viewer") throw new ForbiddenError();
  const [entry] = await svc.tx.delete(calendarEntries).where(and(eq(calendarEntries.id, id), eq(calendarEntries.studioId, svc.studioId))).returning();
  if (!entry) throw new NotFoundError("Calendar entry");
  if (entry.leadId) {
    await recordActivity(svc, { leadId: entry.leadId, type: "calendar_entry_removed", summary: `${CALENDAR_ENTRY_LABELS[entry.type]} on ${entry.entryDate} removed` });
  }
}

/** Human-readable warning when adding a hold/booking would conflict with existing records. */
export async function conflictWarning(q: Queryable, studioId: string, date: string, type: string, leadId?: string): Promise<string | null> {
  if (!["confirmed_booking", "tentative_hold", "wedding_event"].includes(type)) return null;
  const a = await getAvailability(q, studioId, date, leadId);
  if (a.state === "confirmed_booking") return `Conflict: ${date} is already fully booked (${a.confirmedCount}/${a.capacity}).`;
  if (a.state === "unavailable") return `Conflict: ${date} is marked unavailable.`;
  if (a.state === "tentative_hold") return `Heads up: ${date} already has ${a.tentativeCount} tentative hold(s).`;
  return null;
}
