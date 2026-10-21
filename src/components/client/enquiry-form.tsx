"use client";

import { useState } from "react";
import { submitEnquiryAction } from "@/app/actions/enquiry";
import { ActionForm, SubmitButton } from "@/components/client/forms";
import { FieldError } from "./field-error";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import { EVENT_TYPES } from "@/lib/domain";
import { COUNTRY_CODES } from "@/lib/phone";
import type { FormFieldKey } from "@/lib/studio-settings";

type Service = { id: string; name: string; category: string; description: string | null };

export function EnquiryForm({
  slug,
  formToken,
  services,
  enabledFields,
  budgetRanges,
  consentText,
  brandColor,
}: {
  slug: string;
  formToken: string;
  services: Service[];
  enabledFields: FormFieldKey[];
  budgetRanges: string[];
  consentText: string;
  brandColor: string;
}) {
  const on = (k: FormFieldKey) => enabledFields.includes(k);
  const [dateKnown, setDateKnown] = useState(true);
  const [extraDates, setExtraDates] = useState<number[]>([]);
  const showPhoto = services.some((s) => s.category === "photography" || s.category === "pre_wedding" || s.category === "album");
  const showVideo = services.some((s) => s.category === "cinematography" || s.category === "drone");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <ActionForm action={submitEnquiryAction} className="space-y-8">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="formToken" value={formToken} />
      {/* Honeypot: hidden from people, tempting for bots. */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Website <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <fieldset className="space-y-4">
        <legend className="font-display text-xl font-semibold">About you</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Your name" htmlFor="contactName" required>
            <Input id="contactName" name="contactName" autoComplete="name" required />
          </Field>
          {on("partnerName") && (
            <Field label="Partner's name" htmlFor="partnerName">
              <Input id="partnerName" name="partnerName" />
            </Field>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <Field label="Country code" htmlFor="countryCode" required>
            <Select id="countryCode" name="countryCode" defaultValue="+91">
              {COUNTRY_CODES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Phone / WhatsApp number" htmlFor="phone" required>
            <Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="98765 43210" required />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {on("email") && (
            <Field label="Email" htmlFor="email">
              <Input id="email" name="email" type="email" autoComplete="email" />
            </Field>
          )}
          {on("preferredChannel") && (
            <Field label="Preferred way to reach you" htmlFor="preferredChannel">
              <Select id="preferredChannel" name="preferredChannel" defaultValue="whatsapp">
                <option value="whatsapp">WhatsApp</option>
                <option value="phone">Phone call</option>
                <option value="email">Email</option>
                <option value="any">Any</option>
              </Select>
            </Field>
          )}
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="font-display text-xl font-semibold">Your celebration</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Event type" htmlFor="eventType" required>
            <Select id="eventType" name="eventType" defaultValue="Wedding" required>
              {EVENT_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          </Field>
          <Field label="City or venue location" htmlFor="city" required>
            <Input id="city" name="city" placeholder="e.g. Udaipur" required />
          </Field>
        </div>
        <div className="space-y-2">
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="dateKnown" value="yes" checked={dateKnown} onChange={() => setDateKnown(true)} className="accent-[var(--color-gold)]" /> I know the date
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="dateKnown" value="no" checked={!dateKnown} onChange={() => setDateKnown(false)} className="accent-[var(--color-gold)]" /> Not decided yet
            </label>
          </div>
          {dateKnown && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Main event date" htmlFor="eventDate" required>
                <Input id="eventDate" name="eventDate" type="date" min={today} />
              </Field>
              <Field label="Venue (optional)" htmlFor="venue">
                <Input id="venue" name="venue" />
              </Field>
            </div>
          )}
          {dateKnown && on("additionalDates") && (
            <div className="space-y-2">
              {extraDates.map((key, i) => (
                <div key={key} className="flex items-end gap-2">
                  <Field label={`Additional date ${i + 1}`} htmlFor={`additionalDate-${key}`} className="flex-1">
                    <Input id={`additionalDate-${key}`} name="additionalDate" type="date" min={today} />
                  </Field>
                  <button type="button" className="mb-1 rounded px-2 py-2 text-sm text-muted hover:bg-sand" onClick={() => setExtraDates((d) => d.filter((k) => k !== key))} aria-label={`Remove additional date ${i + 1}`}>
                    Remove
                  </button>
                </div>
              ))}
              {extraDates.length < 6 && (
                <button type="button" className="text-sm font-medium" style={{ color: brandColor }} onClick={() => setExtraDates((d) => [...d, Date.now()])}>
                  + Add another date (haldi, sangeet, reception…)
                </button>
              )}
            </div>
          )}
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="font-display text-xl font-semibold">Services you&apos;re interested in</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {services.map((s) => (
            <label key={s.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-white p-3 text-sm hover:border-gold has-[:checked]:border-gold has-[:checked]:bg-gold-soft/50">
              <input type="checkbox" name="serviceIds" value={s.id} className="mt-0.5 h-4 w-4 accent-[var(--color-gold)]" />
              <span>
                <span className="font-medium text-ink">{s.name}</span>
                {s.description && <span className="mt-0.5 block text-xs text-muted">{s.description}</span>}
              </span>
            </label>
          ))}
        </div>
        <FieldError name="serviceIds" />
      </fieldset>

      {(on("photographyPreferences") || on("cinematographyPreferences") || on("budgetRange") || on("additionalRequirements")) && (
        <fieldset className="space-y-4">
          <legend className="font-display text-xl font-semibold">A little more (optional)</legend>
          {on("photographyPreferences") && showPhoto && (
            <Field label="Photography style you love" htmlFor="photographyPreferences">
              <Input id="photographyPreferences" name="photographyPreferences" placeholder="Candid, editorial, traditional…" />
            </Field>
          )}
          {on("cinematographyPreferences") && showVideo && (
            <Field label="Film style you love" htmlFor="cinematographyPreferences">
              <Input id="cinematographyPreferences" name="cinematographyPreferences" placeholder="Cinematic, documentary, teaser + full film…" />
            </Field>
          )}
          {on("budgetRange") && budgetRanges.length > 0 && (
            <Field label="Budget range" htmlFor="budgetRange">
              <Select id="budgetRange" name="budgetRange" defaultValue="">
                <option value="">Prefer not to say</option>
                {budgetRanges.map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </Select>
            </Field>
          )}
          {on("additionalRequirements") && (
            <Field label="Anything else we should know?" htmlFor="message">
              <Textarea id="message" name="message" rows={4} placeholder="Number of guests, events, must-have moments…" />
            </Field>
          )}
        </fieldset>
      )}

      <div className="space-y-4 rounded-xl border border-line bg-sand/40 p-4">
        <Checkbox name="consent" label={consentText} required />
        <FieldError name="consent" />
        <SubmitButton className="w-full sm:w-auto" variant="gold" pendingText="Sending…">
          Send enquiry
        </SubmitButton>
        <p className="text-xs text-muted">Submitting this form sends an enquiry only. It does not reserve your date or confirm a booking.</p>
      </div>
    </ActionForm>
  );
}
