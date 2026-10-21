import { BarList, DailyColumns } from "@/components/charts";
import { Alert, Card, CardHeader, Input, PageHeader, Stat, buttonClass } from "@/components/ui";
import { LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS, type LeadSource, type LeadStatus } from "@/lib/domain";
import { formatMoney } from "@/lib/money";
import { addDaysToDateString, dateInTz } from "@/lib/time";
import { inStudio } from "@/server/auth/context";
import { METRIC_DEFINITIONS, getAnalytics } from "@/server/services/analytics";

export const metadata = { title: "Analytics" };

const valid = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const sp = await searchParams;
  const { a, ctx, from, to } = await inStudio("viewer", async (svc, ctx) => {
    const today = dateInTz(new Date(), ctx.studio.timezone);
    let to = valid(sp.to) ?? today;
    let from = valid(sp.from) ?? addDaysToDateString(to, -29);
    if (from > to) [from, to] = [to, from];
    return { a: await getAnalytics(svc, { from, to }, ctx.studio.timezone), ctx, from, to };
  });
  const cur = ctx.studio.currency;
  const hours = (h: number | null) => (h === null ? "—" : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} days`);
  const today = dateInTz(new Date(), ctx.studio.timezone);
  const presets = [
    ["Last 7 days", addDaysToDateString(today, -6), today],
    ["Last 30 days", addDaysToDateString(today, -29), today],
    ["Last 90 days", addDaysToDateString(today, -89), today],
    ["This year", `${today.slice(0, 4)}-01-01`, today],
  ];

  return (
    <>
      <PageHeader title="Analytics" description="Calculated from your actual records only. Hover any number's label for its definition." />
      <Card className="mb-6 flex flex-wrap items-end gap-3 p-4">
        <form className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-muted">From</span>
            <Input type="date" name="from" defaultValue={from} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-muted">To</span>
            <Input type="date" name="to" defaultValue={to} />
          </label>
          <button className={buttonClass("primary")}>Apply</button>
        </form>
        <div className="flex flex-wrap gap-1">
          {presets.map(([label, f, t]) => (
            <a key={label} href={`/analytics?from=${f}&to=${t}`} className={buttonClass(f === from && t === to ? "secondary" : "ghost", "sm")}>
              {label}
            </a>
          ))}
        </div>
      </Card>
      {a.demoLeadsInRange > 0 && (
        <Alert tone="warning" className="mb-4">
          {a.demoLeadsInRange} of these leads are sample (demo) records, so these figures are illustrative only.
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div title={METRIC_DEFINITIONS.totalEnquiries}><Stat label="Total enquiries" value={a.totalEnquiries} hint={`${a.newEnquiries} still new`} /></div>
        <div title={METRIC_DEFINITIONS.firstResponse}><Stat label="Median first response" value={hours(a.firstResponse.medianHours)} hint={a.firstResponse.responded ? `Average ${hours(a.firstResponse.averageHours)} · ${a.firstResponse.responded} responded` : "No responses recorded"} /></div>
        <div title={METRIC_DEFINITIONS.conversionRate}><Stat label="Conversion rate" value={a.conversionRate === null ? "—" : `${(a.conversionRate * 100).toFixed(1)}%`} hint="Booked or won" /></div>
        <div title={METRIC_DEFINITIONS.revenue}><Stat label="Recorded booking value" value={a.revenueMinor === null ? "—" : formatMoney(a.revenueMinor, cur)} hint={`${a.confirmedBookings} booking(s) confirmed`} /></div>
        <div title={METRIC_DEFINITIONS.followUpsDue}><Stat label="Follow-ups due now" value={a.followUpsDue} /></div>
        <div title={METRIC_DEFINITIONS.consultationsScheduled}><Stat label="Consultations" value={a.consultationsScheduled} /></div>
        <div title={METRIC_DEFINITIONS.quotationsSent}><Stat label="Quotations sent" value={a.quotationsSent} hint={a.quotationsValueMinor !== null ? `${formatMoney(a.quotationsValueMinor, cur)} total` : undefined} /></div>
        <div title={METRIC_DEFINITIONS.confirmedBookings}><Stat label="Bookings confirmed" value={a.confirmedBookings} /></div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader title="Enquiries per day" />
          <div className="p-5">
            <DailyColumns data={a.daily} label="Enquiries per day" />
          </div>
        </Card>
        <Card>
          <CardHeader title="Leads by current status" description="Leads created in the period" />
          <div className="p-5">
            <BarList label="Leads by status" data={a.leadsByStatus.map((s) => ({ label: LEAD_STATUS_LABELS[s.status as LeadStatus] ?? s.status, value: s.count }))} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Lead sources" />
          <div className="p-5">
            <BarList label="Lead sources" data={a.sources.map((s) => ({ label: LEAD_SOURCE_LABELS[s.source as LeadSource] ?? s.source, value: s.count }))} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Service demand" description="Services requested in enquiries" />
          <div className="p-5">
            <BarList label="Service demand" data={a.serviceDemand.map((s) => ({ label: s.name, value: s.count }))} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Lost-lead reasons" description={METRIC_DEFINITIONS.lostReasons} />
          <div className="p-5">
            <BarList label="Lost-lead reasons" data={a.lostReasons.map((s) => ({ label: s.reason, value: s.count }))} />
          </div>
        </Card>
      </div>

      <Card className="mt-6 p-5">
        <h2 className="text-sm font-semibold">Metric definitions</h2>
        <dl className="mt-3 grid gap-x-8 gap-y-2 text-xs sm:grid-cols-2">
          {Object.entries(METRIC_DEFINITIONS).map(([k, v]) => (
            <div key={k}>
              <dt className="font-medium text-ink-soft">{k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}</dt>
              <dd className="text-muted">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </>
  );
}
