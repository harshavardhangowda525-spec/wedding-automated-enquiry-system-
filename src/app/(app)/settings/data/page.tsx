import { setAiEnabledAction, setPausedAction, setRetentionAction } from "@/app/actions/settings";
import { ActionForm, SubmitButton } from "@/components/client/forms";
import { Card, CardHeader, Field, Select, buttonClass } from "@/components/ui";
import { roleAtLeast } from "@/lib/domain";
import { requireStudio } from "@/server/auth/context";

export const metadata = { title: "AI, data & privacy" };

export default async function DataSettings() {
  const { studio, role } = await requireStudio("admin");
  const isOwner = roleAtLeast(role, "owner");
  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="AI features" description="When off, no enquiry data is sent to the AI provider. Automations fall back to your templates." />
        <div className="p-5">
          <p className="text-sm">AI is currently <strong>{studio.aiEnabled ? "on" : "off"}</strong> for this studio.</p>
          <ActionForm action={setAiEnabledAction} className="mt-3">
            <input type="hidden" name="enabled" value={studio.aiEnabled ? "false" : "true"} />
            <SubmitButton variant={studio.aiEnabled ? "secondary" : "primary"}>{studio.aiEnabled ? "Turn AI off" : "Turn AI on"}</SubmitButton>
          </ActionForm>
        </div>
      </Card>
      <Card>
        <CardHeader title="Automation" description="Immediately stops all automated actions and automated sends." />
        <div className="p-5">
          <p className="text-sm">Automation is <strong>{studio.automationPaused ? "paused" : "running"}</strong>.</p>
          <ActionForm action={setPausedAction} className="mt-3">
            <input type="hidden" name="paused" value={studio.automationPaused ? "false" : "true"} />
            <SubmitButton variant={studio.automationPaused ? "gold" : "danger"}>{studio.automationPaused ? "Resume automation" : "Pause automation"}</SubmitButton>
          </ActionForm>
        </div>
      </Card>
      <Card>
        <CardHeader title="Data retention" description="Closed leads (booked, won, lost, not interested) older than this are deleted automatically, with an audit record." />
        <ActionForm action={setRetentionAction} className="space-y-3 p-5">
          <Field label="Delete closed leads after" htmlFor="days">
            <Select id="days" name="days" defaultValue={studio.dataRetentionDays ? String(studio.dataRetentionDays) : ""} disabled={!isOwner}>
              <option value="">Keep indefinitely</option>
              <option value="365">1 year</option>
              <option value="730">2 years</option>
              <option value="1095">3 years</option>
              <option value="1825">5 years</option>
            </Select>
          </Field>
          {isOwner ? <SubmitButton>Save retention</SubmitButton> : <p className="text-xs text-muted">Only owners can change retention.</p>}
        </ActionForm>
      </Card>
      <Card>
        <CardHeader title="Export your data" description="A complete JSON export of your studio's records. Leads can also be exported as CSV from the Leads page." />
        <div className="p-5">
          {isOwner ? (
            <a href="/api/settings/export" className={buttonClass("secondary")}>
              Download full export (JSON)
            </a>
          ) : (
            <p className="text-sm text-muted">Only owners can export all studio data.</p>
          )}
          <p className="mt-3 text-xs text-muted">Exports are recorded in the audit log. To delete your studio account entirely, contact Infinity Web &amp; Apps support.</p>
        </div>
      </Card>
    </div>
  );
}
