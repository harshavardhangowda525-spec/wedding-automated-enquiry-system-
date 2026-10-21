import "server-only";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { actionsSchema, conditionsSchema } from "@/lib/automation-schema";
import { AUTOMATION_TRIGGERS, MEMBER_ROLES, SERVICE_CATEGORIES, SERVICE_UNITS, roleAtLeast, type MemberRole } from "@/lib/domain";
import { parseStudioSettings, studioSettingsSchema, type StudioSettings } from "@/lib/studio-settings";
import type { ServiceContext } from "@/server/auth/context";
import {
  activities,
  automationRules,
  automationRuns,
  consents,
  leads,
  messageTemplates,
  messages,
  notifications,
  profiles,
  quotationItems,
  quotations,
  services,
  studioIntegrations,
  studioInvites,
  studioMembers,
  studios,
  tasks,
} from "@/server/db/schema";
import { env } from "@/server/env";
import { encryptSecret } from "@/server/lib/crypto";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/lib/errors";
import { audit } from "./activity";

function requireRole(svc: ServiceContext, min: MemberRole) {
  if (svc.role !== "system" && !roleAtLeast(svc.role, min)) throw new ForbiddenError();
}

async function getStudio(svc: ServiceContext) {
  const [studio] = await svc.tx.select().from(studios).where(eq(studios.id, svc.studioId));
  if (!studio) throw new NotFoundError("Studio");
  return studio;
}

// ---------------------------------------------------------------- profile & branding

const optionalStr = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

export const profileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  businessType: z.enum(["photography", "cinematography", "photo_video"]),
  email: z.string().trim().email().max(200).optional().or(z.literal("").transform(() => undefined)),
  phone: optionalStr(30),
  city: optionalStr(120),
  website: z.string().trim().url().max(300).optional().or(z.literal("").transform(() => undefined)),
  logoUrl: z
    .string()
    .trim()
    .max(500)
    .optional()
    .or(z.literal("").transform(() => undefined))
    .refine((v) => !v || /^https:\/\//.test(v), "Logo must be an https:// URL"),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #b08d57"),
  welcomeMessage: optionalStr(600),
  privacyNotice: optionalStr(2000),
  currency: z.enum(["INR", "USD", "AED", "GBP", "EUR", "SGD", "AUD"]),
  timezone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Unknown time zone"),
});

export async function updateProfile(svc: ServiceContext, input: z.input<typeof profileSchema>) {
  requireRole(svc, "admin");
  const data = profileSchema.parse(input);
  await svc.tx
    .update(studios)
    .set({ ...data, email: data.email ?? null, website: data.website ?? null, logoUrl: data.logoUrl ?? null, updatedAt: new Date() })
    .where(eq(studios.id, svc.studioId));
  await audit(svc.tx, { studioId: svc.studioId, actorUserId: svc.userId, actorType: "user", action: "studio.profile_updated" });
}

export async function updateSettingsSection<K extends keyof StudioSettings>(svc: ServiceContext, section: K, value: unknown) {
  requireRole(svc, "admin");
  const studio = await getStudio(svc);
  const current = parseStudioSettings(studio.settings);
  const next = studioSettingsSchema.parse({ ...current, [section]: value });
  await svc.tx.update(studios).set({ settings: next, updatedAt: new Date() }).where(eq(studios.id, svc.studioId));
  await audit(svc.tx, { studioId: svc.studioId, actorUserId: svc.userId, actorType: "user", action: `studio.settings.${String(section)}_updated` });
  return next;
}

export async function setAutomationPaused(svc: ServiceContext, paused: boolean) {
  requireRole(svc, "staff");
  await svc.tx.update(studios).set({ automationPaused: paused, updatedAt: new Date() }).where(eq(studios.id, svc.studioId));
  await audit(svc.tx, { studioId: svc.studioId, actorUserId: svc.userId, actorType: "user", action: paused ? "automation.paused" : "automation.resumed" });
}

export async function setAiEnabled(svc: ServiceContext, enabled: boolean) {
  requireRole(svc, "admin");
  await svc.tx.update(studios).set({ aiEnabled: enabled, updatedAt: new Date() }).where(eq(studios.id, svc.studioId));
  await audit(svc.tx, { studioId: svc.studioId, actorUserId: svc.userId, actorType: "user", action: enabled ? "ai.enabled" : "ai.disabled" });
}

