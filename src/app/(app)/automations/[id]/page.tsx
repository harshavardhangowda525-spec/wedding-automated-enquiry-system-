import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteRuleAction } from "@/app/actions/settings";
import { ConfirmAction } from "@/components/client/forms";
import { RuleEditor } from "@/components/client/rule-editor";
import { RunList } from "@/components/run-list";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { actionsSchema, conditionsSchema } from "@/lib/automation-schema";
import { roleAtLeast } from "@/lib/domain";
import { inStudio } from "@/server/auth/context";
import { listMembers } from "@/server/services/leads";
import { getRule, listRuns, listTemplates } from "@/server/services/settings";

export const metadata = { title: "Automation rule" };

export default async function RulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await inStudio("viewer", async (svc, ctx) => {
    const rule = await getRule(svc, id).catch(() => null);
    if (!rule) return null;
    return { rule, runs: await listRuns(svc, { ruleId: id, limit: 50 }), templates: await listTemplates(svc), members: await listMembers(svc), ctx };
  });
  if (!data) notFound();
  const { rule, ctx } = data;
  const isAdmin = roleAtLeast(ctx.role, "admin");
  return (
    <>
      <div className="mb-3 text-sm">
        <Link href="/automations" className="text-muted hover:text-ink">
          ← Automations
        </Link>
      </div>
      <PageHeader
        title={rule.name}
        description={rule.isDefault ? "Default rule – part of the starter follow-up policy." : undefined}
        actions={isAdmin ? <ConfirmAction action={deleteRuleAction} label="Delete rule" variant="danger" title="Delete this rule?" description="Scheduled runs for this rule will be removed." confirmLabel="Delete" hidden={{ ruleId: rule.id }} /> : undefined}
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="p-6 xl:col-span-2">
          {isAdmin ? (
            <RuleEditor
              ruleId={rule.id}
              templates={data.templates.map((t) => ({ id: t.id, name: t.name, channel: t.channel, approved: t.approved }))}
              members={data.members.map((m) => ({ userId: m.userId, name: m.fullName ?? m.email }))}
              initial={{
                name: rule.name,
                description: rule.description ?? "",
                trigger: rule.trigger,
                conditions: conditionsSchema.parse(rule.conditions),
                actions: actionsSchema.parse(rule.actions),
                delayMinutes: rule.delayMinutes,
                delayBusinessDays: rule.delayBusinessDays,
                respectBusinessHours: rule.respectBusinessHours,
                enabled: rule.enabled,
                dryRun: rule.dryRun,
                maxAttempts: rule.maxAttempts,
              }}
            />
          ) : (
            <p className="text-sm text-muted">Only studio owners and admins can edit automation rules.</p>
          )}
        </Card>
        <Card>
          <CardHeader title="Execution history" />
          <RunList runs={data.runs} tz={ctx.studio.timezone} showRule={false} />
        </Card>
      </div>
    </>
  );
}
