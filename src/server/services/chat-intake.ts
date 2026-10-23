import "server-only";
import { z } from "zod";
import { chatQuestion, nextChatStep, OPTIONAL_CHAT_STEPS, type ChatFields, type ChatStep } from "@/lib/chat-intake";
import { EVENT_TYPES } from "@/lib/domain";
import { normalizePhone } from "@/lib/phone";
import { parseStudioSettings } from "@/lib/studio-settings";
import { dateInTz } from "@/lib/time";
import { AiInvalidOutputError, AiUnavailableError } from "@/server/ai/provider";
import { extractEnquiryDetails, findUnsupportedAmounts, type ChatExtraction } from "@/server/ai/service";
import { withStudio } from "@/server/db/client";
import { hashIp } from "@/server/lib/crypto";
import { RateLimitError } from "@/server/lib/errors";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { submitEnquiry, type EnquiryResult } from "./enquiries";
import { getPublicStudioBySlug } from "./studios";

const str = (max: number) => z.string().trim().max(max).optional();

/** The browser sends its copy of the fields each turn; never trust it beyond this shape. */
const chatFieldsSchema = z.object({
  contactName: str(120),
  countryCode: z.string().trim().max(5).default("+91"),
  phone: str(20),
  eventType: z.enum(EVENT_TYPES).optional(),
  dateKnown: z.enum(["yes", "no"]).optional(),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  city: str(120),
  venue: str(200),
  serviceIds: z.array(z.string().uuid()).max(20).default([]),
  partnerName: str(120),
  email: str(200),
  budgetRange: str(80),
  message: str(4000),
  consent: z.boolean().optional(),
  skipped: z.array(z.string().max(30)).max(10).default([]),
});

const turnSchema = z.object({
  fields: chatFieldsSchema,
  input: z.object({
    text: z.string().max(2000).optional(),
    choice: z.string().max(200).optional(),
    choices: z.array(z.string().max(100)).max(20).optional(),
    date: z.string().max(20).optional(),
    countryCode: z.string().max(5).optional(),
    skip: z.boolean().optional(),
  }),
});

export type ChatTurnResult =
  | { ok: true; fields: ChatFields; step: ChatStep; bot: string[]; aiUsed: boolean }
  | { ok: false; error: string };

type Studio = NonNullable<Awaited<ReturnType<typeof getPublicStudioBySlug>>>;

const EVENT_KEYWORDS: [RegExp, (typeof EVENT_TYPES)[number]][] = [
  [/pre[\s-]?wed/i, "Pre-wedding shoot"],
  [/destination/i, "Destination wedding"],
  [/haldi|mehe?n?di|sangeet/i, "Haldi / Mehendi / Sangeet"],
  [/engage|ring ceremony|roka/i, "Engagement"],
  [/reception/i, "Reception"],
  [/wedding|marriage|shaadi|vivah/i, "Wedding"],
];

const NOT_DECIDED = /not (yet )?(decided|sure|fixed|finali[sz]ed)|don'?t know|no date|tbd|undecided|later/i;

function parseDate(text: string): string | null {
  const t = text.trim();
  let m = t.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = t.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/); // Indian order: dd/mm/yyyy
  if (m) return iso(+m[3], +m[2], +m[1]);
  return null;
}