export async function setRetention(svc: ServiceContext, days: number | null) {
  requireRole(svc, "owner");
  const value = days === null ? null : z.number().int().min(90).max(3650).parse(days);
  await svc.tx.update(studios).set({ dataRetentionDays: value, updatedAt: new Date() }).where(eq(studios.id, svc.studioId));
  await audit(svc.tx, { studioId: svc.studioId, actorUserId: svc.userId, actorType: "user", action: "studio.retention_updated", metadata: { days: value } });
}

// ---------------------------------------------------------------- services catalogue

export const serviceSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: optionalStr(500),
  category: z.enum(SERVICE_CATEGORIES),
  unit: z.enum(SERVICE_UNITS),
  priceMinor: z.number().int().min(0).max(10_000_000_000).nullable(),
  active: z.boolean().default(true),
  showOnForm: z.boolean().default(true),
});

export async function listServices(svc: ServiceContext) {
  return svc.tx.select().from(services).where(eq(services.studioId, svc.studioId)).orderBy(asc(services.sortOrder), asc(services.name));
}

export async function saveService(svc: ServiceContext, id: string | null, input: z.input<typeof serviceSchema>) {
  requireRole(svc, "admin");
  const data = serviceSchema.parse(input);
  if (id) {
    const [row] = await svc.tx.update(services).set({ ...data, updatedAt: new Date() }).where(and(eq(services.id, id), eq(services.studioId, svc.studioId))).returning();
    if (!row) throw new NotFoundError("Service");
    return row;
  }
  const existing = await listServices(svc);
  const [row] = await svc.tx.insert(services).values({ ...data, studioId: svc.studioId, sortOrder: existing.length }).returning();
  return row;
}

export async function deleteService(svc: ServiceContext, id: string) {
  requireRole(svc, "admin");
  // Services referenced by leads/quotations are deactivated rather than removed.
  await svc.tx.update(services).set({ active: false, showOnForm: false, updatedAt: new Date() }).where(and(eq(services.id, id), eq(services.studioId, svc.studioId)));
}

// ---------------------------------------------------------------- templates

export const templateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  channel: z.enum(["whatsapp", "email"]),
  purpose: z.enum(["acknowledgement", "follow_up", "quotation", "general"]),
  whatsappTemplateName: z
    .string()
    .trim()
    .max(120)
    .regex(/^[a-z0-9_]*$/, "Lowercase letters, numbers and underscores (as in WhatsApp Manager)")
    .optional()
    .transform((v) => (v ? v : null)),
  language: z.string().trim().min(2).max(10).default("en"),
  subject: optionalStr(200),
  body: z.string().trim().min(5).max(4000),
  approved: z.boolean().default(false),
  active: z.boolean().default(true),
});

export async function listTemplates(svc: ServiceContext) {
  return svc.tx.select().from(messageTemplates).where(eq(messageTemplates.studioId, svc.studioId)).orderBy(asc(messageTemplates.channel), asc(messageTemplates.name));
}

export async function saveTemplate(svc: ServiceContext, id: string | null, input: z.input<typeof templateSchema>) {
  requireRole(svc, "admin");
  const data = templateSchema.parse(input);
  if (data.channel === "email" && !data.subject) throw new ValidationError("Email templates need a subject", { subject: ["Required for email"] });
  if (id) {
    const [row] = await svc.tx.update(messageTemplates).set({ ...data, updatedAt: new Date() }).where(and(eq(messageTemplates.id, id), eq(messageTemplates.studioId, svc.studioId))).returning();
    if (!row) throw new NotFoundError("Template");
    return row;
  }
  const [row] = await svc.tx.insert(messageTemplates).values({ ...data, studioId: svc.studioId }).returning();
  return row;
}

// ---------------------------------------------------------------- team

export async function listTeam(svc: ServiceContext) {
  const members = await svc.tx
    .select({ id: studioMembers.id, userId: studioMembers.userId, role: studioMembers.role, email: profiles.email, fullName: profiles.fullName, createdAt: studioMembers.createdAt })
    .from(studioMembers)
    .innerJoin(profiles, eq(profiles.id, studioMembers.userId))
    .where(eq(studioMembers.studioId, svc.studioId))
    .orderBy(asc(studioMembers.createdAt));
  const invites = await svc.tx.select().from(studioInvites).where(eq(studioInvites.studioId, svc.studioId)).orderBy(desc(studioInvites.createdAt));
  return { members, invites };
}

