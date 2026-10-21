import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ACTIVE_STATUSES } from "@/lib/domain";
import type { AutomationAction, Condition } from "@/lib/automation-schema";
import { DEFAULT_STUDIO_SETTINGS } from "@/lib/studio-settings";
import { asSystem, type Tx } from "@/server/db/client";
import { automationRules, messageTemplates, services, studioInvites, studioMembers, studios } from "@/server/db/schema";
import { ValidationError } from "@/server/lib/errors";
import { audit } from "./activity";

export const RESERVED_SLUGS = new Set(["admin", "api", "app", "login", "register", "settings", "www", "demo-admin"]);

export const createStudioSchema = z.object({
  name: z.string().trim().min(2, "Studio name is required").max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "At least 3 characters")
    .max(48)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens"),
  businessType: z.enum(["photography", "cinematography", "photo_video"]),
  city: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().email().max(200).optional().or(z.literal("").transform(() => undefined)),
});
export type CreateStudioInput = z.infer<typeof createStudioSchema>;

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** Creates a studio, makes the user its owner and installs editable defaults. */
export async function createStudio(userId: string, input: CreateStudioInput, opts: { isDemo?: boolean } = {}) {
  const data = createStudioSchema.parse(input);
  if (RESERVED_SLUGS.has(data.slug)) throw new ValidationError("That address is reserved", { slug: ["That address is reserved"] });
  return asSystem(async (tx) => {
    const [existing] = await tx.select({ id: studios.id }).from(studios).where(eq(studios.slug, data.slug));
    if (existing) throw new ValidationError("That enquiry address is already taken", { slug: ["Already taken"] });
    const [studio] = await tx
      .insert(studios)
      .values({
        name: data.name,
        slug: data.slug,
        businessType: data.businessType,
        city: data.city ?? null,
        phone: data.phone ?? null,
        email: data.email ?? null,
        settings: DEFAULT_STUDIO_SETTINGS,
        welcomeMessage: `Thank you for considering ${data.name}. Tell us about your celebration and we'll get back to you personally.`,
        privacyNotice: `${data.name} uses the details you share only to respond to your enquiry and plan your event. We never sell your information. Reply STOP on WhatsApp or email us to stop receiving messages.`,
        isDemo: opts.isDemo ?? false,
      })
      .returning();
    await tx.insert(studioMembers).values({ studioId: studio.id, userId, role: "owner" });
    await installDefaults(tx, studio.id, data.businessType);
    await audit(tx, { studioId: studio.id, actorUserId: userId, actorType: "user", action: "studio.created", targetType: "studio", targetId: studio.id });
    return studio;
  });
}

/**
 * Default catalogue, templates and automation rules. Prices are intentionally left
 * empty: the studio must enter its own, and AI features never invent prices.
 */
