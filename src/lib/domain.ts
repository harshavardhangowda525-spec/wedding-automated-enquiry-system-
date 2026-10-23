// Client-safe domain constants shared by the UI and the server.

export const LEAD_STATUSES = [
  "new_enquiry",
  "contact_attempted",
  "contacted",
  "qualified",
  "consultation_scheduled",
  "quotation_sent",
  "negotiation",
  "tentative_hold",
  "booking_confirmed",
  "won",
  "lost",
  "not_interested",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new_enquiry: "New Enquiry",
  contact_attempted: "Contact Attempted",
  contacted: "Contacted",
  qualified: "Qualified",
  consultation_scheduled: "Consultation Scheduled",
  quotation_sent: "Quotation Sent",
  negotiation: "Negotiation",
  tentative_hold: "Tentative Hold",
  booking_confirmed: "Booking Confirmed",
  won: "Won",
  lost: "Lost",
  not_interested: "Not Interested",
};

/** Statuses after which follow-ups should stop. */
export const CLOSED_STATUSES: LeadStatus[] = ["booking_confirmed", "won", "lost", "not_interested"];
export const ACTIVE_STATUSES: LeadStatus[] = LEAD_STATUSES.filter((s) => !CLOSED_STATUSES.includes(s));

const OPEN_PIPELINE: LeadStatus[] = [
  "new_enquiry",
  "contact_attempted",
  "contacted",
  "qualified",
  "consultation_scheduled",
  "quotation_sent",
  "negotiation",
  "tentative_hold",
];

/**
 * Allowed status transitions. Open pipeline stages can move freely between each
 * other (studios rarely follow a strict order), but a booking can only be confirmed
 * from a qualified stage, "won" only follows a confirmed booking, and closed leads
 * can only be reopened back into the pipeline.
 */
export const LEAD_TRANSITIONS: Record<LeadStatus, LeadStatus[]> = {
  new_enquiry: [...OPEN_PIPELINE, "lost", "not_interested"],
  contact_attempted: [...OPEN_PIPELINE, "lost", "not_interested"],
  contacted: [...OPEN_PIPELINE, "lost", "not_interested"],
  qualified: [...OPEN_PIPELINE, "lost", "not_interested"],
  consultation_scheduled: [...OPEN_PIPELINE, "lost", "not_interested"],
  quotation_sent: [...OPEN_PIPELINE, "booking_confirmed", "lost", "not_interested"],
  negotiation: [...OPEN_PIPELINE, "booking_confirmed", "lost", "not_interested"],
  tentative_hold: [...OPEN_PIPELINE, "booking_confirmed", "lost", "not_interested"],
  booking_confirmed: ["won", "lost"],
  won: [],
  lost: ["new_enquiry", "contacted", "qualified"],
  not_interested: ["new_enquiry", "contacted", "qualified"],
};

export function canTransition(from: LeadStatus, to: LeadStatus): boolean {
  if (from === to) return false;
  return LEAD_TRANSITIONS[from].includes(to);
}

export const LEAD_SOURCES = [
  "website_form",
  "website_chat",
  "instagram",
  "whatsapp",
  "phone",
  "referral",
  "walk_in",
  "wedding_fair",
  "other",
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];
export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  website_form: "Website form",
  website_chat: "Website chat",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  phone: "Phone call",
  referral: "Referral",
  walk_in: "Walk-in",
  wedding_fair: "Wedding fair",
  other: "Other",
};

export const EVENT_TYPES = [
  "Wedding",
  "Engagement",
  "Pre-wedding shoot",
  "Reception",
  "Haldi / Mehendi / Sangeet",
  "Destination wedding",
  "Other",
] as const;

export const PRIORITIES = ["low", "medium", "high"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const CHANNELS = ["whatsapp", "email"] as const;
export type Channel = (typeof CHANNELS)[number];

export const PREFERRED_CHANNELS = ["whatsapp", "email", "phone", "any"] as const;

export const MESSAGE_STATUSES = [
  "draft",
  "awaiting_approval",
  "queued",
  "sending",
  "sent",
  "delivered",
  "failed",
  "cancelled",
  "skipped",
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];
export const MESSAGE_STATUS_LABELS: Record<MessageStatus, string> = {
  draft: "Draft",
  awaiting_approval: "Awaiting approval",
  queued: "Queued",
  sending: "Sending",
  sent: "Sent",
  delivered: "Delivered",
  failed: "Failed",
  cancelled: "Cancelled",
  skipped: "Skipped",
};

export const QUOTATION_STATUSES = ["draft", "approved", "sent", "accepted", "rejected", "expired"] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];
export const QUOTATION_TRANSITIONS: Record<QuotationStatus, QuotationStatus[]> = {
  draft: ["approved"],
  approved: ["draft", "sent"],
  sent: ["accepted", "rejected", "expired"],
  accepted: [],
  rejected: ["draft"],
  expired: ["draft"],
};

