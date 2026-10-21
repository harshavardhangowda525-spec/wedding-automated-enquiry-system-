import { and, count, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { AlertTriangle, CalendarHeart, Inbox, MailCheck } from "lucide-react";
import Link from "next/link";
import { markNotificationsReadAction } from "@/app/actions/work";
import { CopyButton } from "@/components/client/copy-button";
import { Alert, Badge, ButtonLink, Card, CardHeader, EmptyState, LeadStatusBadge, PageHeader, Stat, DemoBadge } from "@/components/ui";
import { ACTIVE_STATUSES, TASK_TYPE_LABELS } from "@/lib/domain";
import { addDaysToDateString, dateInTz, formatInTz } from "@/lib/time";
import { inStudio } from "@/server/auth/context";
import { calendarEntries, leads, messages } from "@/server/db/schema";
import { env } from "@/server/env";
import { listNotifications } from "@/server/services/settings";
import { listTasks } from "@/server/services/tasks";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const { denied } = await searchParams;
  const data = await inStudio("viewer", async (svc, ctx) => {
    const tz = ctx.studio.timezone;
    const now = new Date();
    const today = dateInTz(now, tz);
    const [openLeads] = await svc.tx.select({ n: count() }).from(leads).where(and(eq(leads.studioId, svc.studioId), inArray(leads.status, ACTIVE_STATUSES)));
    const [newWeek] = await svc.tx.select({ n: count() }).from(leads).where(and(eq(leads.studioId, svc.studioId), gte(leads.createdAt, new Date(now.getTime() - 7 * 86400_000))));
    const [awaiting] = await svc.tx.select({ n: count() }).from(messages).where(and(eq(messages.studioId, svc.studioId), eq(messages.status, "awaiting_approval")));
    const overdue = await listTasks(svc, { scope: "overdue" }, now);
    const todayTasks = (await listTasks(svc, { scope: "open" }, now)).filter((t) => t.dueAt >= now && dateInTz(t.dueAt, tz) === today);
    const recent = await svc.tx
      .select({ id: leads.id, contactName: leads.contactName, partnerName: leads.partnerName, eventType: leads.eventType, eventDate: leads.eventDate, status: leads.status, createdAt: leads.createdAt, isDemo: leads.isDemo, lastContactedAt: leads.lastContactedAt })
      .from(leads)
      .where(eq(leads.studioId, svc.studioId))
      .orderBy(desc(leads.createdAt))
      .limit(6);
    const upcoming = await svc.tx
      .select({ id: calendarEntries.id, title: calendarEntries.title, type: calendarEntries.type, entryDate: calendarEntries.entryDate, leadId: calendarEntries.leadId })
      .from(calendarEntries)
      .where(and(eq(calendarEntries.studioId, svc.studioId), gte(calendarEntries.entryDate, today), lte(calendarEntries.entryDate, addDaysToDateString(today, 45)), sql`${calendarEntries.type} in ('confirmed_booking','tentative_hold','consultation')`))
      .orderBy(calendarEntries.entryDate)
      .limit(6);
    const notes = await listNotifications(svc, 8);
    return { tz, openLeads: Number(openLeads.n), newWeek: Number(newWeek.n), awaiting: Number(awaiting.n), overdue, todayTasks, recent, upcoming, notes, studio: ctx.studio, user: ctx.user };
  });
  const enquiryUrl = `${env().APP_URL.replace(/\/$/, "")}/enquire/${data.studio.slug}`;
  const uncontacted = data.recent.filter((l) => l.status === "new_enquiry" && !l.lastContactedAt);

  return (
    <>
      <PageHeader
        eyebrow={formatInTz(new Date(), data.tz, "EEEE, d MMMM")}
        title={`Good to see you${data.user.fullName ? `, ${data.user.fullName.split(" ")[0]}` : ""}`}
        description="Here's what needs attention today."
        actions={
          <>
            <ButtonLink href="/leads/new" variant="secondary">
              Add lead
            </ButtonLink>
            <ButtonLink href="/tasks" variant="primary">
              Open follow-ups
            </ButtonLink>
          </>
        }
      />

      {denied && (
        <Alert tone="warning" className="mb-4" title="You don't have access to that page">
          Your role in this studio doesn&apos;t include it. Ask a studio owner or admin if you need access.
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Open leads" value={data.openLeads} hint="Not yet booked, won or closed" />
        <Stat label="New this week" value={data.newWeek} hint="Enquiries in the last 7 days" />
        <Stat label="Follow-ups overdue" value={data.overdue.length} hint={`${data.todayTasks.length} more due later today`} />
        <Stat label="Awaiting approval" value={data.awaiting} hint="Drafts that need a human check" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Follow-ups due" description="Overdue and today's tasks" action={<ButtonLink href="/tasks" size="sm" variant="ghost">View all</ButtonLink>} />
            {data.overdue.length + data.todayTasks.length === 0 ? (
              <EmptyState icon={<MailCheck size={28} />} title="You're all caught up" description="No follow-ups are due today." />
            ) : (
              <ul className="divide-y divide-line">
                {[...data.overdue, ...data.todayTasks].slice(0, 8).map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{t.title}</p>
                      <p className="text-xs text-muted">
                        {TASK_TYPE_LABELS[t.type]} · {t.leadName ? <Link href={`/leads/${t.leadId}`} className="hover:underline">{t.leadName}</Link> : "No lead"}
                      </p>
                    </div>
                    <Badge tone={t.dueAt < new Date() ? "danger" : "info"}>{t.dueAt < new Date() ? "Overdue" : formatInTz(t.dueAt, data.tz, "h:mm a")}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Latest enquiries" action={<ButtonLink href="/leads" size="sm" variant="ghost">All leads</ButtonLink>} />
            {data.recent.length === 0 ? (
              <EmptyState icon={<Inbox size={28} />} title="No enquiries yet" description="Share your enquiry link on your website and Instagram bio to start receiving enquiries." />
            ) : (
              <ul className="divide-y divide-line">
                {data.recent.map((l) => (
                  <li key={l.id}>
                    <Link href={`/leads/${l.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-sand/40">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {l.contactName}
                          {l.partnerName ? ` & ${l.partnerName}` : ""} {l.isDemo && <DemoBadge />}
                        </p>
                        <p className="text-xs text-muted">
                          {l.eventType} · {l.eventDate ? formatInTz(`${l.eventDate}T12:00:00Z`, data.tz, "d MMM yyyy") : "Date not decided"} · received {formatInTz(l.createdAt, data.tz, "d MMM, h:mm a")}
                        </p>
                      </div>
                      <LeadStatusBadge status={l.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {uncontacted.length > 0 && (
              <div className="flex items-center gap-2 border-t border-line bg-warning-soft/60 px-5 py-2.5 text-xs text-warning">
                <AlertTriangle size={14} aria-hidden /> {uncontacted.length} recent enquir{uncontacted.length === 1 ? "y has" : "ies have"} not been contacted yet.
              </div>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card className="p-5">
            <p className="text-sm font-semibold">Your enquiry link</p>
            <p className="mt-1 break-all rounded-lg bg-sand px-3 py-2 font-mono text-xs">{enquiryUrl}</p>
            <div className="mt-3 flex gap-2">
              <CopyButton value={enquiryUrl} />
              <ButtonLink href={`/enquire/${data.studio.slug}`} size="sm" variant="ghost" target="_blank">
                Preview
              </ButtonLink>
            </div>
          </Card>

          <Card>
            <CardHeader title="Upcoming" description="Next 45 days" action={<ButtonLink href="/calendar" size="sm" variant="ghost">Calendar</ButtonLink>} />
            {data.upcoming.length === 0 ? (
              <EmptyState icon={<CalendarHeart size={26} />} title="Nothing scheduled" />
            ) : (
              <ul className="divide-y divide-line">
                {data.upcoming.map((e) => (
                  <li key={e.id} className="px-5 py-3 text-sm">
                    <p className="font-medium">{e.leadId ? <Link href={`/leads/${e.leadId}`} className="hover:underline">{e.title}</Link> : e.title}</p>
                    <p className="text-xs text-muted">{formatInTz(`${e.entryDate}T12:00:00Z`, data.tz, "EEE d MMM yyyy")}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card id="notifications">
            <CardHeader
              title="Notifications"
              action={
                data.notes.some((n) => !n.readAt) ? (
                  <form action={markNotificationsReadAction}>
                    <button className="text-xs text-muted hover:text-ink">Mark all read</button>
                  </form>
                ) : undefined
              }
            />
            {data.notes.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-muted">No notifications yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.notes.map((n) => (
                  <li key={n.id} className="px-5 py-3 text-sm">
                    <p className={n.readAt ? "text-ink-soft" : "font-medium"}>
                      {!n.readAt && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-gold align-middle" />}
                      {n.leadId ? <Link href={`/leads/${n.leadId}`} className="hover:underline">{n.title}</Link> : n.title}
                    </p>
                    {n.body && <p className="text-xs text-muted">{n.body}</p>}
                    <p className="mt-0.5 text-[11px] text-muted">{formatInTz(n.createdAt, data.tz, "d MMM, h:mm a")}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
