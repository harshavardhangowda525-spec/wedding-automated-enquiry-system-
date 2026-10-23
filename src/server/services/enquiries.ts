import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { EVENT_TYPES, PREFERRED_CHANNELS } from "@/lib/domain";
import { normalizePhone } from "@/lib/phone";
import { parseStudioSettings } from "@/lib/studio-settings";
import { withStudio } from "@/server/db/client";
import { consents, leads, services } from "@/server/db/schema";
import { env } from "@/server/env";
import { emitEvent } from "@/server/jobs/queue";
import { hashIp } from "@/server/lib/crypto";
import { RateLimitError } from "@/server/lib/errors";
import { queueAutoAcknowledgement } from "@/server/messaging/service";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { recordActivity } from "./activity";
import { generateReference } from "./leads";
import { getPublicStudioBySlug } from "./studios";

const MIN_FILL_MS = 3_000;
const MAX_FORM_AGE_MS = 24 * 60 * 60 * 1000;
const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Signed, time-stamped form token: blocks naive bots that post without loading the form. */
export function issueFormToken(studioId: string, now = Date.now()): string {
  const payload = `${studioId}.${now}`;
  const sig = createHmac("sha256", env().APP_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyFormToken(token: string, studioId: string, now = Date.now()): "ok" | "invalid" | "too_fast" | "expired" {
  const parts = token.split(".");
  if (parts.length !== 3) return "invalid";
  const [sid, ts, sig] = parts;
  if (sid !== studioId) return "invalid";
  const expected = createHmac("sha256", env().APP_SECRET).update(`${sid}.${ts}`).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return "invalid";
  const age = now - Number(ts);
  if (!Number.isFinite(age) || age < 0) return "invalid";
  if (age < MIN_FILL_MS) return "too_fast";
  if (age > MAX_FORM_AGE_MS) return "expired";
  return "ok";
}

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const enquirySchema = z.object({
  contactName: z.string().trim().min(2, "Please enter your name").max(120),
  partnerName: text(120),
  countryCode: z.string().trim().min(1).max(5).default("+91"),
  phone: z.string().trim().min(5, "Please enter your phone number").max(30),
  email: z
    .string()
    .trim()
    .email("Please enter a valid email")
    .max(200)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  eventType: z.enum(EVENT_TYPES, { message: "Please choose an event type" }),
  dateKnown: z.enum(["yes", "no"]).default("yes"),
  eventDate: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), "Please choose a valid date"),
  additionalDates: z
    .array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), label: text(60) }))
    .max(6)
    .default([]),
  city: z.string().trim().min(2, "Please enter the city or venue").max(120),
  venue: text(200),
  serviceIds: z.array(z.string().uuid()).min(1, "Please choose at least one service").max(20),
  photographyPreferences: text(500),
  cinematographyPreferences: text(500),
  budgetRange: text(80),
  message: text(4000),
  preferredChannel: z.enum(PREFERRED_CHANNELS).default("any"),
  consent: z.literal(true, { message: "Please agree to be contacted about your enquiry" }),
  // Anti-spam
  website: z.string().max(0, "Spam detected").optional().default(""), // honeypot – must stay empty
  formToken: z.string().min(10),
});
export type EnquiryInput = z.input<typeof enquirySchema>;