function iso(y: number, mo: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

function cleanName(text: string): string {
  return text
    .replace(/^(hi|hello|hey)[,!.\s]+/i, "")
    .replace(/^(my name is|this is|i am|i'm|im|it's|its)\s+/i, "")
    .replace(/[.!]+$/, "")
    .trim();
}

function matchServices(text: string, catalogue: Studio["services"]): string[] {
  const lower = text.toLowerCase();
  return catalogue.filter((s) => lower.includes(s.name.toLowerCase()) || s.name.toLowerCase().split(" ").some((w) => w.length > 4 && lower.includes(w))).map((s) => s.id);
}

/**
 * Applies a value for `field` if it is valid. Returns an error message for the field the bot
 * just asked about; values for other fields (from AI extraction) are applied only when valid.
 */
function applyValue(f: ChatFields, field: ChatStep, value: string, ctx: { today: string; studio: Studio }): string | null {
  const v = value.trim();
  switch (field) {
    case "contactName":
    case "partnerName": {
      const name = cleanName(v);
      if (name.length < 2 || name.length > 120 || /\d{4,}/.test(name)) return "Sorry, I didn't catch the name. What should I call you?";
      f[field] = name;
      return null;
    }
    case "phone": {
      const phone = normalizePhone(f.countryCode, v);
      if (!phone) return "That doesn't look like a valid phone number. Please type the number with the country code if you're outside India, e.g. 98765 43210 or +971 50 123 4567.";
      f.phone = phone;
      return null;
    }
    case "eventType": {
      const exact = EVENT_TYPES.find((t) => t.toLowerCase() === v.toLowerCase());
      const match = exact ?? EVENT_KEYWORDS.find(([re]) => re.test(v))?.[1];
      if (!match) return "Could you pick one of the options below?";
      f.eventType = match;
      return null;
    }
    case "eventDate": {
      if (NOT_DECIDED.test(v)) {
        f.dateKnown = "no";
        f.eventDate = undefined;
        return null;
      }
      const date = parseDate(v);
      if (!date) return "Please pick the date from the calendar, or tap “Not decided yet”.";
      if (date < ctx.today) return "That date has already passed. Could you check it?";
      f.dateKnown = "yes";
      f.eventDate = date;
      return null;
    }
    case "city": {
      if (v.length < 2 || v.length > 120) return "Which city or venue will it be in?";
      f.city = v;
      return null;
    }
    case "services": {
      const ids = matchServices(v, ctx.studio.services);
      if (ids.length === 0) return "Please choose at least one of the services below.";
      f.serviceIds = [...new Set([...f.serviceIds, ...ids])];
      return null;
    }
    case "email": {
      const ok = z.string().email().max(200).safeParse(v);
      if (!ok.success) return "That email address doesn't look right. Please check it, or tap Skip.";
      f.email = ok.data.toLowerCase();
      return null;
    }
    case "budgetRange": {
      const options = parseStudioSettings(ctx.studio.studio.settings).enquiryForm.budgetRanges;
      f.budgetRange = (options.find((o) => o.toLowerCase() === v.toLowerCase()) ?? v).slice(0, 80);
      return null;
    }
    case "message": {
      f.message = v.slice(0, 4000);
      return null;
    }
    case "consent": {
      if (/^(y|yes|yeah|yep|ok|okay|sure|agree|i agree|haan|ha)\b/i.test(v)) {
        f.consent = true;
        return null;
      }
      return "No problem. We can only send your enquiry once you agree to be contacted about it. Tap “I agree” whenever you're ready.";
    }
    case "confirm":
      return null;
  }
}

/** Applies AI-extracted values; only fills fields that are still empty (or the one just asked about). */
function applyExtraction(f: ChatFields, x: ChatExtraction, asked: ChatStep, ctx: { today: string; studio: Studio }) {
  const settings = parseStudioSettings(ctx.studio.studio.settings);
  const fill = (field: ChatStep, value: string | null | undefined, present: boolean) => {
    if (value && (!present || field === asked)) applyValue(f, field, value, ctx);
  };
  fill("contactName", x.contactName, !!f.contactName);
  fill("phone", x.phone, !!f.phone);
  fill("eventType", x.eventType, !!f.eventType);
  if (x.dateNotDecided && !f.dateKnown) applyValue(f, "eventDate", "not decided", ctx);
  else fill("eventDate", x.eventDate, !!f.dateKnown);
  fill("city", x.city, !!f.city);
  if (x.venue && !f.venue) f.venue = x.venue.slice(0, 200);
  if (x.services.length) {
    const byName = new Map(ctx.studio.services.map((s) => [s.name.toLowerCase(), s.id]));
    const ids = x.services.map((n) => byName.get(n.toLowerCase())).filter((id): id is string => !!id);
    if (ids.length) f.serviceIds = [...new Set([...f.serviceIds, ...ids])];
  }
  if (settings.enquiryForm.enabledFields.includes("partnerName")) fill("partnerName", x.partnerName, !!f.partnerName);
  if (settings.enquiryForm.enabledFields.includes("email")) fill("email", x.email, !!f.email);
  if (settings.enquiryForm.enabledFields.includes("budgetRange") && x.budgetRange && settings.enquiryForm.budgetRanges.includes(x.budgetRange)) fill("budgetRange", x.budgetRange, !!f.budgetRange);
  if (settings.enquiryForm.enabledFields.includes("additionalRequirements")) fill("message", x.additionalRequirements, !!f.message);
}

function safeAcknowledgement(text: string): string | null {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t || t.length > 220 || t.includes("?") || findUnsupportedAmounts(t, []).length || /\b(book(ed|ing)?|confirm|available|availability|guarantee|discount|price)/i.test(t)) return null;
  return t;
}

