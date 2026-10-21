import { RunList } from "@/components/run-list";
import { Card, PageHeader } from "@/components/ui";
import { inStudio } from "@/server/auth/context";
import { listRuns } from "@/server/services/settings";

export const metadata = { title: "Automation runs" };

export default async function RunsPage() {
  const { runs, tz } = await inStudio("viewer", async (svc, ctx) => ({ runs: await listRuns(svc, { limit: 200 }), tz: ctx.studio.timezone }));
  return (
    <>
      <PageHeader title="Execution history" description="Every scheduled, completed, skipped, dry-run and failed automation run, newest first." />
      <Card>
        <RunList runs={runs} tz={tz} />
      </Card>
    </>
  );
}
