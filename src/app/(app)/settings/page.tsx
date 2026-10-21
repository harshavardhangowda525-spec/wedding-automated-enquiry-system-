import Link from "next/link";
import { updateProfileAction } from "@/app/actions/settings";
import { ActionForm, SubmitButton } from "@/components/client/forms";
import { Alert, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { roleAtLeast } from "@/lib/domain";
import { requireStudio } from "@/server/auth/context";

export const metadata = { title: "Studio profile" };

const TIMEZONES = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Colombo", "Asia/Kathmandu", "Europe/London", "America/New_York", "America/Los_Angeles", "Australia/Sydney"];

export default async function ProfileSettings({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const { welcome } = await searchParams;
  const { studio, role } = await requireStudio();
  const canEdit = roleAtLeast(role, "admin");
  return (
    <div className="space-y-6">
      {welcome && (
        <Alert tone="success" title="Your studio is ready">
          Next: add your prices in <Link className="underline" href="/settings/services">Services &amp; prices</Link>, review your <Link className="underline" href="/settings/enquiry-form">enquiry form</Link>, then share your link from the dashboard.
        </Alert>
      )}
      <Card className="max-w-3xl p-6">
        <ActionForm action={updateProfileAction} className="space-y-4">
          <fieldset disabled={!canEdit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Studio name" htmlFor="name">
                <Input id="name" name="name" defaultValue={studio.name} />
              </Field>
              <Field label="Business type" htmlFor="businessType">
                <Select id="businessType" name="businessType" defaultValue={studio.businessType}>
                  <option value="photo_video">Photography &amp; cinematography</option>
                  <option value="photography">Photography</option>
                  <option value="cinematography">Cinematography</option>
                </Select>
              </Field>
              <Field label="Email" htmlFor="email">
                <Input id="email" name="email" type="email" defaultValue={studio.email ?? ""} />
              </Field>
              <Field label="Phone" htmlFor="phone">
                <Input id="phone" name="phone" defaultValue={studio.phone ?? ""} />
              </Field>
              <Field label="City" htmlFor="city">
                <Input id="city" name="city" defaultValue={studio.city ?? ""} />
              </Field>
              <Field label="Website" htmlFor="website">
                <Input id="website" name="website" defaultValue={studio.website ?? ""} placeholder="https://" />
              </Field>
              <Field label="Logo URL" htmlFor="logoUrl" hint="An https:// link to your logo (PNG or SVG).">
                <Input id="logoUrl" name="logoUrl" defaultValue={studio.logoUrl ?? ""} />
              </Field>
              <Field label="Brand colour" htmlFor="brandColor">
                <div className="flex gap-2">
                  <span className="h-10 w-12 shrink-0 rounded border border-line-strong" style={{ background: studio.brandColor }} aria-hidden />
                  <Input id="brandColor" name="brandColor" defaultValue={studio.brandColor} pattern="#[0-9a-fA-F]{6}" />
                </div>
              </Field>
              <Field label="Currency" htmlFor="currency">
                <Select id="currency" name="currency" defaultValue={studio.currency}>
                  {["INR", "USD", "AED", "GBP", "EUR", "SGD", "AUD"].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Time zone" htmlFor="timezone">
                <Select id="timezone" name="timezone" defaultValue={studio.timezone}>
                  {[...new Set([studio.timezone, ...TIMEZONES])].map((tz) => (
                    <option key={tz}>{tz}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Welcome message on your enquiry form" htmlFor="welcomeMessage">
              <Textarea id="welcomeMessage" name="welcomeMessage" rows={3} defaultValue={studio.welcomeMessage ?? ""} />
            </Field>
            <Field label="Privacy notice" htmlFor="privacyNotice" hint="Shown under your enquiry form.">
              <Textarea id="privacyNotice" name="privacyNotice" rows={4} defaultValue={studio.privacyNotice ?? ""} />
            </Field>
            {canEdit ? <SubmitButton>Save profile</SubmitButton> : <p className="text-sm text-muted">Only owners and admins can change studio settings.</p>}
          </fieldset>
        </ActionForm>
      </Card>
    </div>
  );
}
