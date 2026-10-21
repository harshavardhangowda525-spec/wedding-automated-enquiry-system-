import Link from "next/link";
import { Badge } from "@/components/ui";
import { formatInTz } from "@/lib/time";

type Run = {
  run: { id: string; status: string; scheduledFor: Date; finishedAt: Date | null; skipReason: string | null; error: string | null; result: unknown[]; dryRun: boolean; attempts: number; leadId: string | null };
  ruleName: string;
  leadName: string | null;
};

const tone = (s: string) => (s === "completed" ? "success" : s === "failed" ? "danger" : s === "dry_run" ? "info" : s === "scheduled" || s === "running" ? "gold" : "neutral");

export function RunList({ runs, tz, showRule = true }: { runs: Run[]; tz: string; showRule?: boolean }) {
  if (runs.length === 0) return <p className="px-5 py-8 text-center text-sm text-muted">No runs yet.</p>;
  return (
    <ul className="divide-y divide-line">
      {runs.map(({ run, ruleName, leadName }) => (
        <li key={run.id} className="px-5 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={tone(run.status)}>{run.status.replace("_", " ")}</Badge>
            {showRule && <span className="font-medium">{ruleName}</span>}
            {run.leadId && (
              <Link href={`/leads/${run.leadId}`} className="text-ink-soft hover:underline">
                {leadName}
              </Link>
            )}
            <span className="text-xs text-muted">
              {run.status === "scheduled" ? "Scheduled for " : "Ran "}
              {formatInTz(run.finishedAt ?? run.scheduledFor, tz, "d MMM, h:mm a")}
              {run.attempts > 1 ? ` · ${run.attempts} attempts` : ""}
            </span>
          </div>
          {run.skipReason && <p className="mt-1 text-xs text-muted">{run.skipReason}</p>}
          {run.error && <p className="mt-1 text-xs text-danger">{run.error}</p>}
          {Array.isArray(run.result) && run.result.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-xs text-ink-soft">
              {(run.result as { detail: string; outcome: string }[]).map((r, i) => (
                <li key={i}>
                  {r.outcome === "planned" ? "Would: " : ""}
                  {r.detail}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
