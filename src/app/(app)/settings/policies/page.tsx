import { updatePolicyAction, updateQuotationSettingsAction } from "@/app/actions/settings";
import { ActionForm, SubmitButton } from "@/components/client/forms";
import { Card, CardHeader, Checkbox, Field, Input, Textarea } from "@/components/ui";
import { parseStudioSettings } from "@/lib/studio-settings";
import { requireStudio } from "@/server/auth/context";

export const metadata = { title: "Follow-up & booking policies" };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function PolicySettings() {
  const { studio } = await requireStudio("admin");
  const s = parseStudioSettings(studio.settings);
  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Business hours & follow-up limits" description={`Times are in ${studio.timezone}.`} />
        <ActionForm action={updatePolicyAction} className="space-y-4 p-5">
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-ink-soft">Working days</legend>
            <div className="flex flex-wrap gap-3">
              {DAYS.map((d, i) => (
                <Checkbox key={d} name="days" value={String(i)} defaultChecked={s.businessHours.days.includes(i)} label={d} />
              ))}
            </div>
          </fieldset>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Opens" htmlFor="start">
              <Input id="start" name="start" type="time" defaultValue={s.businessHours.start} />
            </Field>
            <Field label="Closes" htmlFor="end">
              <Input id="end" name="end" type="time" defaultValue={s.businessHours.end} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Max automated messages per lead" htmlFor="maxAutomatedMessagesPerLead">
              <Input id="maxAutomatedMessagesPerLead" name="maxAutomatedMessagesPerLead" type="number" min={0} max={10} defaultValue={s.followUp.maxAutomatedMessagesPerLead} />
            </Field>
            <Field label="Min hours between messages" htmlFor="minHoursBetweenMessages">
              <Input id="minHoursBetweenMessages" name="minHoursBetweenMessages" type="number" min={1} defaultValue={s.followUp.minHoursBetweenMessages} />
            </Field>
            <Field label="Inactive after (days)" htmlFor="inactiveAfterDays">
              <Input id="inactiveAfterDays" name="inactiveAfterDays" type="number" min={1} defaultValue={s.followUp.inactiveAfterDays} />
            </Field>
            <Field label="Event approaching (days before)" htmlFor="eventApproachingDays">
              <Input id="eventApproachingDays" name="eventApproachingDays" type="number" min={1} defaultValue={s.followUp.eventApproachingDays} />
            </Field>
            <Field label="Consultation reminder (hours before)" htmlFor="consultationReminderHours">
              <Input id="consultationReminderHours" name="consultationReminderHours" type="number" min={1} defaultValue={s.followUp.consultationReminderHours} />
            </Field>
            <Field label="Quotation awaiting response (days)" htmlFor="quotationAwaitingDays">
              <Input id="quotationAwaitingDays" name="quotationAwaitingDays" type="number" min={1} defaultValue={s.followUp.quotationAwaitingDays} />
            </Field>
          </div>
          <fieldset className="space-y-2 border-t border-line pt-4">
            <legend className="text-sm font-semibold">Booking confirmation rules</legend>
            <Checkbox name="requireAcceptedQuotation" defaultChecked={s.booking.requireAcceptedQuotation} label="Require an accepted quotation" />
            <Checkbox name="requireDepositRecorded" defaultChecked={s.booking.requireDepositRecorded} label="Require a recorded deposit" />
            <Field label="Bookings you can take per day" htmlFor="maxBookingsPerDay">
              <Input id="maxBookingsPerDay" name="maxBookingsPerDay" type="number" min={1} max={20} defaultValue={s.booking.maxBookingsPerDay} />
            </Field>
          </fieldset>
          <SubmitButton>Save policies</SubmitButton>
        </ActionForm>
      </Card>
      <Card>
        <CardHeader title="Quotation defaults" />
        <ActionForm action={updateQuotationSettingsAction} className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Tax label" htmlFor="taxLabel">
              <Input id="taxLabel" name="taxLabel" defaultValue={s.quotation.taxLabel} />
            </Field>
            <Field label="Tax rate (%)" htmlFor="taxRate" name="taxRate">
              <Input id="taxRate" name="taxRate" inputMode="decimal" defaultValue={String(s.quotation.taxRateBps / 100)} />
            </Field>
            <Field label="Valid for (days)" htmlFor="validityDays">
              <Input id="validityDays" name="validityDays" type="number" min={1} defaultValue={s.quotation.validityDays} />
            </Field>
            <Field label="Default deposit (%)" htmlFor="defaultDepositPercent">
              <Input id="defaultDepositPercent" name="defaultDepositPercent" type="number" min={0} max={100} defaultValue={s.quotation.defaultDepositPercent} />
            </Field>
            <Field label="Number prefix" htmlFor="prefix">
              <Input id="prefix" name="prefix" defaultValue={s.quotation.prefix} />
            </Field>
          </div>
          <Field label="Default terms & conditions" htmlFor="terms">
            <Textarea id="terms" name="terms" rows={8} defaultValue={s.quotation.terms} />
          </Field>
          <SubmitButton>Save quotation defaults</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