export async function inviteMember(svc: ServiceContext, email: string, role: MemberRole) {
  requireRole(svc, "admin");
  const data = z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(MEMBER_ROLES) }).parse({ email, role });
  if (data.role === "owner" && svc.role !== "owner") throw new ForbiddenError("Only owners can invite owners");
  await svc.tx
    .insert(studioInvites)
    .values({ studioId: svc.studioId, email: data.email, role: data.role, invitedBy: svc.userId })
    .onConflictDoUpdate({ target: [studioInvites.studioId, studioInvites.email], set: { role: data.role, acceptedAt: null } });
  await audit(svc.tx, { studioId: svc.studioId, actorUserId: svc.userId, actorType: "user", action: "member.invited", metadata: { email: data.email, role: data.role } });
}

export async function changeMemberRole(svc: ServiceContext, memberId: string, role: MemberRole) {
  requireRole(svc, "admin");
  const [member] = await svc.tx.select().from(studioMembers).where(and(eq(studioMembers.id, memberId), eq(studioMembers.studioId, svc.studioId)));
  if (!member) throw new NotFoundError("Member");
  if ((member.role === "owner" || role === "owner") && svc.role !== "owner") throw new ForbiddenError("Only owners can change owner roles");
  if (member.role === "owner" && role !== "owner") {
    const owners = await svc.tx.select().from(studioMembers).where(and(eq(studioMembers.studioId, svc.studioId), eq(studioMembers.role, "owner"), ne(studioMembers.id, memberId)));
    if (owners.length === 0) throw new ValidationError("A studio must keep at least one owner");
  }
  await svc.tx.update(studioMembers).set({ role }).where(eq(studioMembers.id, memberId));
  await audit(svc.tx, { studioId: svc.studioId, actorUserId: svc.userId, actorType: "user", action: "member.role_changed", targetId: member.userId, metadata: { from: member.role, to: role } });
}

export async function removeMember(svc: ServiceContext, memberId: string) {
  requireRole(svc, "admin");
  const [member] = await svc.tx.select().from(studioMembers).where(and(eq(studioMembers.id, memberId), eq(studioMembers.studioId, svc.studioId)));
  if (!member) throw new NotFoundError("Member");
  if (member.role === "owner") throw new ValidationError("Transfer ownership before removing an owner");
  await svc.tx.delete(studioMembers).where(eq(studioMembers.id, memberId));
  await svc.tx.update(leads).set({ assignedTo: null }).where(and(eq(leads.studioId, svc.studioId), eq(leads.assignedTo, member.userId)));
  await audit(svc.tx, { studioId: svc.studioId, actorUserId: svc.userId, actorType: "user", action: "member.removed", targetId: member.userId });
}

export async function revokeInvite(svc: ServiceContext, inviteId: string) {
  requireRole(svc, "admin");
  await svc.tx.delete(studioInvites).where(and(eq(studioInvites.id, inviteId), eq(studioInvites.studioId, svc.studioId)));
}

// ---------------------------------------------------------------- integrations

export const whatsappConfigSchema = z.object({
  phoneNumberId: z.string().trim().regex(/^\d{5,30}$/, "Numeric phone number ID from WhatsApp Manager"),
  businessAccountId: z.string().trim().regex(/^\d{5,30}$/).optional().or(z.literal("").transform(() => undefined)),
  accessToken: z.string().trim().min(20, "Paste a permanent system-user access token").optional().or(z.literal("").transform(() => undefined)),
});

/** Integration rows without secrets, safe to send to the browser. */
export async function listIntegrations(svc: ServiceContext) {
  const rows = await svc.tx.select().from(studioIntegrations).where(eq(studioIntegrations.studioId, svc.studioId));
  return rows.map(({ secretEncrypted, ...rest }) => ({ ...rest, hasSecret: Boolean(secretEncrypted) }));
}

