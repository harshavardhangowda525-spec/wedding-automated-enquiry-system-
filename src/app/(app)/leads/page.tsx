import { Download, Inbox } from "lucide-react";
import Link from "next/link";
import { LeadsTable, type LeadRow } from "@/components/client/leads-table";
import { ButtonLink, Card, EmptyState, Input, LeadStatusBadge, PageHeader, Select, buttonClass, cn, DemoBadge } from "@/components/ui";
import { LEAD_SOURCES, LEAD_SOURCE_LABELS, LEAD_STATUSES, LEAD_STATUS_LABELS, roleAtLeast, type LeadStatus } from "@/lib/domain";
import { formatMoney } from "@/lib/money";
import { formatInTz } from "@/lib/time";
import { inStudio } from "@/server/auth/context";
import { leadCountsByStatus, listLeads, listMembers, type LeadFilters } from "@/server/services/leads";

export const metadata = { title: "Leads" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

function relative(date: Date) {
  const mins = Math.round((Date.now() - date.getTime()) / 60000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const view = one(sp.view) === "pipeline" ? "pipeline" : "table";
  const statusParam = one(sp.status);
  const filters: Partial<LeadFilters> = {
    q: one(sp.q),
    status: statusParam && (LEAD_STATUSES as readonly string[]).includes(statusParam) ? [statusParam as LeadStatus] : undefined,
    source: one(sp.source) as LeadFilters["source"],
    priority: one(sp.priority) as LeadFilters["priority"],
    assignedTo: one(sp.assignedTo) as LeadFilters["assignedTo"],
    tag: one(sp.tag),
    eventFrom: one(sp.eventFrom),
    eventTo: one(sp.eventTo),
    view: (one(sp.scope) as LeadFilters["view"]) ?? "open",
    sort: (one(sp.sort) as LeadFilters["sort"]) ?? "newest",
    page: Number(one(sp.page) ?? 1) || 1,
    pageSize: view === "pipeline" ? 200 : 25,
  };
  const { result, members, counts, ctx } = await inStudio("viewer", async (svc, ctx) => {
    const safe = { ...filters };
    for (const k of ["source", "priority", "assignedTo", "eventFrom", "eventTo"] as const) {
      // Ignore malformed query parameters instead of erroring.
      if (safe[k] && !/^[\w:-]+$/.test(String(safe[k]))) delete safe[k];
    }
    return { result: await listLeads(svc, safe).catch(() => listLeads(svc, { view: "open" })), members: await listMembers(svc), counts: await leadCountsByStatus(svc), ctx };
  });
  const tz = ctx.studio.timezone;
  const canEdit = roleAtLeast(ctx.role, "staff");
  const canExport = roleAtLeast(ctx.role, "admin");
  const rows: LeadRow[] = result.rows.map((r) => ({
    ...r,
    lastActivityLabel: relative(r.lastActivityAt),
    createdLabel: formatInTz(r.createdAt, tz, "d MMM yyyy"),
    eventLabel: r.eventDate ? formatInTz(`${r.eventDate}T12:00:00Z`, tz, "d MMM yyyy") : "Date not decided",
  }));
  const qs = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, one(v)])), ...patch })) if (v) params.set(k, v);
    const s = params.toString();
    return s ? `/leads?${s}` : "/leads";
  };
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const totalAll = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Leads"
        description={`${totalAll} lead${totalAll === 1 ? "" : "s"} in total. Every change is recorded in the lead's timeline.`}
        actions={
          <>
            <div className="flex rounded-lg border border-line-strong bg-white p-0.5">
              <Link href={qs({ view: undefined, page: undefined })} className={cn("rounded-md px-3 py-1.5 text-sm", view === "table" ? "bg-ink text-ivory" : "text-ink-soft")} aria-current={view === "table" ? "page" : undefined}>
                Table
              </Link>
              <Link href={qs({ view: "pipeline", page: undefined })} className={cn("rounded-md px-3 py-1.5 text-sm", view === "pipeline" ? "bg-ink text-ivory" : "text-ink-soft")} aria-current={view === "pipeline" ? "page" : undefined}>
                Pipeline
              </Link>
            </div>
            {canExport && (
              <a href={`/api/leads/export?${new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (one(v) ? [[k, one(v)!]] : []))).toString()}`} className={buttonClass("secondary")}>
                <Download size={15} /> Export CSV
              </a>
            )}
            {canEdit && (
              <ButtonLink href="/leads/new" variant="primary">
                Add lead
              </ButtonLink>
            )}
          </>
        }
      />

      <Card className="mb-4 p-4">
        <form className="grid gap-3 md:grid-cols-6" role="search">
          {view === "pipeline" && <input type="hidden" name="view" value="pipeline" />}
          <Input name="q" defaultValue={filters.q} placeholder="Search name, phone, email, reference, city…" aria-label="Search leads" className="md:col-span-2" />
          <Select name="scope" defaultValue={filters.view} aria-label="Open or closed">
            <option value="open">Open leads</option>
            <option value="closed">Closed leads</option>
            <option value="all">All leads</option>
          </Select>
          <Select name="status" defaultValue={statusParam ?? ""} aria-label="Status">
            <option value="">Any status</option>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {LEAD_STATUS_LABELS[s]} ({counts[s] ?? 0})
              </option>
            ))}
          </Select>
          <Select name="source" defaultValue={filters.source ?? ""} aria-label="Source">
            <option value="">Any source</option>
            {LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>
                {LEAD_SOURCE_LABELS[s]}
              </option>
            ))}
          </Select>
          <Select name="assignedTo" defaultValue={filters.assignedTo ?? ""} aria-label="Owner">
            <option value="">Any owner</option>
            <option value="unassigned">Unassigned</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.fullName ?? m.email}
              </option>
            ))}
          </Select>
          <Select name="priority" defaultValue={filters.priority ?? ""} aria-label="Priority">
            <option value="">Any priority</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </Select>
          <Input name="tag" defaultValue={filters.tag} placeholder="Tag" aria-label="Tag" />
          <Input type="date" name="eventFrom" defaultValue={filters.eventFrom} aria-label="Event date from" />
          <Input type="date" name="eventTo" defaultValue={filters.eventTo} aria-label="Event date to" />
          <Select name="sort" defaultValue={filters.sort} aria-label="Sort">
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="event_date">Event date</option>
            <option value="last_activity">Recent activity</option>
          </Select>
          <div className="flex gap-2">
            <button className={buttonClass("primary", "md", "flex-1")}>Apply</button>
            <Link href={view === "pipeline" ? "/leads?view=pipeline" : "/leads"} className={buttonClass("ghost")}>
              Reset
            </Link>
          </div>
        </form>
      </Card>

      {result.rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Inbox size={30} />}
            title={totalAll === 0 ? "No leads yet" : "No leads match these filters"}
            description={totalAll === 0 ? "Enquiries from your public form appear here automatically. You can also add phone, Instagram or referral leads manually." : "Try widening your search or switching to all leads."}
            action={canEdit ? <ButtonLink href="/leads/new">Add a lead</ButtonLink> : undefined}
          />
        </Card>
      ) : view === "table" ? (
        <Card>
          <LeadsTable rows={rows} members={members.map((m) => ({ userId: m.userId, name: m.fullName ?? m.email }))} currency={ctx.studio.currency} canEdit={canEdit} />
          <div className="flex items-center justify-between px-4 py-3 text-sm text-muted">
            <span>
              Showing {(result.page - 1) * result.pageSize + 1}–{Math.min(result.page * result.pageSize, result.total)} of {result.total}
            </span>
            <div className="flex gap-2">
              {result.page > 1 && (
                <Link className={buttonClass("secondary", "sm")} href={qs({ page: String(result.page - 1) })}>
                  Previous
                </Link>
              )}
              {result.page < pages && (
                <Link className={buttonClass("secondary", "sm")} href={qs({ page: String(result.page + 1) })}>
                  Next
                </Link>
              )}
            </div>
          </div>
        </Card>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {(filters.view === "closed" ? (["booking_confirmed", "won", "lost", "not_interested"] as LeadStatus[]) : LEAD_STATUSES.filter((s) => filters.view === "all" || !["booking_confirmed", "won", "lost", "not_interested"].includes(s))).map((status) => {
            const items = rows.filter((r) => r.status === status);
            return (
              <section key={status} className="w-72 shrink-0 rounded-xl border border-line bg-sand/50" aria-label={LEAD_STATUS_LABELS[status]}>
                <header className="flex items-center justify-between px-3 py-2.5">
                  <LeadStatusBadge status={status} />
                  <span className="text-xs text-muted">{items.length}</span>
                </header>
                <ul className="space-y-2 px-2 pb-2">
                  {items.map((r) => (
                    <li key={r.id}>
                      <Link href={`/leads/${r.id}`} className="block rounded-lg border border-line bg-white p-3 text-sm shadow-sm hover:border-gold">
                        <p className="font-medium">
                          {r.contactName}
                          {r.partnerName ? ` & ${r.partnerName}` : ""} {r.isDemo && <DemoBadge />}
                        </p>
                        <p className="mt-0.5 text-xs text-muted">
                          {r.eventType} · {r.eventLabel}
                        </p>
                        {r.quotationAmountMinor !== null && <p className="mt-1 text-xs font-medium text-gold-strong">{formatMoney(r.quotationAmountMinor, ctx.studio.currency)}</p>}
                        {r.nextAction && <p className="mt-1 truncate text-xs text-ink-soft">Next: {r.nextAction}</p>}
                      </Link>
                    </li>
                  ))}
                  {items.length === 0 && <li className="px-2 py-4 text-center text-xs text-muted">No leads</li>}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
