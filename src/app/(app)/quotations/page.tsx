import { FileText } from "lucide-react";
import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader, QuotationStatusBadge, Tabs, td, th } from "@/components/ui";
import { QUOTATION_STATUSES, type QuotationStatus } from "@/lib/domain";
import { formatMoney } from "@/lib/money";
import { formatInTz } from "@/lib/time";
import { inStudio } from "@/server/auth/context";
import { listQuotations } from "@/server/services/quotations";

export const metadata = { title: "Quotations" };

export default async function QuotationsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const filter = (QUOTATION_STATUSES as readonly string[]).includes(status ?? "") ? (status as QuotationStatus) : undefined;
  const { rows, tz } = await inStudio("viewer", async (svc, ctx) => ({ rows: await listQuotations(svc, { status: filter }), tz: ctx.studio.timezone }));
  return (
    <>
      <PageHeader title="Quotations" description="Create quotations from a lead. Totals are calculated on the server from your configured prices." />
      <Tabs current={filter ?? "all"} items={[{ key: "all", label: "All", href: "/quotations" }, ...QUOTATION_STATUSES.map((s) => ({ key: s, label: s[0].toUpperCase() + s.slice(1), href: `/quotations?status=${s}` }))]} />
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<FileText size={28} />} title="No quotations" description="Open a lead and choose “New quotation”, or let the AI assistant draft one from your service list." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr>
                  <th className={th}>Number</th>
                  <th className={th}>Client</th>
                  <th className={th}>Status</th>
                  <th className={th}>Total</th>
                  <th className={th}>Valid until</th>
                  <th className={th}>Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((q) => (
                  <tr key={q.id} className="hover:bg-sand/40">
                    <td className={td}>
                      <Link href={`/quotations/${q.id}`} className="font-mono text-xs font-semibold hover:underline">
                        {q.number}
                      </Link>
                      {q.aiAssisted && <Badge tone="gold" className="ml-2">AI-assisted</Badge>}
                    </td>
                    <td className={td}>
                      <Link href={`/leads/${q.leadId}`} className="hover:underline">
                        {q.clientName}
                      </Link>
                      <div className="text-xs text-muted">{q.title}</div>
                    </td>
                    <td className={td}>
                      <QuotationStatusBadge status={q.status} />
                    </td>
                    <td className={`${td} font-medium`}>{formatMoney(q.totalMinor, q.currency)}</td>
                    <td className={`${td} text-xs`}>{q.validUntil ? formatInTz(`${q.validUntil}T12:00:00Z`, tz, "d MMM yyyy") : "—"}</td>
                    <td className={`${td} text-xs text-muted`}>{formatInTz(q.createdAt, tz, "d MMM yyyy")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
