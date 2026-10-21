import { RuleEditor } from "@/components/client/rule-editor";
import { Card, PageHeader } from "@/components/ui";
import { inStudio } from "@/server/auth/context";
import { listMembers } from "@/server/services/leads";
import { listTemplates } from "@/server/services/settings";

export const metadata = { title: "New automation" };

export default async function NewRulePage() {
  const { templates, members } = await inStudio("admin", async (svc) => ({ templates: await listTemplates(svc), members: await listMembers(svc) }));
  return (
    <>
      <PageHeader title="New automation rule" description="Start in dry-run mode to see what the rule would do before it acts." />
      <Card className="p-6">
        <RuleEditor
          templates={templates.map((t) => ({ id: t.id, name: t.name, channel: t.channel, approved: t.approved }))}
          members={members.map((m) => ({ userId: m.userId, name: m.fullName ?? m.email }))}
          initial={{
            name: "",
            description: "",
            trigger: "lead_status_changed",
            conditions: [],
            actions: [{ type: "create_task", title: "Follow up with {{contact_name}}", taskType: "follow_up", dueInHours: 0 }],
            delayMinutes: 0,
            delayBusinessDays: 0,
            respectBusinessHours: true,
            enabled: true,
            dryRun: true,
            maxAttempts: 3,
          }}
        />
      </Card>
    </>
  );
}
