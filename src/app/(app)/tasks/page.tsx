import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { rescheduleTaskAction, setTaskStatusAction } from "@/app/actions/work";
import { ActionForm, DialogButton, SubmitButton } from "@/components/client/forms";
import { TaskForm } from "@/components/task-form";
import { Badge, Card, EmptyState, Field, Input, PageHeader, Tabs, cn } from "@/components/ui";
import { TASK_TYPE_LABELS, roleAtLeast } from "@/lib/domain";
import { addDaysToDateString, dateInTz, formatInTz, zonedInstant } from "@/lib/time";
import { inStudio } from "@/server/auth/context";
import { listMembers } from "@/server/services/leads";
import { listTasks } from "@/server/services/tasks";

export const metadata = { title: "Follow-ups" };

const SCOPES = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "done", label: "Completed" },
] as const;

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ scope?: string; mine?: string }> }) {
  const sp = await searchParams;
  const scope = (SCOPES.find((s) => s.key === sp.scope)?.key ?? "today") as (typeof SCOPES)[number]["key"];
  const mine = sp.mine === "1";
  const data = await inStudio("viewer", async (svc, ctx) => {
    const tz = ctx.studio.timezone;
    const now = new Date();
    const dayEnd = zonedInstant(addDaysToDateString(dateInTz(now, tz), 1), "00:00", tz);
    const assignedTo = mine ? ("me" as const) : undefined;
    const [overdue, today, upcoming, done, members] = await Promise.all([
      listTasks(svc, { scope: "overdue", assignedTo }, now, dayEnd),
      listTasks(svc, { scope: "today", assignedTo }, now, dayEnd),
      listTasks(svc, { scope: "upcoming", assignedTo }, now, dayEnd),
      listTasks(svc, { scope: "done", assignedTo }, now, dayEnd),
      listMembers(svc),
    ]);
    return { tz, overdue, today, upcoming, done: done.slice(-50).reverse(), members, ctx };
  });
  const rows = data[scope];
  const canEdit = roleAtLeast(data.ctx.role, "staff");
  const todayStr = dateInTz(new Date(), data.tz);
  const q = (s: string) => `/tasks?scope=${s}${mine ? "&mine=1" : ""}`;

  return (
    <>
      <PageHeader
        title="Follow-ups"
        description="Tasks created by your team and by automations. Due times use your studio time zone."
        actions={
          <>
            <Link href={`/tasks?scope=${scope}${mine ? "" : "&mine=1"}`} className={cn("rounded-lg border px-3 py-2 text-sm", mine ? "border-gold bg-gold-soft text-gold-strong" : "border-line-strong bg-white")}>
              {mine ? "Showing my tasks" : "Show only mine"}
            </Link>
            {canEdit && (
              <DialogButton label="New task" title="New task" variant="primary">
                <TaskForm members={data.members} today={todayStr} />
              </DialogButton>
            )}
          </>
        }
      />
      <Tabs current={scope} items={SCOPES.map((s) => ({ key: s.key, label: s.label, href: q(s.key), count: data[s.key].length }))} />
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<CheckCircle2 size={28} />} title={scope === "overdue" ? "Nothing overdue" : scope === "done" ? "No completed tasks yet" : "No tasks here"} description={scope === "today" ? "Enjoy the calm – or check upcoming tasks." : undefined} />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <p className={cn("font-medium", t.status !== "open" && "text-muted line-through")}>{t.title}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <Badge tone={t.type === "follow_up" ? "gold" : "neutral"}>{TASK_TYPE_LABELS[t.type]}</Badge>
                    {t.leadId ? (
                      <Link href={`/leads/${t.leadId}`} className="hover:underline">
                        {t.leadName} <span className="font-mono">{t.leadReference}</span>
                      </Link>
                    ) : (
                      "No lead"
                    )}
                    <span>· {t.assigneeName ?? "Unassigned"}</span>
                    {t.createdByType === "automation" && <span>· created by automation</span>}
                  </p>
                  {t.description && <p className="mt-1 text-sm text-ink-soft">{t.description}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn("text-xs", t.status === "open" && t.dueAt < new Date() ? "font-semibold text-danger" : "text-muted")}>
                    {t.status === "open" ? "Due " : t.status === "done" ? "Done · was due " : "Cancelled · was due "}
                    {formatInTz(t.dueAt, data.tz, "EEE d MMM, h:mm a")}
                  </span>
                  {canEdit && t.status === "open" && (
                    <>
                      <ActionForm action={setTaskStatusAction} showMessage={false}>
                        <input type="hidden" name="taskId" value={t.id} />
                        <input type="hidden" name="status" value="done" />
                        <SubmitButton size="sm" variant="secondary">
                          Complete
                        </SubmitButton>
                      </ActionForm>
                      <DialogButton label="Reschedule" title="Reschedule task" size="sm" variant="ghost">
                        <ActionForm action={rescheduleTaskAction} className="space-y-4">
                          <input type="hidden" name="taskId" value={t.id} />
                          <div className="grid gap-4 sm:grid-cols-2">
                            <Field label="Date" htmlFor={`d-${t.id}`} name="dueDate">
                              <Input id={`d-${t.id}`} name="dueDate" type="date" defaultValue={dateInTz(t.dueAt, data.tz)} required />
                            </Field>
                            <Field label="Time" htmlFor={`t-${t.id}`}>
                              <Input id={`t-${t.id}`} name="dueTime" type="time" defaultValue={formatInTz(t.dueAt, data.tz, "HH:mm")} />
                            </Field>
                          </div>
                          <SubmitButton>Save</SubmitButton>
                        </ActionForm>
                      </DialogButton>
                      <ActionForm action={setTaskStatusAction} showMessage={false}>
                        <input type="hidden" name="taskId" value={t.id} />
                        <input type="hidden" name="status" value="cancelled" />
                        <SubmitButton size="sm" variant="ghost">
                          Cancel
                        </SubmitButton>
                      </ActionForm>
                    </>
                  )}
                  {canEdit && t.status !== "open" && (
                    <ActionForm action={setTaskStatusAction} showMessage={false}>
                      <input type="hidden" name="taskId" value={t.id} />
                      <input type="hidden" name="status" value="open" />
                      <SubmitButton size="sm" variant="ghost">
                        Reopen
                      </SubmitButton>
                    </ActionForm>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
