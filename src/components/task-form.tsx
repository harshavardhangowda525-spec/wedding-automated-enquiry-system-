import { createTaskAction } from "@/app/actions/work";
import { ActionForm, SubmitButton } from "@/components/client/forms";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { TASK_TYPES, TASK_TYPE_LABELS } from "@/lib/domain";

export function TaskForm({ leadId, members, today, defaultTitle }: { leadId?: string; members: { userId: string; fullName: string | null; email: string }[]; today: string; defaultTitle?: string }) {
  return (
    <ActionForm action={createTaskAction} className="space-y-4">
      {leadId && <input type="hidden" name="leadId" value={leadId} />}
      <Field label="Title" htmlFor="title">
        <Input id="title" name="title" defaultValue={defaultTitle} required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Type" htmlFor="type">
          <Select id="type" name="type" defaultValue="follow_up">
            {TASK_TYPES.map((t) => (
              <option key={t} value={t}>
                {TASK_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Due date" htmlFor="dueDate" name="dueDate">
          <Input id="dueDate" name="dueDate" type="date" defaultValue={today} required />
        </Field>
        <Field label="Time" htmlFor="dueTime">
          <Input id="dueTime" name="dueTime" type="time" defaultValue="11:00" />
        </Field>
      </div>
      <Field label="Assign to" htmlFor="assignedTo">
        <Select id="assignedTo" name="assignedTo" defaultValue="">
          <option value="">Unassigned</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.fullName ?? m.email}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Notes" htmlFor="description">
        <Textarea id="description" name="description" rows={2} />
      </Field>
      <SubmitButton>Schedule</SubmitButton>
    </ActionForm>
  );
}
