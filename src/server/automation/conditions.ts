import type { Condition } from "@/lib/automation-schema";
import { dateInTz } from "@/lib/time";

type LeadLike = {
  status: string;
  priority: string | null;
  source: string;
  eventType: string;
  city: string | null;
  preferredChannel: string;
  budgetRange: string | null;
  assignedTo: string | null;
  tags: string[];
  lastContactedAt: Date | null;
  lastInboundAt: Date | null;
  optedOut: boolean;
  consentContact: boolean;
  eventDate: string | null;
};

function fieldValue(lead: LeadLike, field: Condition["field"], now: Date, tz: string): unknown {
  switch (field) {
    case "status":
      return lead.status;
    case "priority":
      return lead.priority;
    case "source":
      return lead.source;
    case "event_type":
      return lead.eventType;
    case "city":
      return lead.city;
    case "preferred_channel":
      return lead.preferredChannel;
    case "budget_range":
      return lead.budgetRange;
    case "assigned_to":
      return lead.assignedTo;
    case "tags":
      return lead.tags;
    case "last_contacted_at":
      return lead.lastContactedAt;
    case "last_inbound_at":
      return lead.lastInboundAt;
    case "opted_out":
      return lead.optedOut;
    case "consent_contact":
      return lead.consentContact;
    case "has_event_date":
      return Boolean(lead.eventDate);
    case "days_until_event": {
      if (!lead.eventDate) return null;
      const today = dateInTz(now, tz);
      return Math.round((Date.parse(`${lead.eventDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
    }
  }
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

export function evaluateCondition(c: Condition, lead: LeadLike, now: Date, tz: string): boolean {
  const v = fieldValue(lead, c.field, now, tz);
  const target = c.value;
  switch (c.op) {
    case "eq":
      return String(v ?? "") === String(target ?? "");
    case "neq":
      return String(v ?? "") !== String(target ?? "");
    case "in":
      return Array.isArray(target) && target.includes(String(v ?? ""));
    case "not_in":
      return Array.isArray(target) && !target.includes(String(v ?? ""));
    case "contains":
      return Array.isArray(v) ? v.includes(String(target)) : String(v ?? "").toLowerCase().includes(String(target ?? "").toLowerCase());
    case "is_empty":
      return isEmpty(v);
    case "is_not_empty":
      return !isEmpty(v);
    case "is_true":
      return v === true;
    case "is_false":
      return v === false;
    case "gte":
      return typeof v === "number" && v >= Number(target);
    case "lte":
      return typeof v === "number" && v <= Number(target);
  }
}

export function describeCondition(c: Condition): string {
  const value = Array.isArray(c.value) ? c.value.join(", ") : c.value;
  const op = {
    eq: "is",
    neq: "is not",
    in: "is one of",
    not_in: "is not one of",
    contains: "contains",
    is_empty: "is empty",
    is_not_empty: "is set",
    is_true: "is true",
    is_false: "is false",
    gte: "≥",
    lte: "≤",
  }[c.op];
  return `${c.field.replace(/_/g, " ")} ${op}${value !== undefined && !["is_empty", "is_not_empty", "is_true", "is_false"].includes(c.op) ? ` ${value}` : ""}`;
}

/** Returns the first failing condition (description) or null when all pass. */
export function firstFailingCondition(conditions: Condition[], lead: LeadLike, now: Date, tz: string): string | null {
  for (const c of conditions) if (!evaluateCondition(c, lead, now, tz)) return describeCondition(c);
  return null;
}
