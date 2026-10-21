import { createLeadAction } from "@/app/actions/leads";
import { ActionForm, SubmitButton } from "@/components/client/forms";
import { Card, Checkbox, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { EVENT_TYPES, LEAD_SOURCES, LEAD_SOURCE_LABELS } from "@/lib/domain";
import { COUNTRY_CODES } from "@/lib/phone";
import { inStudio } from "@/server/auth/context";
import { listPricedServices } from "@/server/services/quotations";

export const metadata = { title: "Add lead" };

export default async function NewLeadPage() {
  const services = await inStudio("staff", (svc) => listPricedServices(svc));
  return (
    <>
      <PageHeader title="Add a lead" description="For enquiries that arrive by phone, Instagram, WhatsApp, referrals or wedding fairs. Website enquiries are added automatically." />
      <Card className="max-w-3xl p-6">
        <ActionForm action={createLeadAction} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Contact name" htmlFor="contactName" required>
              <Input id="contactName" name="contactName" required />
            </Field>
            <Field label="Partner's name" htmlFor="partnerName">
              <Input id="partnerName" name="partnerName" />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-[10rem_1fr_1fr]">
            <Field label="Country code" htmlFor="countryCode">
              <Select id="countryCode" name="countryCode" defaultValue="+91">
                {COUNTRY_CODES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Phone" htmlFor="phone" required>
              <Input id="phone" name="phone" type="tel" required />
            </Field>
            <Field label="Email" htmlFor="email">
              <Input id="email" name="email" type="email" />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Event type" htmlFor="eventType" required>
              <Select id="eventType" name="eventType" defaultValue="Wedding">
                {EVENT_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
            </Field>
            <Field label="Event date" htmlFor="eventDate" hint="Leave blank if not decided">
              <Input id="eventDate" name="eventDate" type="date" />
            </Field>
            <Field label="City" htmlFor="city">
              <Input id="city" name="city" />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Source" htmlFor="source" required>
              <Select id="source" name="source" defaultValue="phone">
                {LEAD_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {LEAD_SOURCE_LABELS[s]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Source detail" htmlFor="sourceDetail" hint="e.g. referred by Priya, @handle">
              <Input id="sourceDetail" name="sourceDetail" />
            </Field>
            <Field label="Preferred channel" htmlFor="preferredChannel">
              <Select id="preferredChannel" name="preferredChannel" defaultValue="whatsapp">
                <option value="whatsapp">WhatsApp</option>
                <option value="phone">Phone</option>
                <option value="email">Email</option>
                <option value="any">Any</option>
              </Select>
            </Field>
          </div>
          <Field label="Venue" htmlFor="venue">
            <Input id="venue" name="venue" />
          </Field>
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-ink-soft">Services requested</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {services.map((s) => (
                <Checkbox key={s.id} name="serviceIds" value={s.id} label={s.name} />
              ))}
            </div>
          </fieldset>
          <Field label="Budget range" htmlFor="budgetRange">
            <Input id="budgetRange" name="budgetRange" />
          </Field>
          <Field label="Notes from the conversation" htmlFor="message">
            <Textarea id="message" name="message" rows={4} />
          </Field>
          <Checkbox name="consentContact" label="The client agreed to be contacted about this enquiry (recorded as staff-entered consent)." />
          <p className="text-xs text-muted">Without recorded consent, WeddingFlow AI will not send automated or approved messages to this client.</p>
          <SubmitButton pendingText="Saving…">Save lead</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