export const TASK_TYPES = ["follow_up", "call", "consultation", "review", "general"] as const;
export type TaskType = (typeof TASK_TYPES)[number];
export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  follow_up: "Follow-up",
  call: "Call",
  consultation: "Consultation",
  review: "Review",
  general: "General",
};

export const CALENDAR_ENTRY_TYPES = [
  "wedding_event",
  "consultation",
  "quotation_expiry",
  "tentative_hold",
  "confirmed_booking",
  "blocked",
] as const;
export type CalendarEntryType = (typeof CALENDAR_ENTRY_TYPES)[number];
export const CALENDAR_ENTRY_LABELS: Record<CalendarEntryType, string> = {
  wedding_event: "Wedding event",
  consultation: "Consultation",
  quotation_expiry: "Quotation expiry",
  tentative_hold: "Tentative hold",
  confirmed_booking: "Confirmed booking",
  blocked: "Blocked / unavailable",
};

export const AVAILABILITY_STATES = [
  "not_checked",
  "available",
  "tentative_hold",
  "unavailable",
  "confirmed_booking",
] as const;
export type AvailabilityState = (typeof AVAILABILITY_STATES)[number];
export const AVAILABILITY_LABELS: Record<AvailabilityState, string> = {
  not_checked: "Not checked",
  available: "Available",
  tentative_hold: "Tentative hold",
  unavailable: "Unavailable",
  confirmed_booking: "Confirmed booking",
};

export const MEMBER_ROLES = ["owner", "admin", "staff", "viewer"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];
const ROLE_RANK: Record<MemberRole, number> = { viewer: 0, staff: 1, admin: 2, owner: 3 };
export function roleAtLeast(role: MemberRole, min: MemberRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export const SERVICE_CATEGORIES = [
  "photography",
  "cinematography",
  "pre_wedding",
  "drone",
  "album",
  "other",
] as const;
export const SERVICE_UNITS = ["per_event", "per_day", "per_hour", "fixed", "per_item"] as const;
export const SERVICE_UNIT_LABELS: Record<(typeof SERVICE_UNITS)[number], string> = {
  per_event: "per event",
  per_day: "per day",
  per_hour: "per hour",
  fixed: "fixed",
  per_item: "per item",
};

export const AUTOMATION_TRIGGERS = [
  "lead_created",
  "lead_status_changed",
  "follow_up_due",
  "consultation_approaching",
  "quotation_created",
  "quotation_awaiting_response",
  "event_date_approaching",
  "lead_inactive",
  "booking_confirmed",
  "client_opted_out",
] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];
export const AUTOMATION_TRIGGER_LABELS: Record<AutomationTrigger, string> = {
  lead_created: "New enquiry",
  lead_status_changed: "Lead status changed",
  follow_up_due: "Follow-up due",
  consultation_approaching: "Consultation approaching",
  quotation_created: "Quotation created",
  quotation_awaiting_response: "Quotation awaiting response",
  event_date_approaching: "Event date approaching",
  lead_inactive: "Lead inactive",
  booking_confirmed: "Booking confirmed",
  client_opted_out: "Client opts out",
};

export const AUTOMATION_ACTIONS = [
  "create_task",
  "assign_lead",
  "notify_staff",
  "queue_email",
  "queue_whatsapp_template",
  "create_ai_reply_draft",
  "add_tag",
  "record_activity",
  "update_field",
] as const;
export type AutomationActionType = (typeof AUTOMATION_ACTIONS)[number];
export const AUTOMATION_ACTION_LABELS: Record<AutomationActionType, string> = {
  create_task: "Create a task",
  assign_lead: "Assign the lead",
  notify_staff: "Notify staff",
  queue_email: "Queue an approved email",
  queue_whatsapp_template: "Queue an approved WhatsApp template",
  create_ai_reply_draft: "Create an AI reply draft",
  add_tag: "Add a tag",
  record_activity: "Record an activity",
  update_field: "Update a permitted field",
};

export const DEMO_LABEL = "Demo — not sent";
