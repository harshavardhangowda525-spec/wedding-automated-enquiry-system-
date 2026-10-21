import { notFound } from "next/navigation";
import { addSupportNoteAction, setStudioStatusAction } from "@/app/actions/admin";
import { ActionForm, ConfirmAction, SubmitButton } from "@/components/client/forms";
import { Badge, Card, CardHeader, PageHeader, Stat, Textarea } from "@/components/ui";
import { formatInTz } from "@/lib/time";
import { requirePlatformAdmin } from "@/server/auth/context";
import { clientIpHash } from "@/server/lib/request";
import { adminStudioDetail } from "@/server/services/admin";

export const metadata = { title: "Studio (admin)" };

export default async function AdminStudio({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePlatformAdmin();
  const d = await adminStudioDetail(user, id, { ipHash: await clientIpHash() }).catch(() => null);
  if (!d) notFound();
  const tz = d.studio.timezone;
  const suspended = d.studio.status === "suspended";
  return (
    <>
      <PageHeader
        title={d.studio.name}
        description={`/${d.studio.slug} · created ${formatInTz(d.studio.createdAt, tz, "d MMM yyyy")} · this visit was recorded in the studio's audit log`}
        actions={
          <ConfirmAction
            action={setStudioStatusAction}
            label={suspended ? "Reactivate studio" : "Suspend studio"}
            variant={suspended ? "primary" : "danger"}
            title={suspended ? "Reactivate this studio?" : "Suspend this studio?"}
            description={suspended ? "Members regain access and the enquiry form reopens." : "Members lose access and the public enquiry form stops accepting enquiries."}
            confirmLabel={suspended ? "Reactivate" : "Suspend"}
            hidden={{ studioId: d.studio.id, status: suspended ? "active" : "suspended" }}
          />
        }
      />
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Leads" value={d.counts?.leads ?? 0} />
        <Stat label="Open tasks" value={d.counts?.open_tasks ?? 0} />
        <Stat label="Failed messages" value={d.counts?.messages_failed ?? 0} />
        <Stat label="Failed runs" value={d.counts?.runs_failed ?? 0} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Integrations" />
          <ul className="divide-y divide-line">
            {d.integrations.length === 0 && <li className="px-5 py-4 text-sm text-muted">None configured.</li>}
            {d.integrations.map((i) => (
              <li key={i.provider} className="px-5 py-3 text-sm">
                {i.provider} <Badge>{i.status}</Badge>
                {i.lastError && <p className="text-xs text-danger">{i.lastError}</p>}
              </li>
            ))}
          </ul>
          <CardHeader title="Support notes" />
          <ActionForm action={addSupportNoteAction} resetOnSuccess className="space-y-2 p-5">
            <input type="hidden" name="studioId" value={d.studio.id} />
            <Textarea name="body" rows={3} placeholder="Internal note (visible to platform admins only)" aria-label="Support note" required />
            <SubmitButton size="sm">Add note</SubmitButton>
          </ActionForm>
          <ul className="divide-y divide-line">
            {d.notes.map((n) => (
              <li key={n.id} className="px-5 py-3 text-sm">
                <p className="whitespace-pre-wrap">{n.body}</p>
                <p className="text-xs text-muted">{formatInTz(n.createdAt, tz)}</p>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Audit trail" description="Last 100 events" />
          <ul className="max-h-[36rem] divide-y divide-line overflow-y-auto">
            {d.auditTrail.map((a) => (
              <li key={a.id} className="px-5 py-2.5 text-sm">
                <span className="font-mono text-xs">{a.action}</span> <Badge>{a.actorType}</Badge>
                <p className="text-xs text-muted">{formatInTz(a.createdAt, tz)}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
