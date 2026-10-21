import "server-only";
import { and, asc, desc, eq, inArray, like } from "drizzle-orm";
import { z } from "zod";
import { QUOTATION_TRANSITIONS, roleAtLeast, type QuotationStatus } from "@/lib/domain";
import { formatMoney } from "@/lib/money";
import { computeQuote } from "@/lib/quote-calc";
import { parseStudioSettings } from "@/lib/studio-settings";
import { addDaysToDateString, dateInTz } from "@/lib/time";
import type { ServiceContext } from "@/server/auth/context";
import { calendarEntries, leads, quotationItems, quotations, services, studios } from "@/server/db/schema";
import { emitEvent } from "@/server/jobs/queue";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/lib/errors";
import { recordActivity } from "./activity";
import { changeLeadStatus } from "./leads";

export type Quotation = typeof quotations.$inferSelect;
export type QuotationItem = typeof quotationItems.$inferSelect;

function requireWriter(svc: ServiceContext) {
  if (svc.role !== "system" && !roleAtLeast(svc.role, "staff")) throw new ForbiddenError();
}

const itemSchema = z.object({
  serviceId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  description: z.string().trim().min(1, "Describe the item").max(300),
  quantity: z.coerce.number().int().min(1).max(1000),
  unitPriceMinor: z.coerce.number().int().min(0).max(10_000_000_000),
});

export const quotationInputSchema = z.object({
  title: z.string().trim().min(2).max(200),
  clientName: z.string().trim().min(2).max(200),
  clientEmail: z.string().trim().email().max(200).optional().or(z.literal("").transform(() => undefined)),
  clientPhone: z.string().trim().max(30).optional(),
  eventSummary: z.string().trim().max(500).optional(),
  eventDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  validUntil: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  items: z.array(itemSchema).min(1, "Add at least one item").max(50),
  discountType: z.enum(["none", "percent", "fixed"]).default("none"),
  discountValue: z.coerce.number().int().min(0).default(0),
  taxRateBps: z.coerce.number().int().min(0).max(5000),
  taxLabel: z.string().trim().max(40).default("GST"),
  depositType: z.enum(["percent", "fixed"]).default("percent"),
  depositValue: z.coerce.number().int().min(0).default(0),
  milestones: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(120),
        amountMinor: z.coerce.number().int().min(0),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      }),
    )
    .max(12)
    .default([]),
  terms: z.string().max(8000).optional(),
  internalNotes: z.string().max(4000).optional(),
});
export type QuotationInput = z.input<typeof quotationInputSchema>;

async function nextNumber(svc: ServiceContext, prefix: string, year: string): Promise<string> {
  const base = `${prefix}-${year}-`;
  const existing = await svc.tx
    .select({ number: quotations.number })
    .from(quotations)
    .where(and(eq(quotations.studioId, svc.studioId), like(quotations.number, `${base}%`)));
  const max = existing.reduce((m, r) => Math.max(m, Number(r.number.slice(base.length)) || 0), 0);
  return `${base}${String(max + 1).padStart(4, "0")}`;
}

async function loadServicePrices(svc: ServiceContext, ids: string[]) {
  if (ids.length === 0) return new Map<string, { name: string; priceMinor: number | null }>();
  const rows = await svc.tx
    .select({ id: services.id, name: services.name, priceMinor: services.priceMinor })
    .from(services)
    .where(and(eq(services.studioId, svc.studioId), inArray(services.id, ids)));
  return new Map(rows.map((r) => [r.id, { name: r.name, priceMinor: r.priceMinor }]));
}

function totalsOrThrow(data: z.infer<typeof quotationInputSchema>) {
  const totals = computeQuote({
    items: data.items,
    discountType: data.discountType,
    discountValue: data.discountValue,
    taxRateBps: data.taxRateBps,
    depositType: data.depositType,
    depositValue: data.depositValue,
    milestones: data.milestones,
  });
  if (totals.problems.length) throw new ValidationError(totals.problems.join(" "), { items: totals.problems });
  return totals;
}

/** Default values for a new quotation on a lead (prefilled from studio settings). */
export async function quotationDefaults(svc: ServiceContext, leadId: string) {
  const [lead] = await svc.tx.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.studioId, svc.studioId)));
  if (!lead) throw new NotFoundError("Lead");
  const [studio] = await svc.tx.select().from(studios).where(eq(studios.id, svc.studioId));
  const settings = parseStudioSettings(studio.settings);
  return {
    lead,
    studio,
    defaults: {
      title: `${lead.eventType} coverage – ${lead.contactName}${lead.partnerName ? ` & ${lead.partnerName}` : ""}`,
      clientName: lead.partnerName ? `${lead.contactName} & ${lead.partnerName}` : lead.contactName,
      clientEmail: lead.email ?? "",
      clientPhone: lead.phone,
      eventSummary: [lead.eventType, lead.city, lead.venue].filter(Boolean).join(" · "),
      eventDate: lead.eventDate ?? "",
      validUntil: addDaysToDateString(dateInTz(new Date(), studio.timezone), settings.quotation.validityDays),
      taxRateBps: settings.quotation.taxRateBps,
      taxLabel: settings.quotation.taxLabel,
      depositType: "percent" as const,
      depositValue: settings.quotation.defaultDepositPercent * 100,
      terms: settings.quotation.terms,
    },
  };
}

