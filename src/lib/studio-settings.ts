import { z } from "zod";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour)");

export const formFieldKeys = [
  "partnerName",
  "email",
  "additionalDates",
  "photographyPreferences",
  "cinematographyPreferences",
  "budgetRange",
  "additionalRequirements",
  "preferredChannel",
] as const;
export type FormFieldKey = (typeof formFieldKeys)[number];

export const studioSettingsSchema = z.object({
  businessHours: z
    .object({
      days: z.array(z.number().int().min(0).max(6)).min(1), // 0 = Sunday
      start: time,
      end: time,
    })
    .default({ days: [1, 2, 3, 4, 5, 6], start: "10:00", end: "19:00" }),
  enquiryForm: z
    .object({
      enabledFields: z.array(z.enum(formFieldKeys)).default([...formFieldKeys]),
      budgetRanges: z.array(z.string().min(1).max(60)).max(12).default([
        "Under ₹1,00,000",
        "₹1,00,000 – ₹2,50,000",
        "₹2,50,000 – ₹5,00,000",
        "₹5,00,000 – ₹10,00,000",
        "Above ₹10,00,000",
        "Not decided yet",
      ]),
      consentText: z
        .string()
        .min(10)
        .max(600)
        .default(
          "I agree that the studio may contact me about this enquiry by phone, WhatsApp or email. I can opt out at any time by replying STOP.",
        ),
    })
    .default({
      enabledFields: [...formFieldKeys],
      budgetRanges: [
        "Under ₹1,00,000",
        "₹1,00,000 – ₹2,50,000",
        "₹2,50,000 – ₹5,00,000",
        "₹5,00,000 – ₹10,00,000",
        "Above ₹10,00,000",
        "Not decided yet",
      ],
      consentText:
        "I agree that the studio may contact me about this enquiry by phone, WhatsApp or email. I can opt out at any time by replying STOP.",
    }),
  quotation: z
    .object({
      taxRateBps: z.number().int().min(0).max(5000).default(1800), // 18% GST
      taxLabel: z.string().max(40).default("GST"),
      validityDays: z.number().int().min(1).max(365).default(14),
      defaultDepositPercent: z.number().int().min(0).max(100).default(30),
      terms: z
        .string()
        .max(5000)
        .default(
          "This quotation is valid until the date shown. A date is reserved only after the booking is confirmed in writing and the agreed deposit has been received.",
        ),
      prefix: z.string().max(10).default("Q"),
    })
    .default({
      taxRateBps: 1800,
      taxLabel: "GST",
      validityDays: 14,
      defaultDepositPercent: 30,
      terms:
        "This quotation is valid until the date shown. A date is reserved only after the booking is confirmed in writing and the agreed deposit has been received.",
      prefix: "Q",
    }),
  booking: z
    .object({
      requireAcceptedQuotation: z.boolean().default(true),
      requireDepositRecorded: z.boolean().default(true),
      maxBookingsPerDay: z.number().int().min(1).max(20).default(1),
    })
    .default({ requireAcceptedQuotation: true, requireDepositRecorded: true, maxBookingsPerDay: 1 }),
  followUp: z
    .object({
      maxAutomatedMessagesPerLead: z.number().int().min(0).max(10).default(2),
      minHoursBetweenMessages: z.number().int().min(1).max(720).default(48),
      inactiveAfterDays: z.number().int().min(1).max(90).default(10),
      eventApproachingDays: z.number().int().min(1).max(180).default(14),
      consultationReminderHours: z.number().int().min(1).max(168).default(24),
      quotationAwaitingDays: z.number().int().min(1).max(60).default(4),
    })
    .default({
      maxAutomatedMessagesPerLead: 2,
      minHoursBetweenMessages: 48,
      inactiveAfterDays: 10,
      eventApproachingDays: 14,
      consultationReminderHours: 24,
      quotationAwaitingDays: 4,
    }),
});

export type StudioSettings = z.infer<typeof studioSettingsSchema>;

export function parseStudioSettings(value: unknown): StudioSettings {
  const result = studioSettingsSchema.safeParse(value ?? {});
  if (result.success) return result.data;
  // Fall back to defaults for any invalid section rather than breaking the studio.
  return studioSettingsSchema.parse({});
}

export const DEFAULT_STUDIO_SETTINGS: StudioSettings = studioSettingsSchema.parse({});
