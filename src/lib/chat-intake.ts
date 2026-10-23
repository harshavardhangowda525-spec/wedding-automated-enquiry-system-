// Client-safe definitions for the enquiry chatbot: what it collects, in which order, and how it asks.
import type { FormFieldKey } from "./studio-settings";

export type ChatFields = {
  contactName?: string;
  countryCode: string;
  phone?: string;
  eventType?: string;
  dateKnown?: "yes" | "no";
  eventDate?: string;
  city?: string;
  venue?: string;
  serviceIds: string[];
  partnerName?: string;
  email?: string;
  budgetRange?: string;
  message?: string;
  consent?: boolean;
  /** Optional questions the client chose to skip. */
  skipped: string[];
};

export const EMPTY_CHAT_FIELDS: ChatFields = { countryCode: "+91", serviceIds: [], skipped: [] };

export type ChatStep =
  | "contactName"
  | "phone"
  | "eventType"
  | "eventDate"
  | "city"
  | "services"
  | "partnerName"
  | "email"
  | "budgetRange"
  | "message"
  | "consent"
  | "confirm";

export type ChatMessage = { role: "bot" | "client"; text: string };

const OPTIONAL_STEPS: { step: ChatStep; field: FormFieldKey }[] = [
  { step: "partnerName", field: "partnerName" },
  { step: "email", field: "email" },
  { step: "budgetRange", field: "budgetRange" },
  { step: "message", field: "additionalRequirements" },
];

export const OPTIONAL_CHAT_STEPS = OPTIONAL_STEPS.map((s) => s.step);

/** The next thing the bot needs. Required details first, then enabled optional ones, then consent. */
export function nextChatStep(f: ChatFields, enabledFields: FormFieldKey[]): ChatStep {
  if (!f.contactName) return "contactName";
  if (!f.phone) return "phone";
  if (!f.eventType) return "eventType";
  if (!f.dateKnown || (f.dateKnown === "yes" && !f.eventDate)) return "eventDate";
  if (!f.city) return "city";
  if (f.serviceIds.length === 0) return "services";
  for (const { step, field } of OPTIONAL_STEPS) {
    const key = step as keyof ChatFields;
    if (enabledFields.includes(field) && !f[key] && !f.skipped.includes(step)) return step;
  }
  if (f.consent !== true) return "consent";
  return "confirm";
}

export function chatQuestion(step: ChatStep, f: ChatFields, studioName: string, consentText: string): string {
  const first = f.contactName?.split(" ")[0];
  switch (step) {
    case "contactName":
      return `Hi! I'm the enquiry assistant for ${studioName}. I'll take a few details so the team can get back to you personally. What's your name?`;
    case "phone":
      return `Lovely to meet you${first ? `, ${first}` : ""}! What's the best phone / WhatsApp number to reach you on?`;
    case "eventType":
      return "What are you celebrating?";
    case "eventDate":
      return "When is the main event? Pick the date, or tell me if it isn't decided yet.";
    case "city":
      return "Which city or venue will it be in?";
    case "services":
      return "Which services are you interested in? Choose as many as you like.";
    case "partnerName":
      return "What's your partner's name? (You can skip this.)";
    case "email":
      return "Would you like to share an email address too? (Optional.)";
    case "budgetRange":
      return "Do you have a budget range in mind? (Optional.)";
    case "message":
      return "Anything else the team should know – number of events, guests, must-have moments? (Optional.)";
    case "consent":
      return `One last thing: ${consentText} Do you agree?`;
    case "confirm":
      return "Here's what I have. Shall I send this to the team?";
  }
}
