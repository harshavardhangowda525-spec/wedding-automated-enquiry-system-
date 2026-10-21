import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  AUTOMATION_TRIGGERS,
  CALENDAR_ENTRY_TYPES,
  LEAD_STATUSES,
  MEMBER_ROLES,
  MESSAGE_STATUSES,
  PRIORITIES,
  QUOTATION_STATUSES,
  TASK_TYPES,
} from "@/lib/domain";

/**
 * All application tables live in the `wf` schema so they are never exposed by
 * Supabase's auto-generated REST API (which only serves `public`).
 */
export const wf = pgSchema("wf");

export const leadStatusEnum = wf.enum("lead_status", LEAD_STATUSES);
export const memberRoleEnum = wf.enum("member_role", MEMBER_ROLES);
export const priorityEnum = wf.enum("priority", PRIORITIES);
export const messageStatusEnum = wf.enum("message_status", MESSAGE_STATUSES);
export const channelEnum = wf.enum("channel", ["whatsapp", "email"]);
export const directionEnum = wf.enum("direction", ["outbound", "inbound"]);
export const quotationStatusEnum = wf.enum("quotation_status", QUOTATION_STATUSES);
export const taskStatusEnum = wf.enum("task_status", ["open", "done", "cancelled"]);
export const taskTypeEnum = wf.enum("task_type", TASK_TYPES);
export const calendarEntryTypeEnum = wf.enum("calendar_entry_type", CALENDAR_ENTRY_TYPES);
export const jobStatusEnum = wf.enum("job_status", ["pending", "running", "completed", "failed", "dead", "cancelled"]);
export const automationTriggerEnum = wf.enum("automation_trigger", AUTOMATION_TRIGGERS);
export const automationRunStatusEnum = wf.enum("automation_run_status", [
  "scheduled",
  "running",
  "completed",
  "dry_run",
  "skipped",
  "failed",
  "cancelled",
]);
export const actorTypeEnum = wf.enum("actor_type", ["user", "system", "automation", "client", "ai", "platform_admin"]);

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const studioId = () =>
  uuid("studio_id")
    .notNull()
    .references(() => studios.id, { onDelete: "cascade" });

// ---------------------------------------------------------------- identity

/** One row per authenticated user. `id` equals the Supabase Auth user id. */
export const profiles = wf.table("profiles", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull().unique(),
  fullName: text("full_name"),
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  createdAt: createdAt(),
});

/** Password store used ONLY by the local demo auth adapter (when Supabase is not configured). */
export const localAuthUsers = wf.table("local_auth_users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: createdAt(),
});

