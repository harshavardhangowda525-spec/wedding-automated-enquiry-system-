import { format } from "date-fns";

export type TemplateVars = Record<string, string>;

export function templateVars(
  lead: { contactName: string; partnerName: string | null; reference: string; eventType: string; eventDate: string | null; city: string | null },
  studio: { name: string },
  extra: TemplateVars = {},
): TemplateVars {
  return {
    contact_name: lead.contactName,
    partner_name: lead.partnerName ?? "",
    studio_name: studio.name,
    reference: lead.reference,
    event_type: lead.eventType,
    event_date: lead.eventDate ? format(new Date(`${lead.eventDate}T00:00:00`), "d MMMM yyyy") : "your chosen date",
    city: lead.city ?? "",
    ...extra,
  };
}

const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** Replaces {{placeholders}}. Unknown placeholders render as empty strings. */
export function renderTemplate(body: string, vars: TemplateVars): string {
  return body.replace(PLACEHOLDER, (_, key: string) => vars[key] ?? "").replace(/[ \t]+\n/g, "\n").trim();
}

/** WhatsApp template body parameters, in the order the placeholders appear ({{1}}, {{2}}, …). */
export function whatsappTemplateParams(body: string, vars: TemplateVars): string[] {
  const params: string[] = [];
  for (const match of body.matchAll(PLACEHOLDER)) params.push(vars[match[1]] ?? "");
  return params;
}