export async function processChatTurn(slug: string, raw: unknown, meta: { ip?: string | null }): Promise<ChatTurnResult> {
  const studio = await getPublicStudioBySlug(slug);
  if (!studio) return { ok: false, error: "This enquiry chat is not available." };
  const parsed = turnSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Something went wrong. Please refresh the page and try again." };
  const ipHash = hashIp(meta.ip) ?? "unknown";
  if (!(await checkRateLimit(`chat:${studio.studio.id}:${ipHash}`, 80, 10 * 60))) {
    throw new RateLimitError("You're sending messages very quickly. Please wait a few minutes and try again.");
  }

  const settings = parseStudioSettings(studio.studio.settings);
  const enabled = settings.enquiryForm.enabledFields;
  const f: ChatFields = { ...parsed.data.fields };
  const validIds = new Set(studio.services.map((s) => s.id));
  f.serviceIds = f.serviceIds.filter((id) => validIds.has(id));
  const asked = nextChatStep(f, enabled);
  const { text, choice, choices, date, countryCode, skip } = parsed.data.input;
  const ctx = { today: dateInTz(new Date(), studio.studio.timezone), studio };
  const bot: string[] = [];
  let problem: string | null = null;
  let aiUsed = false;

  if (countryCode && /^\+\d{1,4}$/.test(countryCode)) f.countryCode = countryCode;

  if (skip && OPTIONAL_CHAT_STEPS.includes(asked)) {
    f.skipped = [...new Set([...f.skipped, asked])];
  } else if (asked === "services" && choices) {
    const ids = choices.filter((id) => validIds.has(id));
    if (ids.length === 0) problem = "Please choose at least one service.";
    else f.serviceIds = ids;
  } else if (asked === "eventDate" && date) {
    problem = applyValue(f, "eventDate", date === "not_decided" ? "not decided" : date, ctx);
  } else if (asked === "consent" && choice) {
    problem = applyValue(f, "consent", choice === "agree" ? "yes" : "no", ctx);
  } else if (choice) {
    problem = applyValue(f, asked, choice, ctx);
  } else if (text && text.trim()) {
    // Free text: let Grok pick out every detail it contains; fall back to simple parsing.
    let extracted: ChatExtraction | null = null;
    if (studio.studio.aiEnabled && asked !== "consent") {
      try {
        extracted = await withStudio(studio.studio.id, (tx) =>
          extractEnquiryDetails(
            { tx, studioId: studio.studio.id, userId: null, role: "system", actorType: "client" },
            {
              studioName: studio.studio.name,
              today: ctx.today,
              askedAbout: asked,
              message: text,
              services: studio.services.map((s) => s.name),
              eventTypes: EVENT_TYPES,
              budgetRanges: settings.enquiryForm.budgetRanges,
            },
          ),
        );
      } catch (err) {
        if (!(err instanceof AiUnavailableError || err instanceof AiInvalidOutputError || err instanceof RateLimitError)) throw err;
      }
    }
    if (extracted) {
      aiUsed = true;
      const before = JSON.stringify(f);
      applyExtraction(f, extracted, asked, ctx);
      // Only if the model found nothing at all, treat the text as a plain answer to the question.
      if (JSON.stringify(f) === before) problem = applyValue(f, asked, text, ctx);
      const ack = safeAcknowledgement(extracted.acknowledgement);
      if (ack && !problem) bot.push(ack);
    } else {
      problem = applyValue(f, asked, text, ctx);
    }
  }

  if (problem) {
    bot.push(problem);
    return { ok: true, fields: f, step: asked, bot, aiUsed };
  }
  const step = nextChatStep(f, enabled);
  bot.push(chatQuestion(step, f, studio.studio.name, settings.enquiryForm.consentText));
  return { ok: true, fields: f, step, bot, aiUsed };
}

export async function submitChatEnquiry(
  slug: string,
  raw: { fields: unknown; formToken: string },
  meta: { ip?: string | null; userAgent?: string | null },
): Promise<EnquiryResult> {
  const fields = chatFieldsSchema.safeParse(raw.fields);
  if (!fields.success) return { ok: false, error: "Some details are missing. Please refresh and try again." };
  const f = fields.data;
  if (f.consent !== true) return { ok: false, error: "We need your agreement to be contacted before sending the enquiry." };
  return submitEnquiry(
    slug,
    {
      contactName: f.contactName ?? "",
      partnerName: f.partnerName ?? "",
      countryCode: f.countryCode,
      phone: f.phone ?? "",
      email: f.email ?? "",
      eventType: f.eventType,
      dateKnown: f.dateKnown ?? "no",
      eventDate: f.eventDate ?? "",
      additionalDates: [],
      city: f.city ?? "",
      venue: f.venue ?? "",
      serviceIds: f.serviceIds,
      budgetRange: f.budgetRange ?? "",
      message: f.message ?? "",
      preferredChannel: "whatsapp",
      consent: true,
      website: "",
      formToken: raw.formToken,
    },
    { ...meta, channel: "chat" },
  );
}

/** First message for a new conversation. */
export function chatOpening(studioName: string, consentText: string): string {
  return chatQuestion("contactName", { countryCode: "+91", serviceIds: [], skipped: [] }, studioName, consentText);
}
