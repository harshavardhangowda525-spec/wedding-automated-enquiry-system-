import { addDays, addMonths, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { createCalendarEntryAction, deleteCalendarEntryAction, setAvailabilityAction } from "@/app/actions/work";
import { ActionForm, DialogButton, SubmitButton } from "@/components/client/forms";
import { Alert, AvailabilityBadge, Card, CardHeader, Field, Input, PageHeader, Select, Textarea, buttonClass, cn } from "@/components/ui";
import { CALENDAR_ENTRY_LABELS, CALENDAR_ENTRY_TYPES, CLOSED_STATUSES, LEAD_STATUS_LABELS, roleAtLeast } from "@/lib/domain";
import { dateInTz, formatInTz } from "@/lib/time";
import { inStudio } from "@/server/auth/context";
import { getAvailability, listCalendar } from "@/server/services/calendar";

export const metadata = { title: "Calendar" };

const TYPE_STYLE: Record<string, string> = {
  confirmed_booking: "bg-success-soft text-success border-success/20",
  tentative_hold: "bg-warning-soft text-warning border-warning/25",
  consultation: "bg-info-soft text-info border-info/20",
  wedding_event: "bg-gold-soft text-gold-strong border-gold/30",
  quotation_expiry: "bg-sand text-ink-soft border-line",
  blocked: "bg-danger-soft text-danger border-danger/20",
  lead_event: "bg-white text-ink-soft border-dashed border-line-strong",
  task: "bg-white text-muted border-line",
};

const parseDay = (s: string | undefined, fallback: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fallback);
const toDate = (s: string) => new Date(`${s}T12:00:00`);
const ymd = (d: Date) => format(d, "yyyy-MM-dd");

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ view?: string; date?: string }> }) {
  const sp = await searchParams;
  const view = sp.view === "week" || sp.view === "day" ? sp.view : "month";
  const result = await inStudio("viewer", async (svc, ctx) => {
    const today = dateInTz(new Date(), ctx.studio.timezone);
    const focus = parseDay(sp.date, today);
    const f = toDate(focus);
    const from = view === "month" ? ymd(startOfWeek(startOfMonth(f), { weekStartsOn: 1 })) : view === "week" ? ymd(startOfWeek(f, { weekStartsOn: 1 })) : focus;
    const to = view === "month" ? ymd(endOfWeek(endOfMonth(f), { weekStartsOn: 1 })) : view === "week" ? ymd(endOfWeek(f, { weekStartsOn: 1 })) : focus;
    const data = await listCalendar(svc, from, to);
    const dayAvailability = view === "day" ? await getAvailability(svc.tx, svc.studioId, focus) : null;
    return { data, from, to, focus, today, ctx, dayAvailability };
  });
  const { data, focus, today, ctx } = result;
  const tz = ctx.studio.timezone;
  const canEdit = roleAtLeast(ctx.role, "staff");
  const f = toDate(focus);
  const prev = view === "month" ? addMonths(f, -1) : addDays(f, view === "week" ? -7 : -1);
  const next = view === "month" ? addMonths(f, 1) : addDays(f, view === "week" ? 7 : 1);
  const link = (patch: { view?: string; date?: string }) => `/calendar?view=${patch.view ?? view}&date=${patch.date ?? focus}`;

  type Item = { key: string; type: string; label: string; href?: string; time?: string | null; entryId?: string; leadId?: string | null };
  const itemsByDay = new Map<string, Item[]>();
  const push = (day: string, item: Item) => itemsByDay.set(day, [...(itemsByDay.get(day) ?? []), item]);
  const leadsWithEntries = new Set(data.entries.filter((e) => e.leadId && ["confirmed_booking", "tentative_hold", "wedding_event"].includes(e.type)).map((e) => `${e.leadId}:${e.entryDate}`));
  for (const e of data.entries) push(e.entryDate, { key: e.id, type: e.type, label: e.title, href: e.leadId ? `/leads/${e.leadId}` : undefined, time: e.startTime?.slice(0, 5), entryId: e.id, leadId: e.leadId });
  for (const l of data.leadEvents) {
    if (!l.eventDate || leadsWithEntries.has(`${l.id}:${l.eventDate}`) || CLOSED_STATUSES.includes(l.status)) continue;
    push(l.eventDate, { key: `lead-${l.id}`, type: "lead_event", label: `${l.contactName} – ${l.eventType} (${LEAD_STATUS_LABELS[l.status]})`, href: `/leads/${l.id}` });
  }
  for (const t of data.tasks) push(dateInTz(t.dueAt, tz), { key: `task-${t.id}`, type: "task", label: `☐ ${t.title}`, href: t.leadId ? `/leads/${t.leadId}` : "/tasks", time: formatInTz(t.dueAt, tz, "HH:mm") });
  const explicit = new Map(data.availability.map((a) => [a.date, a.state]));

  const days: string[] = [];
  for (let d = toDate(result.from); ymd(d) <= result.to; d = addDays(d, 1)) days.push(ymd(d));

  const title = view === "month" ? format(f, "MMMM yyyy") : view === "week" ? `Week of ${format(toDate(result.from), "d MMM yyyy")}` : format(f, "EEEE, d MMMM yyyy");

  return (
    <>
      <PageHeader
        title="Calendar"
        description="Weddings, consultations, follow-ups, quotation expiries, holds and confirmed bookings."
        actions={
          canEdit ? (
            <DialogButton label="Add to calendar" title="Add to calendar" variant="primary">
              <ActionForm action={createCalendarEntryAction} className="space-y-4">
                <Field label="Type" htmlFor="type">
                  <Select id="type" name="type" defaultValue="consultation">
                    {CALENDAR_ENTRY_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {CALENDAR_ENTRY_LABELS[t]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Title" htmlFor="title">
                  <Input id="title" name="title" required />
                </Field>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Date" htmlFor="entryDate" name="entryDate">
                    <Input id="entryDate" name="entryDate" type="date" defaultValue={focus} required />
                  </Field>
                  <Field label="Start" htmlFor="startTime">
                    <Input id="startTime" name="startTime" type="time" />
                  </Field>
                  <Field label="End" htmlFor="endTime" name="endTime">
                    <Input id="endTime" name="endTime" type="time" />
                  </Field>
                </div>
                <Field label="Notes" htmlFor="notes">
                  <Textarea id="notes" name="notes" rows={2} />
                </Field>
                <p className="text-xs text-muted">Holds and bookings warn you about conflicts with existing records.</p>
                <SubmitButton>Save</SubmitButton>
              </ActionForm>
            </DialogButton>
          ) : undefined
        }
      />

      <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="flex items-center gap-1">
          <Link href={link({ date: ymd(prev) })} className={buttonClass("ghost", "sm")} aria-label="Previous">
            <ChevronLeft size={16} />
          </Link>
          <Link href={link({ date: today })} className={buttonClass("secondary", "sm")}>
            Today
          </Link>
          <Link href={link({ date: ymd(next) })} className={buttonClass("ghost", "sm")} aria-label="Next">
            <ChevronRight size={16} />
          </Link>
          <h2 className="ml-2 font-display text-xl font-semibold">{title}</h2>
        </div>
        <div className="flex rounded-lg border border-line-strong bg-white p-0.5">
          {(["month", "week", "day"] as const).map((v) => (
            <Link key={v} href={link({ view: v })} className={cn("rounded-md px-3 py-1 text-sm capitalize", v === view ? "bg-ink text-ivory" : "text-ink-soft")} aria-current={v === view ? "page" : undefined}>
              {v}
            </Link>
          ))}
        </div>
      </Card>

      {view !== "day" ? (
        <Card className="overflow-hidden">
          <div className="grid grid-cols-7 border-b border-line bg-sand/50 text-center text-xs font-semibold uppercase tracking-wide text-muted">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d} className="py-2">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day) => {
              const items = itemsByDay.get(day) ?? [];
              const outside = view === "month" && day.slice(0, 7) !== focus.slice(0, 7);
              const avail = explicit.get(day);
              return (
                <div key={day} className={cn("min-h-28 border-b border-r border-line p-1.5", outside && "bg-sand/30", view === "week" && "min-h-64")}>
                  <div className="mb-1 flex items-center justify-between">
                    <Link href={link({ view: "day", date: day })} className={cn("flex h-6 w-6 items-center justify-center rounded-full text-xs", day === today ? "bg-gold font-semibold text-white" : outside ? "text-muted" : "text-ink-soft hover:bg-sand")}>
                      {Number(day.slice(8))}
                    </Link>
                    {avail && <span className={cn("h-1.5 w-1.5 rounded-full", avail === "available" ? "bg-success" : "bg-danger")} title={avail === "available" ? "Marked available" : "Marked unavailable"} />}
                  </div>
                  <ul className="space-y-1">
                    {items.slice(0, view === "week" ? 12 : 3).map((it) => (
                      <li key={it.key}>
                        <Link href={it.href ?? link({ view: "day", date: day })} className={cn("block truncate rounded border px-1.5 py-0.5 text-[11px] leading-tight", TYPE_STYLE[it.type])} title={it.label}>
                          {it.time ? `${it.time} ` : ""}
                          {it.label}
                        </Link>
                      </li>
                    ))}
                    {items.length > (view === "week" ? 12 : 3) && (
                      <li>
                        <Link href={link({ view: "day", date: day })} className="text-[11px] text-muted hover:underline">
                          +{items.length - (view === "week" ? 12 : 3)} more
                        </Link>
                      </li>
                    )}
                  </ul>
                </div>
              );
            })}
          </div>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="Schedule" />
            {(itemsByDay.get(focus) ?? []).length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-muted">Nothing on this day.</p>
            ) : (
              <ul className="divide-y divide-line">
                {(itemsByDay.get(focus) ?? [])
                  .sort((a, b) => (a.time ?? "99").localeCompare(b.time ?? "99"))
                  .map((it) => (
                    <li key={it.key} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                      <div className="flex items-center gap-3">
                        <span className="w-12 text-xs text-muted">{it.time ?? "All day"}</span>
                        <span className={cn("rounded border px-2 py-0.5 text-xs", TYPE_STYLE[it.type])}>{it.type === "lead_event" ? "Lead's event date" : it.type === "task" ? "Task" : CALENDAR_ENTRY_LABELS[it.type as keyof typeof CALENDAR_ENTRY_LABELS]}</span>
                        {it.href ? (
                          <Link href={it.href} className="font-medium hover:underline">
                            {it.label}
                          </Link>
                        ) : (
                          <span className="font-medium">{it.label}</span>
                        )}
                      </div>
                      {canEdit && it.entryId && (
                        <ActionForm action={deleteCalendarEntryAction} showMessage={false}>
                          <input type="hidden" name="entryId" value={it.entryId} />
                          {it.leadId && <input type="hidden" name="leadId" value={it.leadId} />}
                          <SubmitButton size="sm" variant="ghost">
                            Remove
                          </SubmitButton>
                        </ActionForm>
                      )}
                    </li>
                  ))}
              </ul>
            )}
          </Card>
          <Card className="p-5">
            <p className="text-sm font-semibold">Availability for this date</p>
            {result.dayAvailability && (
              <>
                <div className="mt-2">
                  <AvailabilityBadge state={result.dayAvailability.state} />
                </div>
                <p className="mt-2 text-xs text-muted">{result.dayAvailability.explanation}</p>
                <p className="mt-1 text-xs text-muted">
                  Confirmed {result.dayAvailability.confirmedCount}/{result.dayAvailability.capacity} · Holds {result.dayAvailability.tentativeCount}
                </p>
              </>
            )}
            {canEdit && (
              <div className="mt-4 space-y-2">
                {(["available", "unavailable", "clear"] as const).map((state) => (
                  <ActionForm key={state} action={setAvailabilityAction} showMessage={false}>
                    <input type="hidden" name="date" value={focus} />
                    <input type="hidden" name="state" value={state} />
                    <SubmitButton size="sm" variant={state === "clear" ? "ghost" : "secondary"} className="w-full">
                      {state === "available" ? "Mark available" : state === "unavailable" ? "Mark unavailable" : "Clear manual marking"}
                    </SubmitButton>
                  </ActionForm>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted">
        {Object.entries({ confirmed_booking: "Confirmed booking", tentative_hold: "Tentative hold", consultation: "Consultation", wedding_event: "Wedding event", quotation_expiry: "Quotation expiry", blocked: "Blocked", lead_event: "Open lead's event date", task: "Task" }).map(([k, v]) => (
          <span key={k} className={cn("rounded border px-1.5 py-0.5", TYPE_STYLE[k])}>
            {v}
          </span>
        ))}
      </div>
      <Alert tone="info" className="mt-4" title="External calendar sync: not connected">
        Google Calendar sync is not configured for this studio. Entries here are the source of truth for availability.
      </Alert>
    </>
  );
}