export type EnquiryResult =
  | { ok: true; reference: string; studioName: string; duplicate: boolean; leadId: string; autoAcknowledgement?: "queued" | "skipped" }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function submitEnquiry(
  slug: string,
  raw: unknown,
  meta: { ip?: string | null; userAgent?: string | null; now?: number; channel?: "form" | "chat" } = {},
): Promise<EnquiryResult> {
  const viaChat = meta.channel === "chat";
  const found = await getPublicStudioBySlug(slug);
  if (!found) return { ok: false, error: "This enquiry form is not available." };
  const { studio } = found;

  const parsed = enquirySchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      (fieldErrors[key] ??= []).push(issue.message);
    }
    if (fieldErrors.website) return { ok: false, error: "We could not accept this submission." };
    return { ok: false, error: "Please check the highlighted fields.", fieldErrors };
  }
  const data = parsed.data;

  const token = verifyFormToken(data.formToken, studio.id, meta.now);
  if (token === "too_fast" || token === "invalid") return { ok: false, error: "We could not accept this submission. Please reload the page and try again." };
  if (token === "expired") return { ok: false, error: "This form has expired. Please reload the page and try again." };

  const ipHash = hashIp(meta.ip) ?? "unknown";
  const allowed = await checkRateLimit(`enquiry:${studio.id}:${ipHash}`, 5, 10 * 60);
  if (!allowed) throw new RateLimitError("Too many enquiries from this connection. Please try again in a few minutes.");

  const phone = normalizePhone(data.countryCode, data.phone);
  if (!phone) return { ok: false, error: "Please check the highlighted fields.", fieldErrors: { phone: ["Please enter a valid phone number"] } };
  if (data.dateKnown === "yes" && !data.eventDate) {
    return { ok: false, error: "Please check the highlighted fields.", fieldErrors: { eventDate: ["Please choose the date, or select that it is not decided yet"] } };
  }

  const settings = parseStudioSettings(studio.settings);
  const enabled = new Set(settings.enquiryForm.enabledFields);

  return withStudio(studio.id, async (tx) => {
    const validServices = await tx
      .select({ id: services.id })
      .from(services)
      .where(and(eq(services.studioId, studio.id), eq(services.active, true)));
    const validIds = new Set(validServices.map((s) => s.id));
    const serviceIds = data.serviceIds.filter((id) => validIds.has(id));
    if (serviceIds.length === 0) {
      return { ok: false as const, error: "Please check the highlighted fields.", fieldErrors: { serviceIds: ["Please choose at least one service"] } };
    }

    const eventDate = data.dateKnown === "yes" ? (data.eventDate ?? null) : null;
    const svc = { tx, studioId: studio.id, userId: null, actorType: "client" as const };

    // Duplicate detection: same phone recently → do not create a second lead.
    const [recent] = await tx
      .select({ id: leads.id, reference: leads.reference, eventDate: leads.eventDate, createdAt: leads.createdAt })
      .from(leads)
      .where(and(eq(leads.studioId, studio.id), eq(leads.phone, phone)))
      .orderBy(desc(leads.createdAt))
      .limit(1);
    const isRecentDuplicate =
      recent && Date.now() - recent.createdAt.getTime() < DUPLICATE_WINDOW_MS && (recent.eventDate ?? null) === eventDate;
    if (isRecentDuplicate) {
      await recordActivity(svc, {
        leadId: recent.id,
        type: "duplicate_submission",
        summary: "The client submitted the enquiry form again with the same details.",
        data: { message: enabled.has("additionalRequirements") ? (data.message ?? null) : null },
      });
      return { ok: true as const, reference: recent.reference, studioName: studio.name, duplicate: true, leadId: recent.id };
    }

    const reference = await generateReference(tx, studio.id);
    const now = new Date();
    const preferences: Record<string, string> = {};
    if (enabled.has("photographyPreferences") && data.photographyPreferences) preferences.photography = data.photographyPreferences;
    if (enabled.has("cinematographyPreferences") && data.cinematographyPreferences) preferences.cinematography = data.cinematographyPreferences;

    const [lead] = await tx
      .insert(leads)
      .values({
        studioId: studio.id,
        reference,
        contactName: data.contactName,
        partnerName: enabled.has("partnerName") ? (data.partnerName ?? null) : null,
        phone,
        email: enabled.has("email") ? (data.email?.toLowerCase() ?? null) : null,
        eventType: data.eventType,
        eventDate,
        additionalDates: enabled.has("additionalDates") ? data.additionalDates.map((d) => ({ date: d.date, label: d.label })) : [],
        city: data.city,
        venue: data.venue ?? null,
        serviceIds,
        preferences,
        budgetRange: enabled.has("budgetRange") ? (data.budgetRange ?? null) : null,
        message: enabled.has("additionalRequirements") ? (data.message ?? null) : null,
        preferredChannel: enabled.has("preferredChannel") ? data.preferredChannel : "any",
        source: viaChat ? "website_chat" : "website_form",
        consentContact: true,
        consentAt: now,
        possibleDuplicateOf: recent?.id ?? null,
        isDemo: studio.isDemo,
      })
      .returning({ id: leads.id });

    await tx.insert(consents).values({
      studioId: studio.id,
      leadId: lead.id,
      kind: "contact",
      granted: true,
      text: settings.enquiryForm.consentText,
      source: viaChat ? "public_enquiry_chat" : "public_enquiry_form",
      ipHash,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
    });
    await recordActivity(svc, {
      leadId: lead.id,
      type: "lead_created",
      summary: `Enquiry received via ${viaChat ? "website chat" : "website form"} (${reference})`,
      data: { reference, possibleDuplicateOf: recent?.id ?? null },
    });
    // Chat enquiries get an immediate WhatsApp confirmation (approved template only).
    const autoAcknowledgement = viaChat
      ? await queueAutoAcknowledgement({ tx, studioId: studio.id, userId: null, role: "system", actorType: "system" }, lead.id)
      : undefined;
    await emitEvent(tx, studio.id, { trigger: "lead_created", leadId: lead.id, key: `lead_created:${lead.id}` });
    return { ok: true as const, reference, studioName: studio.name, duplicate: false, leadId: lead.id, autoAcknowledgement };
  });
}