export async function installDefaults(tx: Tx, studioId: string, businessType: string) {
  const photo = businessType !== "cinematography";
  const video = businessType !== "photography";
  const catalogue = [
    photo && { name: "Candid Photography", category: "photography", unit: "per_day" },
    photo && { name: "Traditional Photography", category: "photography", unit: "per_day" },
    video && { name: "Cinematic Wedding Film", category: "cinematography", unit: "per_event" },
    video && { name: "Traditional Videography", category: "cinematography", unit: "per_day" },
    video && { name: "Highlight Teaser", category: "cinematography", unit: "fixed" },
    { name: "Pre-wedding Shoot", category: "pre_wedding", unit: "fixed" },
    { name: "Drone Coverage", category: "drone", unit: "per_day" },
    photo && { name: "Premium Wedding Album", category: "album", unit: "per_item" },
  ].filter(Boolean) as { name: string; category: string; unit: string }[];
  await tx.insert(services).values(catalogue.map((s, i) => ({ ...s, studioId, priceMinor: null, sortOrder: i })));

  await tx
    .insert(messageTemplates)
    .values([
      {
        studioId,
        name: "Enquiry acknowledgement (WhatsApp)",
        channel: "whatsapp" as const,
        purpose: "acknowledgement",
        whatsappTemplateName: "enquiry_acknowledgement",
        body: "Hi {{contact_name}}, thank you for your enquiry with {{studio_name}} (ref {{reference}}). We have received your details for {{event_type}} on {{event_date}}. A member of our team will contact you shortly.",
        approved: false,
      },
      {
        studioId,
        name: "Enquiry acknowledgement (email)",
        channel: "email" as const,
        purpose: "acknowledgement",
        subject: "We received your enquiry – {{studio_name}} ({{reference}})",
        body: "Hi {{contact_name}},\n\nThank you for reaching out to {{studio_name}}. We have received your enquiry for {{event_type}} on {{event_date}} (reference {{reference}}).\n\nThis message confirms that we received your enquiry; it is not a booking confirmation. A member of our team will contact you shortly to understand your plans.\n\nWarm regards,\n{{studio_name}}",
        approved: false,
      },
      {
        studioId,
        name: "Gentle follow-up (WhatsApp)",
        channel: "whatsapp" as const,
        purpose: "follow_up",
        whatsappTemplateName: "enquiry_follow_up",
        body: "Hi {{contact_name}}, this is {{studio_name}} following up on your enquiry (ref {{reference}}). Would you like to schedule a quick call to discuss your plans? Reply STOP to opt out.",
        approved: false,
      },
    ]);

  const early = ["new_enquiry", "contact_attempted"];
  const stillOpen = ACTIVE_STATUSES as string[];
  const rules: {
    name: string;
    description: string;
    trigger: (typeof automationRules.$inferInsert)["trigger"];
    conditions: Condition[];
    actions: AutomationAction[];
    delayBusinessDays?: number;
    respectBusinessHours?: boolean;
  }[] = [
    {
      name: "New enquiry: notify team and prepare acknowledgement",
      description: "Immediately notifies studio staff and prepares an acknowledgement draft for approval. Nothing is sent automatically.",
      trigger: "lead_created",
      conditions: [],
      actions: [
        { type: "notify_staff", title: "New enquiry from {{contact_name}}", body: "{{event_type}} · {{event_date}} · {{city}}" },
        { type: "create_ai_reply_draft", purpose: "acknowledgement", channel: "auto" },
      ],
      respectBusinessHours: false,
    },
    {
      name: "Follow-up task after 1 business day",
      description: "Creates a follow-up task if nobody has contacted the client yet.",
      trigger: "lead_created",
      conditions: [
        { field: "status", op: "in", value: early },
        { field: "last_contacted_at", op: "is_empty" },
      ],
      actions: [{ type: "create_task", title: "Follow up with {{contact_name}}", taskType: "follow_up", dueInHours: 0 }],
      delayBusinessDays: 1,
    },
    {
      name: "Suggest a personalised follow-up after 3 business days",
      description: "Prepares a follow-up draft for staff approval if the lead is still active and has not replied.",
      trigger: "lead_created",
      conditions: [
        { field: "status", op: "in", value: ["new_enquiry", "contact_attempted", "contacted", "qualified"] },
        { field: "last_inbound_at", op: "is_empty" },
        { field: "opted_out", op: "is_false" },
      ],
      actions: [{ type: "create_ai_reply_draft", purpose: "follow_up", channel: "auto" }],
      delayBusinessDays: 3,
    },
    {
      name: "Final review after 7 business days",
      description: "Creates a review task so the team decides whether to keep or close the lead.",
      trigger: "lead_created",
      conditions: [{ field: "status", op: "in", value: ["new_enquiry", "contact_attempted", "contacted"] }],
      actions: [{ type: "create_task", title: "Final review: decide next step for {{contact_name}}", taskType: "review", dueInHours: 0 }],
      delayBusinessDays: 7,
    },
    {
      name: "Remind the team when a follow-up is due",
      description: "Notifies staff when a follow-up task reaches its due time.",
      trigger: "follow_up_due",
      conditions: [{ field: "status", op: "in", value: stillOpen }],
      actions: [{ type: "notify_staff", title: "Follow-up due: {{contact_name}}", body: "{{task_title}}" }],
      respectBusinessHours: false,
    },
    {
      name: "Consultation reminder",
      description: "Reminds staff before a scheduled consultation.",
      trigger: "consultation_approaching",
      conditions: [],
      actions: [{ type: "notify_staff", title: "Consultation soon with {{contact_name}}", body: "{{entry_title}} on {{entry_date}}" }],
      respectBusinessHours: false,
    },
    {
      name: "Quotation awaiting response",
      description: "Creates a task to check in when a sent quotation has had no response.",
      trigger: "quotation_awaiting_response",
      conditions: [{ field: "status", op: "in", value: ["quotation_sent", "negotiation"] }],
      actions: [{ type: "create_task", title: "Check in on quotation {{quotation_number}} with {{contact_name}}", taskType: "follow_up", dueInHours: 0 }],
    },
    {
      name: "Inactive lead review",
      description: "Creates a review task when an open lead has had no activity for the configured period.",
      trigger: "lead_inactive",
      conditions: [{ field: "status", op: "in", value: stillOpen }],
      actions: [{ type: "create_task", title: "Review inactive lead: {{contact_name}}", taskType: "review", dueInHours: 0 }],
    },
    {
      name: "Upcoming confirmed event",
      description: "Notifies the team ahead of a confirmed event date.",
      trigger: "event_date_approaching",
      conditions: [{ field: "status", op: "in", value: ["booking_confirmed", "won"] }],
      actions: [{ type: "notify_staff", title: "Upcoming event: {{contact_name}}", body: "{{event_type}} on {{event_date}}" }],
      respectBusinessHours: false,
    },
  ];
  await tx.insert(automationRules).values(
    rules.map((r) => ({
      studioId,
      name: r.name,
      description: r.description,
      trigger: r.trigger,
      conditions: r.conditions,
      actions: r.actions,
      delayBusinessDays: r.delayBusinessDays ?? 0,
      respectBusinessHours: r.respectBusinessHours ?? true,
      isDefault: true,
    })),
  );
}

export async function getPublicStudioBySlug(slug: string) {
  return asSystem(async (tx) => {
    const [studio] = await tx
      .select()
      .from(studios)
      .where(and(eq(studios.slug, slug.toLowerCase()), eq(studios.status, "active")));
    if (!studio) return null;
    const svc = await tx
      .select({ id: services.id, name: services.name, category: services.category, description: services.description })
      .from(services)
      .where(and(eq(services.studioId, studio.id), eq(services.active, true), eq(services.showOnForm, true)))
      .orderBy(services.sortOrder, services.name);
    return { studio, services: svc };
  });
}

/** Accept pending invites for this email (called after sign-in). */
export async function acceptInvites(userId: string, email: string) {
  return asSystem(async (tx) => {
    const invites = await tx
      .select()
      .from(studioInvites)
      .where(eq(studioInvites.email, email.toLowerCase()));
    let accepted = 0;
    for (const invite of invites) {
      if (invite.acceptedAt) continue;
      await tx.insert(studioMembers).values({ studioId: invite.studioId, userId, role: invite.role }).onConflictDoNothing();
      await tx.update(studioInvites).set({ acceptedAt: new Date() }).where(eq(studioInvites.id, invite.id));
      await audit(tx, { studioId: invite.studioId, actorUserId: userId, actorType: "user", action: "member.invite_accepted", targetType: "invite", targetId: invite.id });
      accepted++;
    }
    return accepted;
  });
}