export async function saveWhatsAppIntegration(svc: ServiceContext, input: z.input<typeof whatsappConfigSchema>) {
  requireRole(svc, "owner");
  const data = whatsappConfigSchema.parse(input);
  const [existing] = await svc.tx
    .select()
    .from(studioIntegrations)
    .where(and(eq(studioIntegrations.studioId, svc.studioId), eq(studioIntegrations.provider, "whatsapp_cloud")));
  if (!data.accessToken && !existing?.secretEncrypted) throw new ValidationError("An access token is required", { accessToken: ["Required"] });
  const secret = data.accessToken ? encryptSecret(data.accessToken) : existing!.secretEncrypted;
  const config = { phoneNumberId: data.phoneNumberId, ...(data.businessAccountId ? { businessAccountId: data.businessAccountId } : {}) };
  await svc.tx
    .insert(studioIntegrations)
    .values({ studioId: svc.studioId, provider: "whatsapp_cloud", status: "configured", config, secretEncrypted: secret })
    .onConflictDoUpdate({
      target: [studioIntegrations.studioId, studioIntegrations.provider],
      // Saving new details resets verification until it is tested again.
      set: { status: "configured", config, secretEncrypted: secret, lastVerifiedAt: null, lastError: null, updatedAt: new Date() },
    });
  await audit(svc.tx, { studioId: svc.studioId, actorUserId: svc.userId, actorType: "user", action: "integration.whatsapp_saved", metadata: { phoneNumberId: data.phoneNumberId } });
}

export async function recordIntegrationCheck(svc: ServiceContext, provider: string, ok: boolean, error?: string) {
  await svc.tx
    .update(studioIntegrations)
    .set({ status: ok ? "verified" : "error", lastVerifiedAt: ok ? new Date() : null, lastError: ok ? null : (error ?? "Check failed"), updatedAt: new Date() })
    .where(and(eq(studioIntegrations.studioId, svc.studioId), eq(studioIntegrations.provider, provider)));
}

export async function disconnectIntegration(svc: ServiceContext, provider: string) {
  requireRole(svc, "owner");
  await svc.tx.delete(studioIntegrations).where(and(eq(studioIntegrations.studioId, svc.studioId), eq(studioIntegrations.provider, provider)));
  await audit(svc.tx, { studioId: svc.studioId, actorUserId: svc.userId, actorType: "user", action: `integration.${provider}_disconnected` });
}

/** Calls the Graph API to confirm the phone number id and token work. Does not send a message. */
export async function verifyWhatsAppCredentials(phoneNumberId: string, accessToken: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(`https://graph.facebook.com/${env().WHATSAPP_GRAPH_VERSION}/${phoneNumberId}?fields=display_phone_number,verified_name`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as { display_phone_number?: string; verified_name?: string; error?: { message?: string } };
    if (!res.ok) return { ok: false, detail: json.error?.message ?? `HTTP ${res.status}` };
    return { ok: true, detail: `Connected to ${json.verified_name ?? "WhatsApp Business"} (${json.display_phone_number ?? phoneNumberId})` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : "Network error" };
  }
}

// ---------------------------------------------------------------- automation rules

export const ruleSchema = z.object({
  name: z.string().trim().min(3).max(120),
  description: optionalStr(500),
  trigger: z.enum(AUTOMATION_TRIGGERS),
  conditions: conditionsSchema,
  actions: actionsSchema,
  delayMinutes: z.number().int().min(0).max(60 * 24 * 30),
  delayBusinessDays: z.number().int().min(0).max(30),
  respectBusinessHours: z.boolean(),
  enabled: z.boolean(),
  dryRun: z.boolean(),
  maxAttempts: z.number().int().min(1).max(10).default(3),
});

export async function listRules(svc: ServiceContext) {
  return svc.tx.select().from(automationRules).where(eq(automationRules.studioId, svc.studioId)).orderBy(asc(automationRules.trigger), asc(automationRules.createdAt));
}

export async function getRule(svc: ServiceContext, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Rule");
  const [rule] = await svc.tx.select().from(automationRules).where(and(eq(automationRules.id, id), eq(automationRules.studioId, svc.studioId)));
  if (!rule) throw new NotFoundError("Rule");
  return rule;
}

