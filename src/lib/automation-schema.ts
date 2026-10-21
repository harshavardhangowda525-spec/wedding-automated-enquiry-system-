import { z } from "zod";
import { TASK_TYPES } from "./domain";

export const CONDITION_FIELDS = [
  "status",
  "priority",
  "source",
  "event_type",
  "city",
  "preferred_channel",
  "budget_range",
  "assigned_to",
  "tags",
  "last_contacted_at",
  "last_inbound_at",
  "opted_out",
  "consent_contact",
  "has_event_date",
  "days_until_event",
] as const;
export type ConditionField = (typeof CONDITION_FIELDS)[number];

export const CONDITION_OPS = ["eq", "neq", "in", "not_in", "contains", "is_empty", "is_not_empty", "is_true", "is_false", "gte", "lte"] as const;

export const conditionSchema = z.object({
  field: z.enum(CONDITION_FIELDS),
  op: z.enum(CONDITION_OPS),
  value: z.union([z.string(), z.number(), z.array(z.string())]).optional(),
});
export type Condition = z.infer<typeof conditionSchema>;

export const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_task"),
    title: z.string().min(1).max(200),
    description: z.string().max(1000).optional(),
    taskType: z.enum(TASK_TYPES).default("follow_up"),
    dueInHours: z.number().int().min(0).max(24 * 60).default(0),
  }),
  z.object({
    type: z.literal("assign_lead"),
    strategy: z.enum(["specific", "round_robin"]).default("round_robin"),
    userId: z.string().uuid().optional(),
  }),
  z.object({
    type: z.literal("notify_staff"),
    title: z.string().min(1).max(200),
    body: z.string().max(1000).optional(),
  }),
  z.object({
    type: z.literal("queue_email"),
    templateId: z.string().uuid(),
    requireApproval: z.boolean().default(true),
  }),
  z.object({
    type: z.literal("queue_whatsapp_template"),
    templateId: z.string().uuid(),
    requireApproval: z.boolean().default(true),
  }),
  z.object({
    type: z.literal("create_ai_reply_draft"),
    purpose: z.enum(["acknowledgement", "follow_up"]).default("follow_up"),
    channel: z.enum(["auto", "whatsapp", "email"]).default("auto"),
  }),
  z.object({ type: z.literal("add_tag"), tag: z.string().min(1).max(40) }),
  z.object({ type: z.literal("record_activity"), summary: z.string().min(1).max(300) }),
  z.object({
    type: z.literal("update_field"),
    field: z.enum(["priority", "next_action"]),
    value: z.string().max(300),
  }),
]);
export type AutomationAction = z.infer<typeof actionSchema>;

export const conditionsSchema = z.array(conditionSchema).max(10);
export const actionsSchema = z.array(actionSchema).min(1).max(10);
