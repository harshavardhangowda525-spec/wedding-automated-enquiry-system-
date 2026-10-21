"use server";

import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { RateLimitError } from "@/server/lib/errors";
import { clientIp } from "@/server/lib/request";
import { submitEnquiry } from "@/server/services/enquiries";
import { headers } from "next/headers";
import { str } from "./_run";

export async function submitEnquiryAction(_: ActionState, form: FormData): Promise<ActionState> {
  const slug = str(form, "slug");
  const additionalDates = form
    .getAll("additionalDate")
    .map(String)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .map((date) => ({ date }));
  const payload = {
    contactName: str(form, "contactName"),
    partnerName: str(form, "partnerName"),
    countryCode: str(form, "countryCode"),
    phone: str(form, "phone"),
    email: str(form, "email"),
    eventType: str(form, "eventType"),
    dateKnown: str(form, "dateKnown") || "yes",
    eventDate: str(form, "eventDate"),
    additionalDates,
    city: str(form, "city"),
    venue: str(form, "venue"),
    serviceIds: form.getAll("serviceIds").map(String),
    photographyPreferences: str(form, "photographyPreferences"),
    cinematographyPreferences: str(form, "cinematographyPreferences"),
    budgetRange: str(form, "budgetRange"),
    message: str(form, "message"),
    preferredChannel: str(form, "preferredChannel") || "any",
    consent: form.get("consent") === "on",
    website: str(form, "website"),
    formToken: str(form, "formToken"),
  };
  let reference = "";
  try {
    const result = await submitEnquiry(slug, payload, { ip: await clientIp(), userAgent: (await headers()).get("user-agent") });
    if (!result.ok) return { ok: false, error: result.error, fieldErrors: result.fieldErrors, at: Date.now() };
    reference = result.reference;
  } catch (err) {
    if (err instanceof RateLimitError) return { ok: false, error: err.message, at: Date.now() };
    console.error("[enquiry] submission failed:", err instanceof Error ? err.message : err);
    return { ok: false, error: "We could not submit your enquiry right now. Please try again in a moment.", at: Date.now() };
  }
  redirect(`/enquire/${slug}/thanks?ref=${encodeURIComponent(reference)}`);
}
