"use client";

import { Plus, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { saveRuleAction } from "@/app/actions/settings";
import { ActionForm, SubmitButton } from "@/components/client/forms";
import { Checkbox, Field, Input, Select, Textarea, buttonClass } from "@/components/ui";
import { CONDITION_FIELDS, CONDITION_OPS, type AutomationAction, type Condition } from "@/lib/automation-schema";
import {
  AUTOMATION_ACTIONS,
  AUTOMATION_ACTION_LABELS,
  AUTOMATION_TRIGGERS,
  AUTOMATION_TRIGGER_LABELS,
  TASK_TYPES,
  TASK_TYPE_LABELS,
  type AutomationTrigger,
} from "@/lib/domain";

type Template = { id: string; name: string; channel: "whatsapp" | "email"; approved: boolean };
type Member = { userId: string; name: string };

export type RuleInitial = {
  name: string;
  description: string;
  trigger: AutomationTrigger;
  conditions: Condition[];
  actions: AutomationAction[];
  delayMinutes: number;
  delayBusinessDays: number;
  respectBusinessHours: boolean;
  enabled: boolean;
  dryRun: boolean;
  maxAttempts: number;
};

const LIST_OPS = ["in", "not_in"];
const NO_VALUE_OPS = ["is_empty", "is_not_empty", "is_true", "is_false"];

function defaultAction(type: AutomationAction["type"], templates: Template[]): AutomationAction {
  switch (type) {
    case "create_task":
      return { type, title: "Follow up with {{contact_name}}", taskType: "follow_up", dueInHours: 0 };
    case "assign_lead":
      return { type, strategy: "round_robin" };
    case "notify_staff":
      return { type, title: "Update on {{contact_name}}" };
    case "queue_email":
      return { type, templateId: templates.find((t) => t.channel === "email")?.id ?? "", requireApproval: true };
    case "queue_whatsapp_template":
      return { type, templateId: templates.find((t) => t.channel === "whatsapp")?.id ?? "", requireApproval: true };
    case "create_ai_reply_draft":
      return { type, purpose: "follow_up", channel: "auto" };
    case "add_tag":
      return { type, tag: "" };
    case "record_activity":
      return { type, summary: "" };
    case "update_field":
      return { type, field: "next_action", value: "" };
  }
}

export function RuleEditor({ ruleId, initial, templates, members }: { ruleId?: string; initial: RuleInitial; templates: Template[]; members: Member[] }) {
  const [rule, setRule] = useState(initial);
  const [conditions, setConditions] = useState<(Condition & { key: number })[]>(initial.conditions.map((c, i) => ({ ...c, key: i })));
  const [actions, setActions] = useState<(AutomationAction & { key: number })[]>(initial.actions.map((a, i) => ({ ...a, key: i })));
  const counter = useRef(1000);
  const key = () => counter.current++;
  const payload = useMemo(
    () => ({
      ...rule,
      conditions: conditions.map(({ key: _k, ...c }) => c),
      actions: actions.map(({ key: _k, ...a }) => a),
    }),
    [rule, conditions, actions],
  );
  const updateAction = (k: number, patch: Partial<AutomationAction>) => setActions((all) => all.map((a) => (a.key === k ? ({ ...a, ...patch } as typeof a) : a)));

  return (
    <ActionForm action={saveRuleAction} className="space-y-6">
      {ruleId && <input type="hidden" name="ruleId" value={ruleId} />}
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Rule name" htmlFor="r-name" name="name">
          <Input id="r-name" value={rule.name} onChange={(e) => setRule({ ...rule, name: e.target.value })} />
        </Field>
        <Field label="When this happens" htmlFor="r-trigger">
          <Select id="r-trigger" value={rule.trigger} onChange={(e) => setRule({ ...rule, trigger: e.target.value as AutomationTrigger })}>
            {AUTOMATION_TRIGGERS.map((t) => (
              <option key={t} value={t}>
                {AUTOMATION_TRIGGER_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Description" htmlFor="r-desc">
        <Textarea id="r-desc" rows={2} value={rule.description} onChange={(e) => setRule({ ...rule, description: e.target.value })} />
      </Field>

      <section className="rounded-xl border border-line p-4">
        <h3 className="text-sm font-semibold">Wait before running</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <Field label="Business days" htmlFor="r-bdays">
            <Input id="r-bdays" type="number" min={0} max={30} value={rule.delayBusinessDays} onChange={(e) => setRule({ ...rule, delayBusinessDays: Number(e.target.value) })} />
          </Field>
          <Field label="Plus minutes" htmlFor="r-mins">
            <Input id="r-mins" type="number" min={0} value={rule.delayMinutes} onChange={(e) => setRule({ ...rule, delayMinutes: Number(e.target.value) })} />
          </Field>
          <div className="pt-7">
            <Checkbox label="Only run during business hours" checked={rule.respectBusinessHours} onChange={(e) => setRule({ ...rule, respectBusinessHours: e.target.checked })} />
          </div>
        </div>
        <p className="mt-2 text-xs text-muted">Conditions are checked again at run time, so a delayed step is skipped if the lead has moved on.</p>
      </section>

      <section className="rounded-xl border border-line p-4">
        <h3 className="text-sm font-semibold">Only if (all must match)</h3>
        <div className="mt-3 space-y-2">
          {conditions.map((c, idx) => (
            <div key={c.key} className="grid gap-2 sm:grid-cols-[1fr_1fr_2fr_auto]">
              <Select aria-label={`Condition ${idx + 1} field`} value={c.field} onChange={(e) => setConditions((all) => all.map((x) => (x.key === c.key ? { ...x, field: e.target.value as Condition["field"] } : x)))}>
                {CONDITION_FIELDS.map((f) => (
                  <option key={f} value={f}>
                    {f.replace(/_/g, " ")}
                  </option>
                ))}
              </Select>
              <Select aria-label={`Condition ${idx + 1} operator`} value={c.op} onChange={(e) => setConditions((all) => all.map((x) => (x.key === c.key ? { ...x, op: e.target.value as Condition["op"] } : x)))}>
                {CONDITION_OPS.map((o) => (
                  <option key={o} value={o}>
                    {o.replace(/_/g, " ")}
                  </option>
                ))}
              </Select>
              {NO_VALUE_OPS.includes(c.op) ? (
                <span />
              ) : (
                <Input
                  aria-label={`Condition ${idx + 1} value`}
                  placeholder={LIST_OPS.includes(c.op) ? "comma separated, e.g. new_enquiry, contacted" : "value"}
                  value={Array.isArray(c.value) ? c.value.join(", ") : (c.value ?? "").toString()}
                  onChange={(e) =>
                    setConditions((all) =>
                      all.map((x) =>
                        x.key === c.key
                          ? { ...x, value: LIST_OPS.includes(c.op) ? e.target.value.split(",").map((s) => s.trim()).filter(Boolean) : ["gte", "lte"].includes(c.op) ? Number(e.target.value) : e.target.value }
                          : x,
                      ),
                    )
                  }
                />
              )}
              <button type="button" className="rounded p-2 text-muted hover:text-danger" aria-label={`Remove condition ${idx + 1}`} onClick={() => setConditions((all) => all.filter((x) => x.key !== c.key))}>
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setConditions((all) => [...all, { key: key(), field: "status", op: "in", value: ["new_enquiry"] }])}>
            <Plus size={14} /> Add condition
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-line p-4">
        <h3 className="text-sm font-semibold">Then do this</h3>
        <p className="mt-1 text-xs text-muted">Placeholders: {"{{contact_name}} {{partner_name}} {{event_type}} {{event_date}} {{city}} {{reference}} {{studio_name}}"}</p>
        <div className="mt-3 space-y-3">
          {actions.map((a, idx) => (
            <div key={a.key} className="space-y-2 rounded-lg border border-line bg-sand/30 p-3">
              <div className="flex items-center gap-2">
                <Select aria-label={`Action ${idx + 1} type`} value={a.type} onChange={(e) => setActions((all) => all.map((x) => (x.key === a.key ? { ...defaultAction(e.target.value as AutomationAction["type"], templates), key: a.key } : x)))}>
                  {AUTOMATION_ACTIONS.map((t) => (
                    <option key={t} value={t}>
                      {AUTOMATION_ACTION_LABELS[t]}
                    </option>
                  ))}
                </Select>
                <button type="button" className="rounded p-2 text-muted hover:text-danger" aria-label={`Remove action ${idx + 1}`} onClick={() => setActions((all) => all.filter((x) => x.key !== a.key))}>
                  <Trash2 size={15} />
                </button>
              </div>
              {a.type === "create_task" && (
                <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr]">
                  <Input aria-label="Task title" value={a.title} onChange={(e) => updateAction(a.key, { title: e.target.value })} />
                  <Select aria-label="Task type" value={a.taskType} onChange={(e) => updateAction(a.key, { taskType: e.target.value as "follow_up" })}>
                    {TASK_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {TASK_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </Select>
                  <Input aria-label="Due in hours" type="number" min={0} value={a.dueInHours} onChange={(e) => updateAction(a.key, { dueInHours: Number(e.target.value) })} />
                </div>
              )}
              {a.type === "notify_staff" && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input aria-label="Notification title" value={a.title} onChange={(e) => updateAction(a.key, { title: e.target.value })} />
                  <Input aria-label="Notification body" placeholder="Details (optional)" value={a.body ?? ""} onChange={(e) => updateAction(a.key, { body: e.target.value })} />
                </div>
              )}
              {a.type === "assign_lead" && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Select aria-label="Assignment strategy" value={a.strategy} onChange={(e) => updateAction(a.key, { strategy: e.target.value as "round_robin" })}>
                    <option value="round_robin">Team member with the fewest open leads</option>
                    <option value="specific">A specific team member</option>
                  </Select>
                  {a.strategy === "specific" && (
                    <Select aria-label="Team member" value={a.userId ?? ""} onChange={(e) => updateAction(a.key, { userId: e.target.value })}>
                      <option value="">Choose…</option>
                      {members.map((m) => (
                        <option key={m.userId} value={m.userId}>
                          {m.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </div>
              )}
              {(a.type === "queue_email" || a.type === "queue_whatsapp_template") && (
                <div className="space-y-2">
                  <Select aria-label="Template" value={a.templateId} onChange={(e) => updateAction(a.key, { templateId: e.target.value })}>
                    <option value="">Choose a template…</option>
                    {templates
                      .filter((t) => t.channel === (a.type === "queue_email" ? "email" : "whatsapp"))
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                          {t.approved ? " (approved)" : ""}
                        </option>
                      ))}
                  </Select>
                  <Checkbox
                    label="Require staff approval for each message (recommended). Sending without approval is only allowed for templates marked approved."
                    checked={a.requireApproval}
                    onChange={(e) => updateAction(a.key, { requireApproval: e.target.checked })}
                  />
                </div>
              )}
              {a.type === "create_ai_reply_draft" && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Select aria-label="Draft purpose" value={a.purpose} onChange={(e) => updateAction(a.key, { purpose: e.target.value as "follow_up" })}>
                    <option value="acknowledgement">Acknowledgement</option>
                    <option value="follow_up">Follow-up</option>
                  </Select>
                  <Select aria-label="Draft channel" value={a.channel} onChange={(e) => updateAction(a.key, { channel: e.target.value as "auto" })}>
                    <option value="auto">Client&apos;s preferred channel</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="email">Email</option>
                  </Select>
                  <p className="text-xs text-muted sm:col-span-2">Drafts always wait for approval. If AI is unavailable, your matching template is used instead.</p>
                </div>
              )}
              {a.type === "add_tag" && <Input aria-label="Tag" value={a.tag} onChange={(e) => updateAction(a.key, { tag: e.target.value })} />}
              {a.type === "record_activity" && <Input aria-label="Activity text" value={a.summary} onChange={(e) => updateAction(a.key, { summary: e.target.value })} />}
              {a.type === "update_field" && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Select aria-label="Field" value={a.field} onChange={(e) => updateAction(a.key, { field: e.target.value as "priority" })}>
                    <option value="next_action">Next action</option>
                    <option value="priority">Priority (low / medium / high)</option>
                  </Select>
                  <Input aria-label="New value" value={a.value} onChange={(e) => updateAction(a.key, { value: e.target.value })} />
                </div>
              )}
            </div>
          ))}
          <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setActions((all) => [...all, { ...defaultAction("create_task", templates), key: key() }])}>
            <Plus size={14} /> Add action
          </button>
        </div>
      </section>

      <div className="flex flex-wrap gap-6">
        <Checkbox label="Enabled" checked={rule.enabled} onChange={(e) => setRule({ ...rule, enabled: e.target.checked })} />
        <Checkbox label="Dry run (record what would happen without doing it)" checked={rule.dryRun} onChange={(e) => setRule({ ...rule, dryRun: e.target.checked })} />
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          Retries
          <Input type="number" min={1} max={10} value={rule.maxAttempts} onChange={(e) => setRule({ ...rule, maxAttempts: Number(e.target.value) })} className="w-20" aria-label="Maximum attempts" />
        </label>
      </div>
      <SubmitButton variant="gold" pendingText="Saving…">
        {ruleId ? "Save rule" : "Create rule"}
      </SubmitButton>
    </ActionForm>
  );
}
