import "server-only";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { ServiceContext } from "@/server/auth/context";

export const rangeSchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine((r) => r.from <= r.to, "Start date must be before end date");

export const METRIC_DEFINITIONS: Record<string, string> = {
  totalEnquiries: "Leads created in the selected period (all sources).",
  newEnquiries: "Leads created in the period that are still at New Enquiry.",
  followUpsDue: "Open follow-up and call tasks due now or earlier (not limited to the period).",
  firstResponse: "Time from enquiry to the first successful contact (logged call/meeting or a real message handed to WhatsApp/email). Demo sends are excluded.",
  consultationsScheduled: "Consultations on the calendar dated within the period.",
  quotationsSent: "Quotations marked sent during the period.",
  confirmedBookings: "Leads moved to Booking Confirmed during the period.",
  conversionRate: "Of leads created in the period, the share now at Booking Confirmed or Won.",
  revenue: "Sum of recorded booking values (quotation amount at confirmation, or staff-entered value) for bookings confirmed in the period.",
  lostReasons: "Reasons recorded when leads created in the period were marked Lost or Not Interested.",
};

export async function getAnalytics(svc: ServiceContext, input: { from: string; to: string }, tz: string) {
  const { from, to } = rangeSchema.parse(input);
  const sid = svc.studioId;
  // Period boundaries interpreted in the studio's time zone.
  const start = sql`(${from}::date)::timestamp at time zone ${tz}`;
  const end = sql`((${to}::date + 1))::timestamp at time zone ${tz}`;
  const inRange = (col: unknown) => sql`${col} >= ${start} and ${col} < ${end}`;

  const q = async <T extends Record<string, unknown>>(query: ReturnType<typeof sql>) => (await svc.tx.execute<T>(query)).rows;

  const [totals] = await q<{ total: number; new_count: number; booked: number; demo: number }>(sql`
    select count(*)::int as total,
      count(*) filter (where status = 'new_enquiry')::int as new_count,
      count(*) filter (where status in ('booking_confirmed','won'))::int as booked,
      count(*) filter (where is_demo)::int as demo
    from wf.leads where studio_id = ${sid} and ${inRange(sql.raw("created_at"))}`);

  const byStatus = await q<{ status: string; n: number }>(sql`
    select status::text, count(*)::int as n from wf.leads
    where studio_id = ${sid} and ${inRange(sql.raw("created_at"))} group by status order by n desc`);

  const [followUps] = await q<{ n: number }>(sql`
    select count(*)::int as n from wf.tasks
    where studio_id = ${sid} and status = 'open' and type in ('follow_up','call') and due_at <= now()`);

  const [response] = await q<{ responded: number; avg_hours: number | null; median_hours: number | null }>(sql`
    select count(*)::int as responded,
      avg(extract(epoch from (first_contacted_at - created_at)) / 3600)::float as avg_hours,
      percentile_cont(0.5) within group (order by extract(epoch from (first_contacted_at - created_at)) / 3600)::float as median_hours
    from wf.leads where studio_id = ${sid} and first_contacted_at is not null and ${inRange(sql.raw("created_at"))}`);

  const [consults] = await q<{ n: number }>(sql`
    select count(*)::int as n from wf.calendar_entries
    where studio_id = ${sid} and type = 'consultation' and entry_date between ${from}::date and ${to}::date`);

  const [quotes] = await q<{ n: number; value: number | null }>(sql`
    select count(*)::int as n, sum(total_minor)::bigint as value from wf.quotations
    where studio_id = ${sid} and sent_at is not null and ${inRange(sql.raw("sent_at"))}`);

  const [bookings] = await q<{ n: number; revenue: number | null }>(sql`
    with confirmed as (
      select distinct a.lead_id from wf.activities a
      where a.studio_id = ${sid} and a.type = 'status_changed' and a.data->>'to' = 'booking_confirmed' and ${inRange(sql.raw("a.created_at"))}
    )
    select count(*)::int as n, sum(l.revenue_minor)::bigint as revenue
    from confirmed c join wf.leads l on l.id = c.lead_id where l.status in ('booking_confirmed','won')`);

  const lostReasons = await q<{ reason: string; n: number }>(sql`
    select coalesce(nullif(trim(lost_reason), ''), 'Not recorded') as reason, count(*)::int as n from wf.leads
    where studio_id = ${sid} and status in ('lost','not_interested') and ${inRange(sql.raw("created_at"))}
    group by 1 order by n desc limit 10`);

  const sources = await q<{ source: string; n: number }>(sql`
    select source, count(*)::int as n from wf.leads
    where studio_id = ${sid} and ${inRange(sql.raw("created_at"))} group by source order by n desc`);

  const serviceDemand = await q<{ name: string; n: number }>(sql`
    select s.name, count(*)::int as n
    from wf.leads l cross join lateral unnest(l.service_ids) as sid_(service_id)
    join wf.services s on s.id = sid_.service_id
    where l.studio_id = ${sid} and ${inRange(sql.raw("l.created_at"))}
    group by s.name order by n desc limit 12`);

  const daily = await q<{ day: string; n: number }>(sql`
    select to_char((created_at at time zone ${tz})::date, 'YYYY-MM-DD') as day, count(*)::int as n
    from wf.leads where studio_id = ${sid} and ${inRange(sql.raw("created_at"))} group by 1 order by 1`);

  const total = Number(totals?.total ?? 0);
  return {
    range: { from, to },
    totalEnquiries: total,
    newEnquiries: Number(totals?.new_count ?? 0),
    demoLeadsInRange: Number(totals?.demo ?? 0),
    leadsByStatus: byStatus.map((r) => ({ status: r.status, count: Number(r.n) })),
    followUpsDue: Number(followUps?.n ?? 0),
    firstResponse: {
      responded: Number(response?.responded ?? 0),
      averageHours: response?.avg_hours ?? null,
      medianHours: response?.median_hours ?? null,
    },
    consultationsScheduled: Number(consults?.n ?? 0),
    quotationsSent: Number(quotes?.n ?? 0),
    quotationsValueMinor: quotes?.value !== null && quotes?.value !== undefined ? Number(quotes.value) : null,
    confirmedBookings: Number(bookings?.n ?? 0),
    conversionRate: total > 0 ? Number(totals.booked) / total : null,
    revenueMinor: bookings?.revenue !== null && bookings?.revenue !== undefined ? Number(bookings.revenue) : null,
    lostReasons: lostReasons.map((r) => ({ reason: r.reason, count: Number(r.n) })),
    sources: sources.map((r) => ({ source: r.source, count: Number(r.n) })),
    serviceDemand: serviceDemand.map((r) => ({ name: r.name, count: Number(r.n) })),
    daily: daily.map((r) => ({ day: r.day, count: Number(r.n) })),
  };
}

export type Analytics = Awaited<ReturnType<typeof getAnalytics>>;
