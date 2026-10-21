import Link from "next/link";
import { Badge, Card, CardHeader, PageHeader, Stat, td, th } from "@/components/ui";
import { requirePlatformAdmin } from "@/server/auth/context";
import { adminOverview } from "@/server/services/admin";

export const metadata = { title: "Platform admin" };

export default async function AdminHome() {
  const user = await requirePlatformAdmin();
  const o = await adminOverview(user);
  const runs = o.runsLast7Days;
  return (
    <>
      <PageHeader title="Platform overview" description="Infinity Web & Apps · studios, integrations and automation health." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Studios" value={o.studios.length} hint={`${o.studios.filter((s) => s.is_demo).length} sample`} />
        <Stat label="Pending jobs" value={o.jobs?.pending ?? 0} hint={`${o.jobs?.overdue ?? 0} overdue >10 min`} />
        <Stat label="Dead jobs" value={o.jobs?.dead ?? 0} hint="Exhausted retries" />
        <Stat label="Automation runs (7d)" value={Object.values(runs).reduce((a, b) => a + b, 0)} hint={`${runs.failed ?? 0} failed · ${runs.skipped ?? 0} skipped`} />
      </div>
      <Card className="mt-6">
        <CardHeader title="Platform configuration" />
        <dl className="grid gap-3 p-5 text-sm sm:grid-cols-2 lg:grid-cols-5">
          {Object.entries(o.platform).map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs uppercase tracking-wide text-muted">{k.replace(/([A-Z])/g, " $1")}</dt>
              <dd className="mt-0.5 font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card className="mt-6">
        <CardHeader title="Studios" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr>
                <th className={th}>Studio</th>
                <th className={th}>Status</th>
                <th className={th}>Members</th>
                <th className={th}>Leads</th>
                <th className={th}>Leads (30d)</th>
                <th className={th}>WhatsApp</th>
              </tr>
            </thead>
            <tbody>
              {o.studios.map((s) => {
                const wa = o.integrations.find((i) => i.studioId === s.id && i.provider === "whatsapp_cloud");
                return (
                  <tr key={s.id}>
                    <td className={td}>
                      <Link href={`/admin/studios/${s.id}`} className="font-medium hover:underline">
                        {s.name}
                      </Link>
                      <div className="text-xs text-muted">/{s.slug}</div>
                    </td>
                    <td className={td}>
                      <div className="flex flex-wrap gap-1">
                        <Badge tone={s.status === "active" ? "success" : "danger"}>{s.status}</Badge>
                        {s.is_demo && <Badge tone="warning">sample</Badge>}
                        {s.automation_paused && <Badge tone="danger">automation paused</Badge>}
                      </div>
                    </td>
                    <td className={td}>{s.members}</td>
                    <td className={td}>{s.leads}</td>
                    <td className={td}>{s.leads_30d}</td>
                    <td className={td}>
                      <Badge tone={wa?.status === "verified" ? "success" : wa?.status === "error" ? "danger" : "neutral"}>{wa?.status ?? "not configured"}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