export const studios = wf.table("studios", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  businessType: text("business_type").notNull().default("photo_video"),
  email: text("email"),
  phone: text("phone"),
  city: text("city"),
  website: text("website"),
  logoUrl: text("logo_url"),
  brandColor: text("brand_color").notNull().default("#b08d57"),
  welcomeMessage: text("welcome_message"),
  privacyNotice: text("privacy_notice"),
  currency: text("currency").notNull().default("INR"),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  settings: jsonb("settings").notNull().default({}),
  automationPaused: boolean("automation_paused").notNull().default(false),
  aiEnabled: boolean("ai_enabled").notNull().default(true),
  isDemo: boolean("is_demo").notNull().default(false),
  status: text("status").notNull().default("active"),
  dataRetentionDays: integer("data_retention_days"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const studioMembers = wf.table(
  "studio_members",
  {
    id: id(),
    studioId: studioId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").notNull().default("staff"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("studio_members_studio_user_uq").on(t.studioId, t.userId), index("studio_members_user_idx").on(t.userId)],
);

export const studioInvites = wf.table(
  "studio_invites",
  {
    id: id(),
    studioId: studioId(),
    email: text("email").notNull(),
    role: memberRoleEnum("role").notNull().default("staff"),
    invitedBy: uuid("invited_by").references(() => profiles.id, { onDelete: "set null" }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("studio_invites_studio_email_uq").on(t.studioId, t.email)],
);

// ---------------------------------------------------------------- catalogue

export const services = wf.table(
  "services",
  {
    id: id(),
    studioId: studioId(),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category").notNull().default("photography"),
    unit: text("unit").notNull().default("per_event"),
    /** Price in minor units (paise). Null means "price on request" – AI must never invent one. */
    priceMinor: bigint("price_minor", { mode: "number" }),
    active: boolean("active").notNull().default(true),
    showOnForm: boolean("show_on_form").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("services_studio_idx").on(t.studioId)],
);

// ---------------------------------------------------------------- leads

export const leads = wf.table(
  "leads",
  {
    id: id(),
    studioId: studioId(),
    reference: text("reference").notNull(),
    contactName: text("contact_name").notNull(),
    partnerName: text("partner_name"),
    phone: text("phone").notNull(),
    email: text("email"),
    eventType: text("event_type").notNull(),
    eventDate: date("event_date"),
    additionalDates: jsonb("additional_dates").$type<{ date: string; label?: string }[]>().notNull().default([]),
    city: text("city"),
    venue: text("venue"),
    serviceIds: uuid("service_ids").array().notNull().default(sql`'{}'::uuid[]`),
    preferences: jsonb("preferences").$type<Record<string, string>>().notNull().default({}),
    budgetRange: text("budget_range"),
    message: text("message"),
    preferredChannel: text("preferred_channel").notNull().default("any"),
    source: text("source").notNull().default("website_form"),
    sourceDetail: text("source_detail"),
    status: leadStatusEnum("status").notNull().default("new_enquiry"),
    priority: priorityEnum("priority"),
    priorityReason: text("priority_reason"),
    assignedTo: uuid("assigned_to").references(() => profiles.id, { onDelete: "set null" }),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    nextAction: text("next_action"),
    nextActionAt: timestamp("next_action_at", { withTimezone: true }),
    quotationAmountMinor: bigint("quotation_amount_minor", { mode: "number" }),
    depositRecordedAt: timestamp("deposit_recorded_at", { withTimezone: true }),
    depositAmountMinor: bigint("deposit_amount_minor", { mode: "number" }),
    revenueMinor: bigint("revenue_minor", { mode: "number" }),
    lostReason: text("lost_reason"),
    firstContactedAt: timestamp("first_contacted_at", { withTimezone: true }),
    lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
    consentContact: boolean("consent_contact").notNull().default(false),
    consentAt: timestamp("consent_at", { withTimezone: true }),
    optedOut: boolean("opted_out").notNull().default(false),
    optedOutAt: timestamp("opted_out_at", { withTimezone: true }),
    possibleDuplicateOf: uuid("possible_duplicate_of"),
    aiSummary: jsonb("ai_summary"),
    aiSummaryAt: timestamp("ai_summary_at", { withTimezone: true }),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("leads_studio_reference_uq").on(t.studioId, t.reference),
    index("leads_studio_status_idx").on(t.studioId, t.status),
    index("leads_studio_created_idx").on(t.studioId, t.createdAt),
    index("leads_studio_phone_idx").on(t.studioId, t.phone),
    index("leads_studio_event_date_idx").on(t.studioId, t.eventDate),
  ],
);

export const consents = wf.table(
  "consents",
  {
    id: id(),
    studioId: studioId(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("contact"),
    granted: boolean("granted").notNull(),
    text: text("text").notNull(),
    source: text("source").notNull(),
    ipHash: text("ip_hash"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("consents_lead_idx").on(t.leadId)],
);

export const activities = wf.table(
  "activities",
  {
    id: id(),
    studioId: studioId(),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
    actorType: actorTypeEnum("actor_type").notNull(),
    actorId: uuid("actor_id"),
    type: text("type").notNull(),
    summary: text("summary").notNull(),
    data: jsonb("data").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("activities_studio_lead_idx").on(t.studioId, t.leadId, t.createdAt)],
);

export const tasks = wf.table(
  "tasks",
  {
    id: id(),
    studioId: studioId(),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    type: taskTypeEnum("type").notNull().default("follow_up"),
    status: taskStatusEnum("status").notNull().default("open"),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    assignedTo: uuid("assigned_to").references(() => profiles.id, { onDelete: "set null" }),
    createdByType: actorTypeEnum("created_by_type").notNull().default("user"),
    createdBy: uuid("created_by"),
    automationRunId: uuid("automation_run_id"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    dueNotifiedAt: timestamp("due_notified_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("tasks_studio_status_due_idx").on(t.studioId, t.status, t.dueAt), index("tasks_lead_idx").on(t.leadId)],
);

export const calendarEntries = wf.table(
  "calendar_entries",
  {
    id: id(),
    studioId: studioId(),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
    quotationId: uuid("quotation_id"),
    type: calendarEntryTypeEnum("type").notNull(),
    title: text("title").notNull(),
    entryDate: date("entry_date").notNull(),
    startTime: time("start_time"),
    endTime: time("end_time"),
    notes: text("notes"),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("calendar_studio_date_idx").on(t.studioId, t.entryDate)],
);

/** Explicit availability records set by staff. Absence means "not checked". */
export const dateAvailability = wf.table(
  "date_availability",
  {
    id: id(),
    studioId: studioId(),
    date: date("date").notNull(),
    state: text("state").notNull(), // available | unavailable
    note: text("note"),
    setBy: uuid("set_by"),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("date_availability_studio_date_uq").on(t.studioId, t.date)],
);

// ---------------------------------------------------------------- messaging

export const messageTemplates = wf.table(
  "message_templates",
  {
    id: id(),
    studioId: studioId(),
    name: text("name").notNull(),
    channel: channelEnum("channel").notNull(),
    purpose: text("purpose").notNull().default("general"),
    /** Name of the template approved in WhatsApp Manager (WhatsApp only). */
    whatsappTemplateName: text("whatsapp_template_name"),
    language: text("language").notNull().default("en"),
    subject: text("subject"),
    body: text("body").notNull(),
    /** Whether the studio has marked this template approved for automated use. */
    approved: boolean("approved").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("templates_studio_idx").on(t.studioId)],
);

export const messages = wf.table(
  "messages",
  {
    id: id(),
    studioId: studioId(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    channel: channelEnum("channel").notNull(),
    direction: directionEnum("direction").notNull().default("outbound"),
    status: messageStatusEnum("status").notNull().default("draft"),
    templateId: uuid("template_id"),
    whatsappTemplateName: text("whatsapp_template_name"),
    templateParams: jsonb("template_params").$type<string[]>(),
    subject: text("subject"),
    body: text("body").notNull(),
    toAddress: text("to_address"),
    provider: text("provider"),
    providerMessageId: text("provider_message_id"),
    isDemo: boolean("is_demo").notNull().default(false),
    aiGenerated: boolean("ai_generated").notNull().default(false),
    purpose: text("purpose").notNull().default("general"),
    error: text("error"),
    skipReason: text("skip_reason"),
    createdByType: actorTypeEnum("created_by_type").notNull().default("user"),
    createdBy: uuid("created_by"),
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    queuedAt: timestamp("queued_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    contentHash: text("content_hash"),
    automationRunId: uuid("automation_run_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("messages_studio_lead_idx").on(t.studioId, t.leadId, t.createdAt),
    index("messages_studio_status_idx").on(t.studioId, t.status),
    uniqueIndex("messages_provider_id_uq").on(t.provider, t.providerMessageId),
  ],
);

// ---------------------------------------------------------------- quotations

export const quotations = wf.table(
  "quotations",
  {
    id: id(),
    studioId: studioId(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    status: quotationStatusEnum("status").notNull().default("draft"),
    title: text("title").notNull(),
    clientName: text("client_name").notNull(),
    clientEmail: text("client_email"),
    clientPhone: text("client_phone"),
    eventSummary: text("event_summary"),
    eventDate: date("event_date"),
    validUntil: date("valid_until"),
    currency: text("currency").notNull().default("INR"),
    discountType: text("discount_type").notNull().default("none"), // none | percent | fixed
    discountValue: bigint("discount_value", { mode: "number" }).notNull().default(0), // bps or minor units
    taxRateBps: integer("tax_rate_bps").notNull().default(0),
    taxLabel: text("tax_label").notNull().default("Tax"),
    subtotalMinor: bigint("subtotal_minor", { mode: "number" }).notNull().default(0),
    discountMinor: bigint("discount_minor", { mode: "number" }).notNull().default(0),
    taxMinor: bigint("tax_minor", { mode: "number" }).notNull().default(0),
    totalMinor: bigint("total_minor", { mode: "number" }).notNull().default(0),
    depositType: text("deposit_type").notNull().default("percent"), // percent | fixed
    depositValue: bigint("deposit_value", { mode: "number" }).notNull().default(0),
    depositMinor: bigint("deposit_minor", { mode: "number" }).notNull().default(0),
    milestones: jsonb("milestones").$type<{ label: string; amountMinor: number; dueDate?: string | null }[]>().notNull().default([]),
    terms: text("terms"),
    internalNotes: text("internal_notes"),
    aiAssisted: boolean("ai_assisted").notNull().default(false),
    createdBy: uuid("created_by"),
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    awaitingNotifiedAt: timestamp("awaiting_notified_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("quotations_studio_number_uq").on(t.studioId, t.number), index("quotations_lead_idx").on(t.leadId)],
);

export const quotationItems = wf.table(
  "quotation_items",
  {
    id: id(),
    studioId: studioId(),
    quotationId: uuid("quotation_id")
      .notNull()
      .references(() => quotations.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id"),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull().default(1),
    unitPriceMinor: bigint("unit_price_minor", { mode: "number" }).notNull(),
    lineTotalMinor: bigint("line_total_minor", { mode: "number" }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("quotation_items_quotation_idx").on(t.quotationId)],
);

// ---------------------------------------------------------------- automation

export const automationRules = wf.table(
  "automation_rules",
  {
    id: id(),
    studioId: studioId(),
    name: text("name").notNull(),
    description: text("description"),
    trigger: automationTriggerEnum("trigger").notNull(),
    conditions: jsonb("conditions").$type<unknown[]>().notNull().default([]),
    actions: jsonb("actions").$type<unknown[]>().notNull().default([]),
    delayMinutes: integer("delay_minutes").notNull().default(0),
    delayBusinessDays: integer("delay_business_days").notNull().default(0),
    respectBusinessHours: boolean("respect_business_hours").notNull().default(true),
    enabled: boolean("enabled").notNull().default(true),
    dryRun: boolean("dry_run").notNull().default(false),
    maxAttempts: integer("max_attempts").notNull().default(3),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("automation_rules_studio_trigger_idx").on(t.studioId, t.trigger)],
);

export const automationRuns = wf.table(
  "automation_runs",
  {
    id: id(),
    studioId: studioId(),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => automationRules.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
    triggerKey: text("trigger_key").notNull(),
    status: automationRunStatusEnum("status").notNull().default("scheduled"),
    dryRun: boolean("dry_run").notNull().default(false),
    depth: integer("depth").notNull().default(0),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    result: jsonb("result").$type<unknown[]>().notNull().default([]),
    skipReason: text("skip_reason"),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("automation_runs_rule_trigger_uq").on(t.ruleId, t.triggerKey),
    index("automation_runs_studio_created_idx").on(t.studioId, t.createdAt),
  ],
);

/** Durable job queue (transactional outbox). Survives restarts; claimed with SKIP LOCKED. */
export const jobs = wf.table(
  "jobs",
  {
    id: id(),
    studioId: uuid("studio_id").references(() => studios.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    status: jobStatusEnum("status").notNull().default("pending"),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    idempotencyKey: text("idempotency_key").unique(),
    lastError: text("last_error"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("jobs_pending_idx").on(t.status, t.runAt), index("jobs_studio_idx").on(t.studioId, t.createdAt)],
);

// ---------------------------------------------------------------- AI

export const aiInsights = wf.table(
  "ai_insights",
  {
    id: id(),
    studioId: studioId(),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    content: jsonb("content").notNull(),
    model: text("model"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("ai_insights_lead_idx").on(t.studioId, t.leadId, t.kind)],
);

export const aiUsage = wf.table(
  "ai_usage",
  {
    id: id(),
    studioId: uuid("studio_id").references(() => studios.id, { onDelete: "cascade" }),
    userId: uuid("user_id"),
    feature: text("feature").notNull(),
    provider: text("provider").notNull(),
    model: text("model"),
    status: text("status").notNull(), // ok | error | unavailable | rate_limited | invalid_output
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    latencyMs: integer("latency_ms"),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index("ai_usage_studio_created_idx").on(t.studioId, t.createdAt)],
);

// ---------------------------------------------------------------- integrations & platform

export const studioIntegrations = wf.table(
  "studio_integrations",
  {
    id: id(),
    studioId: studioId(),
    provider: text("provider").notNull(), // whatsapp_cloud | google_calendar
    status: text("status").notNull().default("not_configured"), // not_configured | configured | verified | error
    config: jsonb("config").$type<Record<string, string>>().notNull().default({}),
    /** AES-256-GCM encrypted secret (access token). Never sent to the browser. */
    secretEncrypted: text("secret_encrypted"),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    lastError: text("last_error"),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("studio_integrations_uq").on(t.studioId, t.provider)],
);

export const webhookEvents = wf.table(
  "webhook_events",
  {
    id: id(),
    provider: text("provider").notNull(),
    eventKey: text("event_key").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("received"),
    error: text("error"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("webhook_events_provider_key_uq").on(t.provider, t.eventKey)],
);

export const auditLogs = wf.table(
  "audit_logs",
  {
    id: id(),
    studioId: uuid("studio_id").references(() => studios.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id"),
    actorType: actorTypeEnum("actor_type").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    ipHash: text("ip_hash"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("audit_logs_studio_created_idx").on(t.studioId, t.createdAt)],
);

export const notifications = wf.table(
  "notifications",
  {
    id: id(),
    studioId: studioId(),
    userId: uuid("user_id"), // null = all studio staff
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_studio_created_idx").on(t.studioId, t.createdAt)],
);

export const supportNotes = wf.table("support_notes", {
  id: id(),
  studioId: studioId(),
  authorId: uuid("author_id"),
  body: text("body").notNull(),
  createdAt: createdAt(),
});

export const rateLimits = wf.table("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(0),
});
