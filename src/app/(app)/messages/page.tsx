import { Inbox } from "lucide-react";
import Link from "next/link";
import { approveMessageAction, cancelMessageAction } from "@/app/actions/work";
import { ActionForm, SubmitButton } from "@/components/client/forms";
import { Alert, Badge, Card, EmptyState, MessageStatusBadge, PageHeader, Tabs } from "@/components/ui";
import { roleAtLeast, type MessageStatus } from "@/lib/domain";
import { formatInTz } from "@/lib/time";
import { inStudio } from "@/server/auth/context";
import { channelStatus, listMessages } from "@/server/messaging/service";

export const metadata = { title: "Messages" };

const TABS: { key: string; label: string; statuses: MessageStatus[] }[] = [
  { key: "approval", label: "Awaiting approval", statuses: ["draft", "awaiting_approval"] },
  { key: "outbox", label: "Queued", statuses: ["queued", "sending"] },
  { key: "sent", label: "Sent & delivered", statuses: ["sent", "delivered"] },
  { key: "problems", label: "Failed & skipped", statuses: ["failed", "skipped"] },
  { key: "cancelled", label: "Cancelled", statuses: ["cancelled"] },
];

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const current = TABS.find((t) => t.key === tab) ?? TABS[0];
  const data = await inStudio("viewer", async (svc, ctx) => ({
    rows: (await listMessages(svc, { status: current.statuses, limit: 200 })).filter((r) => r.message.direction === "outbound"),
    channels: await channelStatus(svc.tx, ctx.studio),
    ctx,
  }));
  const canEdit = roleAtLeast(data.ctx.role, "staff");
  const tz = data.ctx.studio.timezone;
  return (
    <>
      <PageHeader title="Messages" description="Nothing is sent until a team member approves it (or a narrowly scoped automation you enabled sends a pre-approved template). Each send re-checks consent, opt-out, duplicates and the WhatsApp window." />
      {data.channels.demo ? (
        <Alert tone="warning" className="mb-4" title="Demo messaging">
          Approved messages are simulated and shown as “Demo — not sent”. No one is contacted.
        </Alert>
      ) : (
        <div className="mb-4 flex flex-wrap gap-2 text-xs">
          <Badge tone={data.channels.whatsapp === "verified" ? "success" : data.channels.whatsapp === "not_configured" ? "danger" : "warning"}>WhatsApp: {data.channels.whatsapp.replace("_", " ")}</Badge>
          <Badge tone={data.channels.email === "configured" ? "success" : "danger"}>Email: {data.channels.email.replace("_", " ")}</Badge>
          <Link href="/settings/integrations" className="text-gold-strong underline">
            Manage integrations
          </Link>
        </div>
      )}
      <Tabs current={current.key} items={TABS.map((t) => ({ key: t.key, label: t.label, href: `/messages?tab=${t.key}` }))} />
      <Card>
        {data.rows.length === 0 ? (
          <EmptyState icon={<Inbox size={28} />} title="Nothing here" description={current.key === "approval" ? "No drafts are waiting for approval." : undefined} />
        ) : (
          <ul className="divide-y divide-line">
            {data.rows.map(({ message: m, leadName, leadReference, leadOptedOut }) => (
              <li key={m.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <Link href={`/leads/${m.leadId}`} className="text-sm font-medium text-ink hover:underline">
                    {leadName}
                  </Link>
                  <span className="font-mono">{leadReference}</span>
                  <Badge tone={m.channel === "whatsapp" ? "success" : "info"}>{m.channel === "whatsapp" ? "WhatsApp" : "Email"}</Badge>
                  {m.aiGenerated && <Badge tone="gold">AI draft</Badge>}
                  {m.createdByType === "automation" && <Badge>Automation</Badge>}
                  <MessageStatusBadge status={m.status} isDemo={m.isDemo} />
                  {leadOptedOut && <Badge tone="danger">Client opted out</Badge>}
                  <span>{formatInTz(m.createdAt, tz, "d MMM, h:mm a")}</span>
                </div>
                {m.subject && <p className="mt-1.5 text-sm font-medium">{m.subject}</p>}
                <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-sm text-ink-soft">{m.body}</p>
                {m.reviewNotes && ["draft", "awaiting_approval"].includes(m.status) && <p className="mt-1 whitespace-pre-wrap text-xs text-warning">{m.reviewNotes}</p>}
                {(m.error || m.skipReason) && <p className="mt-1 text-xs text-danger">{m.error ?? m.skipReason}</p>}
                {m.sentAt && <p className="mt-1 text-xs text-muted">Handed to provider {formatInTz(m.sentAt, tz, "d MMM, h:mm a")}{m.deliveredAt ? ` · delivery confirmed ${formatInTz(m.deliveredAt, tz, "d MMM, h:mm a")}` : m.isDemo ? "" : " · delivery not yet confirmed"}</p>}
                {canEdit && ["draft", "awaiting_approval"].includes(m.status) && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <ActionForm action={approveMessageAction} showMessage={false}>
                      <input type="hidden" name="messageId" value={m.id} />
                      <input type="hidden" name="leadId" value={m.leadId} />
                      <SubmitButton size="sm" variant="gold" disabled={leadOptedOut}>
                        Approve &amp; send
                      </SubmitButton>
                    </ActionForm>
                    <Link href={`/leads/${m.leadId}`} className="rounded-lg px-3 py-1.5 text-sm text-ink-soft hover:bg-sand">
                      Review / edit on lead
                    </Link>
                    <ActionForm action={cancelMessageAction} showMessage={false}>
                      <input type="hidden" name="messageId" value={m.id} />
                      <input type="hidden" name="leadId" value={m.leadId} />
                      <SubmitButton size="sm" variant="ghost">
                        Discard
                      </SubmitButton>
                    </ActionForm>
                  </div>
                )}
                {canEdit && m.status === "queued" && (
                  <div className="mt-3">
                    <ActionForm action={cancelMessageAction} showMessage={false}>
                      <input type="hidden" name="messageId" value={m.id} />
                      <input type="hidden" name="leadId" value={m.leadId} />
                      <SubmitButton size="sm" variant="ghost">
                        Cancel send
                      </SubmitButton>
                    </ActionForm>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