export async function createQuotation(svc: ServiceContext, leadId: string, input: QuotationInput, opts: { aiAssisted?: boolean } = {}) {
  requireWriter(svc);
  const data = quotationInputSchema.parse(input);
  const { lead, studio } = await quotationDefaults(svc, leadId);
  const settings = parseStudioSettings(studio.settings);
  const prices = await loadServicePrices(svc, data.items.map((i) => i.serviceId).filter(Boolean) as string[]);
  for (const item of data.items) {
    if (item.serviceId && !prices.has(item.serviceId)) throw new ValidationError("A selected service does not exist in this studio");
  }
  const totals = totalsOrThrow(data);
  const number = await nextNumber(svc, settings.quotation.prefix, dateInTz(new Date(), studio.timezone).slice(0, 4));
  const [quotation] = await svc.tx
    .insert(quotations)
    .values({
      studioId: svc.studioId,
      leadId,
      number,
      title: data.title,
      clientName: data.clientName,
      clientEmail: data.clientEmail ?? null,
      clientPhone: data.clientPhone ?? lead.phone,
      eventSummary: data.eventSummary ?? null,
      eventDate: data.eventDate ?? null,
      validUntil: data.validUntil ?? null,
      currency: studio.currency,
      discountType: data.discountType,
      discountValue: data.discountValue,
      taxRateBps: data.taxRateBps,
      taxLabel: data.taxLabel,
      subtotalMinor: totals.subtotalMinor,
      discountMinor: totals.discountMinor,
      taxMinor: totals.taxMinor,
      totalMinor: totals.totalMinor,
      depositType: data.depositType,
      depositValue: data.depositValue,
      depositMinor: totals.depositMinor,
      milestones: data.milestones.map((m) => ({ label: m.label, amountMinor: m.amountMinor, dueDate: m.dueDate ?? null })),
      terms: data.terms ?? settings.quotation.terms,
      internalNotes: data.internalNotes ?? null,
      aiAssisted: opts.aiAssisted ?? false,
      createdBy: svc.userId,
    })
    .returning();
  await svc.tx.insert(quotationItems).values(
    data.items.map((item, i) => ({
      studioId: svc.studioId,
      quotationId: quotation.id,
      serviceId: item.serviceId ?? null,
      description: item.description,
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor,
      lineTotalMinor: totals.lineTotals[i],
      sortOrder: i,
    })),
  );
  await recordActivity(svc, {
    leadId,
    type: "quotation_created",
    summary: `Quotation ${number} drafted (${formatMoney(totals.totalMinor, studio.currency)})${opts.aiAssisted ? " with AI assistance" : ""}`,
    data: { quotationId: quotation.id },
  });
  await emitEvent(svc.tx, svc.studioId, { trigger: "quotation_created", leadId, key: `quotation_created:${quotation.id}`, data: { quotationId: quotation.id } });
  return quotation;
}

export async function getQuotation(svc: Pick<ServiceContext, "tx" | "studioId">, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Quotation");
  const [quotation] = await svc.tx.select().from(quotations).where(and(eq(quotations.id, id), eq(quotations.studioId, svc.studioId)));
  if (!quotation) throw new NotFoundError("Quotation");
  const items = await svc.tx.select().from(quotationItems).where(eq(quotationItems.quotationId, id)).orderBy(asc(quotationItems.sortOrder));
  return { quotation, items };
}

export async function updateQuotation(svc: ServiceContext, id: string, input: QuotationInput) {
  requireWriter(svc);
  const { quotation } = await getQuotation(svc, id);
  if (quotation.status !== "draft") throw new ValidationError("Only draft quotations can be edited. Move it back to draft first.");
  const data = quotationInputSchema.parse(input);
  const prices = await loadServicePrices(svc, data.items.map((i) => i.serviceId).filter(Boolean) as string[]);
  for (const item of data.items) {
    if (item.serviceId && !prices.has(item.serviceId)) throw new ValidationError("A selected service does not exist in this studio");
  }
  const totals = totalsOrThrow(data);
  await svc.tx
    .update(quotations)
    .set({
      title: data.title,
      clientName: data.clientName,
      clientEmail: data.clientEmail ?? null,
      clientPhone: data.clientPhone ?? quotation.clientPhone,
      eventSummary: data.eventSummary ?? null,
      eventDate: data.eventDate ?? null,
      validUntil: data.validUntil ?? null,
      discountType: data.discountType,
      discountValue: data.discountValue,
      taxRateBps: data.taxRateBps,
      taxLabel: data.taxLabel,
      subtotalMinor: totals.subtotalMinor,
      discountMinor: totals.discountMinor,
      taxMinor: totals.taxMinor,
      totalMinor: totals.totalMinor,
      depositType: data.depositType,
      depositValue: data.depositValue,
      depositMinor: totals.depositMinor,
      milestones: data.milestones.map((m) => ({ label: m.label, amountMinor: m.amountMinor, dueDate: m.dueDate ?? null })),
      terms: data.terms ?? quotation.terms,
      internalNotes: data.internalNotes ?? null,
      updatedAt: new Date(),
    })
    .where(eq(quotations.id, id));
  await svc.tx.delete(quotationItems).where(eq(quotationItems.quotationId, id));
  await svc.tx.insert(quotationItems).values(
    data.items.map((item, i) => ({
      studioId: svc.studioId,
      quotationId: id,
      serviceId: item.serviceId ?? null,
      description: item.description,
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor,
      lineTotalMinor: totals.lineTotals[i],
      sortOrder: i,
    })),
  );
  await recordActivity(svc, { leadId: quotation.leadId, type: "quotation_updated", summary: `Quotation ${quotation.number} updated`, data: { quotationId: id } });
  return getQuotation(svc, id);
}

