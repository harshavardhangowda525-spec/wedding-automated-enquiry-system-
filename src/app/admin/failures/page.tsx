import { retryJobAction } from "@/app/actions/admin";
import { ActionForm, SubmitButton } from "@/components/client/forms";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { formatInTz } from "@/lib/time";
import { requirePlatformAdmin } from "@/server/auth/context";
import { adminFailures } from "@/server/services/admin";

export const metadata = { title: "Failures (admin)" };
const TZ = "Asia/Kolkata";

export default async function AdminFailures() {
  const user = await requirePlatformAdmin();
  const f = await adminFailures(user);
  return (
    <>
      <PageHeader title="Failures & errors" description="Background jobs that exhausted retries, failed automation runs, failed sends and webhook errors. Times in IST." />
      <div className="space-y-6">
        <Card>
          <CardHeader title={`Dead jobs (${f.deadJobs.length})`} />
          <ul className="divide-y divide-line">
            {f.deadJobs.length === 0 && <li className="px-5 py-4 text-sm text-muted">None.</li>}
            {f.deadJobs.map(({ job, studioName }) => (
              <li key={job.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm">
                <div>
                  <p className="font-mono text-xs">{job.type}</p>
                  <p className="text-xs text-muted">
                    {studioName ?? "Platform"} · {job.attempts}/{job.maxAttempts} attempts · {formatInTz(job.updatedAt, TZ)}
                  </p>
                  {job.lastError && <p className="mt-1 text-xs text-danger">{job.lastError}</p>}
                </div>
                <ActionForm action={retryJobAction} showMessage={false}>
                  <input type="hidden" name="jobId" value={job.id} />
                  <SubmitButton size="sm" variant="secondary">
                    Retry
                  </SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title={`Failed automation runs (${f.failedRuns.length})`} />
          <ul className="divide-y divide-line">
            {f.failedRuns.length === 0 && <li className="px-5 py-4 text-sm text-muted">None.</li>}
            {f.failedRuns.map(({ run, studioName }) => (
              <li key={run.id} className="px-5 py-3 text-sm">
                {studioName} · <span className="text-xs text-muted">{formatInTz(run.createdAt, TZ)}</span>
                <p className="text-xs text-danger">{run.error}</p>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title={`Failed messages (${f.failedMessages.length})`} />
          <ul className="divide-y divide-line">
            {f.failedMessages.length === 0 && <li className="px-5 py-4 text-sm text-muted">None.</li>}
            {f.failedMessages.map((m) => (
              <li key={m.id} className="px-5 py-3 text-sm">
                {m.studioName} · {m.channel} · {m.provider ?? "—"}
                <p className="text-xs text-danger">{m.error}</p>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title={`Webhook errors (${f.webhookErrors.length})`} />
          <ul className="divide-y divide-line">
            {f.webhookErrors.length === 0 && <li className="px-5 py-4 text-sm text-muted">None.</li>}
            {f.webhookErrors.map((w) => (
              <li key={w.id} className="px-5 py-3 text-sm">
                <span className="font-mono text-xs">{w.eventKey}</span>
                <p className="text-xs text-danger">{w.error}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
