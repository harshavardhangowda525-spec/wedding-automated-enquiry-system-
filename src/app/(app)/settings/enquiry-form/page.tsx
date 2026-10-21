import { updateEnquiryFormAction } from "@/app/actions/settings";
import { ActionForm, SubmitButton } from "@/components/client/forms";
import { ButtonLink, Card, Checkbox, Field, Textarea } from "@/components/ui";
import { parseStudioSettings, formFieldKeys } from "@/lib/studio-settings";
import { requireStudio } from "@/server/auth/context";

export const metadata = { title: "Enquiry form" };

const LABELS: Record<(typeof formFieldKeys)[number], string> = {
  partnerName: "Partner's name",
  email: "Email address",
  additionalDates: "Multiple event dates",
  photographyPreferences: "Photography preferences",
  cinematographyPreferences: "Cinematography preferences",
  budgetRange: "Budget range",
  additionalRequirements: "Additional requirements",
  preferredChannel: "Preferred communication channel",
};

export default async function EnquiryFormSettings() {
  const { studio } = await requireStudio("admin");
  const s = parseStudioSettings(studio.settings).enquiryForm;
  return (
    <Card className="max-w-3xl p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Name, phone, event type, date, location, services and consent are always required. Choose which optional fields to show.</p>
        <ButtonLink href={`/enquire/${studio.slug}`} target="_blank" size="sm">
          Preview form
        </ButtonLink>
      </div>
      <ActionForm action={updateEnquiryFormAction} className="space-y-5">
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Optional fields</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {formFieldKeys.map((k) => (
              <Checkbox key={k} name={`field_${k}`} defaultChecked={s.enabledFields.includes(k)} label={LABELS[k]} />
            ))}
          </div>
        </fieldset>
        <Field label="Budget ranges (one per line)" htmlFor="budgetRanges">
          <Textarea id="budgetRanges" name="budgetRanges" rows={6} defaultValue={s.budgetRanges.join("\n")} />
        </Field>
        <Field label="Consent statement" htmlFor="consentText" hint="Clients must tick this to submit. The exact wording is stored with each enquiry.">
          <Textarea id="consentText" name="consentText" rows={3} defaultValue={s.consentText} />
        </Field>
        <p className="text-xs text-muted">Services shown on the form are managed in Services &amp; prices. Logo, colour, welcome message and privacy notice are in Studio profile.</p>
        <SubmitButton>Save form settings</SubmitButton>
      </ActionForm>
    </Card>
  );
}
