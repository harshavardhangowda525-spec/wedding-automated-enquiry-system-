import "server-only";
import { and, asc, eq, gte, inArray, lt, lte, type SQL } from "drizzle-orm";
import { z } from "zod";
import { TASK_TYPES, roleAtLeast } from "@/lib/domain";
import type { ServiceContext } from "@/server/auth/context";
import { leads, profiles, studioMembers, tasks } from "@/server/db/schema";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/lib/errors";
import { recordActivity } from "./activity";

export type Task = typeof tasks.$inferSelect;

function requireWriter(svc: ServiceContext) {
  if (svc.role !== "system" && !roleAtLeast(svc.role, "staff")) throw new ForbiddenError();
}

export const taskInputSchema = z.object({
  title: z.string().trim().min(2, "Give the task a title").max(200),
  description: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => (v ? v : undefined)),
  type: z.enum(TASK_TYPES).default("follow_up"),
  dueAt: z.coerce.date({ message: "Choose a due date" }),
  leadId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  assignedTo: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
});

export async function createTask(svc: ServiceContext, input: z.input<typeof taskInputSchema>, extra: { automationRunId?: string } = {}) {
  requireWriter(svc);
  const data = taskInputSchema.parse(input);
  if (data.leadId) {
    const [lead] = await svc.tx.select({ id: leads.id }).from(leads).where(and(eq(leads.id, data.leadId), eq(leads.studioId, svc.studioId)));
    if (!lead) throw new NotFoundError("Lead");
  }
  if (data.assignedTo) {
    const [member] = await svc.tx
      .select({ id: studioMembers.id })
      .from(studioMembers)
      .where(and(eq(studioMembers.studioId, svc.studioId), eq(studioMembers.userId, data.assignedTo)));
    if (!member) throw new ValidationError("Assignee is not a member of this studio");
  }
  const [task] = await svc.tx
    .insert(tasks)
    .values({
      studioId: svc.studioId,
      leadId: data.leadId ?? null,
      title: data.title,
      description: data.description ?? null,
      type: data.type,
      dueAt: data.dueAt,
      assignedTo: data.assignedTo ?? null,
      createdByType: svc.actorType,
      createdBy: svc.userId,
      automationRunId: extra.automationRunId ?? null,
    })
    .returning();
  if (data.leadId) {
    await recordActivity(svc, { leadId: data.leadId, type: "task_created", summary: `Task created: ${data.title}`, data: { taskId: task.id, dueAt: data.dueAt } });
  }
  return task;
}

async function getTask(svc: ServiceContext, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Task");
  const [task] = await svc.tx.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.studioId, svc.studioId)));
  if (!task) throw new NotFoundError("Task");
  return task;
}

export async function updateTask(svc: ServiceContext, id: string, input: Partial<z.input<typeof taskInputSchema>>) {
  requireWriter(svc);
  const task = await getTask(svc, id);
  const data = taskInputSchema.partial().parse(input);
  const [updated] = await svc.tx
    .update(tasks)
    .set({
      ...(data.title !== undefined && { title: data.title }),
      ...(data.description !== undefined && { description: data.description ?? null }),
      ...(data.type !== undefined && { type: data.type }),
      ...(data.dueAt !== undefined && { dueAt: data.dueAt, dueNotifiedAt: null }),
      ...(data.assignedTo !== undefined && { assignedTo: data.assignedTo ?? null }),
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, id))
    .returning();
  if (task.leadId && data.dueAt && data.dueAt.getTime() !== task.dueAt.getTime()) {
    await recordActivity(svc, { leadId: task.leadId, type: "task_rescheduled", summary: `Task rescheduled: ${task.title}`, data: { taskId: id, from: task.dueAt, to: data.dueAt } });
  }
  return updated;
}

export async function setTaskStatus(svc: ServiceContext, id: string, status: "open" | "done" | "cancelled") {
  requireWriter(svc);
  const task = await getTask(svc, id);
  if (task.status === status) return task;
  const [updated] = await svc.tx
    .update(tasks)
    .set({ status, completedAt: status === "done" ? new Date() : null, updatedAt: new Date() })
    .where(eq(tasks.id, id))
    .returning();
  if (task.leadId) {
    const verb = status === "done" ? "completed" : status === "cancelled" ? "cancelled" : "reopened";
    await recordActivity(svc, { leadId: task.leadId, type: `task_${verb}`, summary: `Task ${verb}: ${task.title}`, data: { taskId: id } });
  }
  return updated;
}

export const taskFiltersSchema = z.object({
  scope: z.enum(["overdue", "today", "upcoming", "open", "done", "all"]).default("open"),
  assignedTo: z.union([z.string().uuid(), z.literal("me")]).optional(),
  leadId: z.string().uuid().optional(),
});

export async function listTasks(svc: ServiceContext, input: Partial<z.input<typeof taskFiltersSchema>>, now = new Date(), dayEnd?: Date) {
  const f = taskFiltersSchema.parse(input);
  const parts: SQL[] = [eq(tasks.studioId, svc.studioId)];
  const endOfDay = dayEnd ?? new Date(now.getTime() + 24 * 3600 * 1000);
  if (f.scope === "overdue") parts.push(eq(tasks.status, "open"), lt(tasks.dueAt, now));
  else if (f.scope === "today") parts.push(eq(tasks.status, "open"), gte(tasks.dueAt, now), lte(tasks.dueAt, endOfDay));
  else if (f.scope === "upcoming") parts.push(eq(tasks.status, "open"), gte(tasks.dueAt, endOfDay));
  else if (f.scope === "open") parts.push(eq(tasks.status, "open"));
  else if (f.scope === "done") parts.push(inArray(tasks.status, ["done", "cancelled"]));
  if (f.assignedTo === "me" && svc.userId) parts.push(eq(tasks.assignedTo, svc.userId));
  else if (f.assignedTo && f.assignedTo !== "me") parts.push(eq(tasks.assignedTo, f.assignedTo));
  if (f.leadId) parts.push(eq(tasks.leadId, f.leadId));
  return svc.tx
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      type: tasks.type,
      status: tasks.status,
      dueAt: tasks.dueAt,
      leadId: tasks.leadId,
      leadName: leads.contactName,
      leadReference: leads.reference,
      assignedTo: tasks.assignedTo,
      assigneeName: profiles.fullName,
      createdByType: tasks.createdByType,
      completedAt: tasks.completedAt,
    })
    .from(tasks)
    .leftJoin(leads, eq(leads.id, tasks.leadId))
    .leftJoin(profiles, eq(profiles.id, tasks.assignedTo))
    .where(and(...parts))
    .orderBy(asc(tasks.dueAt))
    .limit(300);
}

export type TaskRow = Awaited<ReturnType<typeof listTasks>>[number];