/** Moves a quotation through its lifecycle. "accepted" never confirms a booking by itself. */
export async function setQuotationStatus(svc: ServiceContext, id: string, to: QuotationStatus) {
  requireWriter(svc);
  const { quotation, items } = await getQuotation(svc, id);
  if (!QUOTATION_TRANSITIONS[quotation.status].includes(to)) {
    throw new ValidationError(`A ${quotation.status} quotation cannot be marked ${to}`);
  }
  if (to === "approved" && items.length === 0) throw new ValidationError("Add items before approving");
  const now = new Date();
  await svc.tx
    .update(quotations)
    .set({
      status: to,
      ...(to === "approved" && { approvedBy: svc.userId, approvedAt: now }),
      ...(to === "draft" && { approvedBy: null, approvedAt: null }),
      ...(to === "sent" && { sentAt: now }),
      ...(to === "accepted" && { acceptedAt: now }),
      ...(to === "rejected" && { rejectedAt: now }),
      updatedAt: now,
    })
    .where(eq(quotations.id, id));
  await recordActivity(svc, {
    leadId: quotation.leadId,
    type: `quotation_${to}`,
    summary: `Quotation ${quotation.number} marked ${to}${to === "accepted" ? " (booking not yet confirmed)" : ""}`,
    data: { quotationId: id },
  });

  const [lead] = await svc.tx.select().from(leads).where(eq(leads.id, quotation.leadId));
  if (to === "sent") {
    await svc.tx.update(leads).set({ quotationAmountMinor: quotation.totalMinor, updatedAt: now }).where(eq(leads.id, lead.id));
    if (["new_enquiry", "contact_attempted", "contacted", "qualified", "consultation_scheduled"].includes(lead.status)) {
      await changeLeadStatus(svc, lead.id, { status: "quotation_sent", note: `Quotation ${quotation.number} sent` });
    }
    if (quotation.validUntil) {
      await svc.tx.insert(calendarEntries).values({
        studioId: svc.studioId,
        leadId: lead.id,
        quotationId: id,
        type: "quotation_expiry",
        title: `Quotation ${quotation.number} expires – ${lead.contactName}`,
        entryDate: quotation.validUntil,
        createdBy: svc.userId,
      });
    }
  }
  if (to === "accepted") {
    await svc.tx.update(leads).set({ quotationAmountMinor: quotation.totalMinor, updatedAt: now }).where(eq(leads.id, lead.id));
  }
  if (to === "draft" || to === "rejected" || to === "expired" || to === "accepted") {
    await svc.tx.delete(calendarEntries).where(and(eq(calendarEntries.quotationId, id), eq(calendarEntries.type, "quotation_expiry")));
  }
}

export async function listQuotations(svc: ServiceContext, filter: { leadId?: string; status?: QuotationStatus } = {}) {
  const parts = [eq(quotations.studioId, svc.studioId)];
  if (filter.leadId) parts.push(eq(quotations.leadId, filter.leadId));
  if (filter.status) parts.push(eq(quotations.status, filter.status));
  return svc.tx
    .select({
      id: quotations.id,
      number: quotations.number,
      title: quotations.title,
      status: quotations.status,
      totalMinor: quotations.totalMinor,
      currency: quotations.currency,
      validUntil: quotations.validUntil,
      leadId: quotations.leadId,
      clientName: quotations.clientName,
      aiAssisted: quotations.aiAssisted,
      createdAt: quotations.createdAt,
    })
    .from(quotations)
    .where(and(...parts))
    .orderBy(desc(quotations.createdAt))
    .limit(200);
}

export async function listPricedServices(svc: Pick<ServiceContext, "tx" | "studioId">) {
  return svc.tx
    .select()
    .from(services)
    .where(and(eq(services.studioId, svc.studioId), eq(services.active, true)))
    .orderBy(asc(services.sortOrder), asc(services.name));
}
