import Link from "next/link";
import { setPausedAction, toggleRuleAction } from "@/app/actions/settings";
import { ActionForm, SubmitButton } from "@/components/client/forms";
import { RunList } from "@/components/run-list";
import { Alert, Badge, ButtonLink, Card, CardHeader, PageHeader } from "@/components/ui";
import { AUTOMATION_TRIGGER_LABELS, roleAtLeast } from "@/lib/domain";
import { inStudio } from "@/server/auth/context";
import { listRules, listRuns } from "@/server/services/settings";

export const metadata = { title: "Automations" };

function delayText(r: { delayBusinessDays: number; delayMinutes: number; respectBusinessHours: boolean }) {
  const parts = [];
  if (r.delayBusinessDays) parts.push(`${r.delayBusinessDays} business day${r.delayBusinessDays > 1 ? "s" : ""}`);
  if (r.delayMinutes) parts.push(`${r.delayMinutes} min`);
  return `${parts.length ? `After ${parts.join(" + ")}` : "Immediately"}${r.respectBusinessHours ? ", within business hours" : ""}`;
}

export default async function AutomationsPage() {
  const { rules, runs, ctx } = await inStudio("viewer", async (svc, ctx) => ({ rules: await listRules(svc), runs: await listRuns(svc, { limit: 15 }), ctx }));
  const isAdmin = roleAtLeast(ctx.role, "admin");
  const canPause = roleAtLeast(ctx.role, "staff");
  const paused = ctx.studio.automationPaused;
  return (
    <>
      <PageHeader
        title="Automations"
        description="Durable, event-driven rules. They run on the server whether or not anyone is logged in, and never send messages without approval unless you explicitly allow it for an approved template."
        actions={
          <>
            {canPause && (
              <ActionForm action={setPausedAction} showMessage={false}>
                <input type="hidden" name="paused" value={paused ? "false" : "true"} />
                <SubmitButton variant={paused ? "gold" : "danger"}>{paused ? "Resume automation" : "Pause all automation"}</SubmitButton>
              </ActionForm>
            )}
            {isAdmin && <ButtonLink href="/automations/new">New rule</ButtonLink>}
          </>
        }
      />
      {paused && (
        <Alert tone="danger" className="mb-4" title="Automation is paused">
          Scheduled steps are skipped and automated sends are held until you resume.
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Rules" description="Default rules implement a gentle follow-up policy. Edit them to fit your studio." />
          <ul className="divide-y divide-line">
            {rules.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <Link href={`/automations/${r.id}`} className="font-medium hover:underline">
                    {r.name}
                  </Link>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <Badge tone="gold">{AUTOMATION_TRIGGER_LABELS[r.trigger]}</Badge>
                    {delayText(r)}
                    {r.dryRun && <Badge tone="info">Dry run</Badge>}
                    {!r.enabled && <Badge>Disabled</Badge>}
                  </p>
                  {r.description && <p className="mt-1 text-xs text-ink-soft">{r.description}</p>}
                </div>
                {isAdmin && (
                  <ActionForm action={toggleRuleAction} showMessage={false}>
                    <input type="hidden" name="ruleId" value={r.id} />
                    <input type="hidden" name="enabled" value={r.enabled ? "false" : "true"} />
                    <SubmitButton size="sm" variant={r.enabled ? "secondary" : "primary"}>
                      {r.enabled ? "Disable" : "Enable"}
                    </SubmitButton>
                  </ActionForm>
                )}
              </li>
            ))}
            {rules.length === 0 && <li className="px-5 py-8 text-center text-sm text-muted">No rules yet.</li>}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Recent runs" action={<ButtonLink href="/automations/runs" size="sm" variant="ghost">All runs</ButtonLink>} />
          <RunList runs={runs} tz={ctx.studio.timezone} />
        </Card>
      </div>
    </>
  );
}
