import { Badge, Card, PageHeader, td, th } from "@/components/ui";
import { formatInTz } from "@/lib/time";
import { requirePlatformAdmin } from "@/server/auth/context";
import { adminAuditEvents } from "@/server/services/admin";

export const metadata = { title: "Audit log (admin)" };

export default async function AdminAudit() {
  const user = await requirePlatformAdmin();
  const rows = await adminAuditEvents(user);
  return (
    <>
      <PageHeader title="Audit log" description="Sensitive actions across all studios, last 30 days (times in IST)." />
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr>
                <th className={th}>When</th>
                <th className={th}>Studio</th>
                <th className={th}>Action</th>
                <th className={th}>Actor</th>
                <th className={th}>Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ log, studioName }) => (
                <tr key={log.id}>
                  <td className={`${td} whitespace-nowrap text-xs`}>{formatInTz(log.createdAt, "Asia/Kolkata", "d MMM, h:mm a")}</td>
                  <td className={td}>{studioName ?? "Platform"}</td>
                  <td className={`${td} font-mono text-xs`}>{log.action}</td>
                  <td className={td}>
                    <Badge>{log.actorType}</Badge>
                  </td>
                  <td className={`${td} max-w-sm truncate text-xs text-muted`}>{Object.keys(log.metadata as object).length ? JSON.stringify(log.metadata) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