export async function saveRule(svc: ServiceContext, id: string | null, input: z.input<typeof ruleSchema>) {
  requireRole(svc, "admin");
  const data = ruleSchema.parse(input);
  // Templates referenced by actions must belong to this studio.
  for (const action of data.actions) {
    if (action.type === "queue_email" || action.type === "queue_whatsapp_template") {
      const [tpl] = await svc.tx.select().from(messageTemplates).where(and(eq(messageTemplates.id, action.templateId), eq(messageTemplates.studioId, svc.studioId)));
      if (!tpl) throw new ValidationError("Choose a template for every message action");
      if (!action.requireApproval && !tpl.approved) throw new ValidationError(`"${tpl.name}" must be marked approved before it can be sent without per-message approval`);
    }
    if (action.type === "assign_lead" && action.strategy === "specific") {
      const [m] = await svc.tx.select().from(studioMembers).where(and(eq(studioMembers.studioId, svc.studioId), eq(studioMembers.userId, action.userId ?? "00000000-0000-0000-0000-000000000000")));
      if (!m) throw new ValidationError("Choose a team member for the assignment action");
    }
  }
  let rule;
  if (id) {
    await getRule(svc, id);
    [rule] = await svc.tx.update(automationRules).set({ ...data, updatedAt: new Date() }).where(eq(automationRules.id, id)).returning();
  } else {
    [rule] = await svc.tx.insert(automationRules).values({ ...data, studioId: svc.studioId }).returning();
  }
  await audit(svc.tx, { studioId: svc.studioId, actorUserId: svc.userId, actorType: "user", action: id ? "automation.rule_updated" : "automation.rule_created", targetType: "automation_rule", targetId: rule.id });
  return rule;
}

export async function toggleRule(svc: ServiceContext, id: string, enabled: boolean) {
  requireRole(svc, "admin");
  await getRule(svc, id);
  await svc.tx.update(automationRules).set({ enabled, updatedAt: new Date() }).where(eq(automationRules.id, id));
}

export async function deleteRule(svc: ServiceContext, id: string) {
  requireRole(svc, "admin");
  await getRule(svc, id);
  await svc.tx.delete(automationRules).where(eq(automationRules.id, id));
  await audit(svc.tx, { studioId: svc.studioId, actorUserId: svc.userId, actorType: "user", action: "automation.rule_deleted", targetId: id });
}

export async function listRuns(svc: ServiceContext, opts: { ruleId?: string; limit?: number } = {}) {
  const parts = [eq(automationRuns.studioId, svc.studioId)];
  if (opts.ruleId) parts.push(eq(automationRuns.ruleId, opts.ruleId));
  return svc.tx
    .select({ run: automationRuns, ruleName: automationRules.name, leadName: leads.contactName })
    .from(automationRuns)
    .innerJoin(automationRules, eq(automationRules.id, automationRuns.ruleId))
    .leftJoin(leads, eq(leads.id, automationRuns.leadId))
    .where(and(...parts))
    .orderBy(desc(automationRuns.createdAt))
    .limit(opts.limit ?? 100);
}

// ---------------------------------------------------------------- notifications

export async function listNotifications(svc: ServiceContext, limit = 30) {
  const rows = await svc.tx
    .select()
    .from(notifications)
    .where(eq(notifications.studioId, svc.studioId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
  return rows.filter((n) => !n.userId || n.userId === svc.userId);
}

export async function markNotificationsRead(svc: ServiceContext) {
  await svc.tx.update(notifications).set({ readAt: new Date() }).where(eq(notifications.studioId, svc.studioId));
}

// ---------------------------------------------------------------- data export / deletion

/** Full JSON export of the studio's data (owner only, audited). */
export async function exportStudioData(svc: ServiceContext, meta: { ipHash?: string | null }) {
  requireRole(svc, "owner");
  const studio = await getStudio(svc);
  const where = <T extends { studioId: unknown }>(t: T) => eq(t.studioId as never, svc.studioId);
  const data = {
    exportedAt: new Date().toISOString(),
    studio,
    services: await svc.tx.select().from(services).where(where(services)),
    leads: await svc.tx.select().from(leads).where(where(leads)),
    consents: await svc.tx.select().from(consents).where(where(consents)),
    activities: await svc.tx.select().from(activities).where(where(activities)),
    tasks: await svc.tx.select().from(tasks).where(where(tasks)),
    messages: await svc.tx.select().from(messages).where(where(messages)),
    quotations: await svc.tx.select().from(quotations).where(where(quotations)),
    quotationItems: await svc.tx.select().from(quotationItems).where(where(quotationItems)),
    templates: await svc.tx.select().from(messageTemplates).where(where(messageTemplates)),
    automationRules: await svc.tx.select().from(automationRules).where(where(automationRules)),
  };
  await audit(svc.tx, { studioId: svc.studioId, actorUserId: svc.userId, actorType: "user", action: "studio.data_exported", ipHash: meta.ipHash ?? null });
  return data;
}
