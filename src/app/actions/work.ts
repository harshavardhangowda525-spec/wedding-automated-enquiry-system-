"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { zonedInstant } from "@/lib/time";
import { inStudio } from "@/server/auth/context";
import { ValidationError } from "@/server/lib/errors";
import { createCalendarEntry, deleteCalendarEntry, setDateAvailability } from "@/server/services/calendar";
import { createTask, setTaskStatus, updateTask } from "@/server/services/tasks";
import { approveMessage, cancelMessage, createDraft, createDraftFromTemplate, updateDraft } from "@/server/messaging/service";
import { markNotificationsRead } from "@/server/services/settings";
import { optStr, runAction, str } from "./_run";

function refreshLead(leadId?: string) {
  revalidatePath("/dashboard");
  revalidatePath("/tasks");
  revalidatePath("/calendar");
  revalidatePath("/messages");
  if (leadId) revalidatePath(`/leads/${leadId}`);
}

/** Interprets a date + time from a form in the studio's time zone. */
function dueFromForm(form: FormData, tz: string): Date {
  const date = str(form, "dueDate");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ValidationError("Choose a due date", { dueDate: ["Choose a due date"] });
  const time = str(form, "dueTime") || "10:00";
  return zonedInstant(date, time, tz);
}

export async function createTaskAction(_: ActionState, form: FormData): Promise<ActionState> {
  const leadId = optStr(form, "leadId");
  return runAction(async () => {
    await inStudio("staff", (svc, ctx) =>
      createTask(svc, {
        title: str(form, "title"),
        description: optStr(form, "description"),
        type: (str(form, "type") || "follow_up") as "follow_up",
        dueAt: dueFromForm(form, ctx.studio.timezone),
        leadId,
        assignedTo: optStr(form, "assignedTo"),
      }),
    );
    refreshLead(leadId);
    return "Task scheduled";
  });
}

export async function rescheduleTaskAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const task = await inStudio("staff", (svc, ctx) => updateTask(svc, str(form, "taskId"), { dueAt: dueFromForm(form, ctx.studio.timezone) }));
    refreshLead(task.leadId ?? undefined);
    return "Task rescheduled";
  });
}

export async function setTaskStatusAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const task = await inStudio("staff", (svc) => setTaskStatus(svc, str(form, "taskId"), str(form, "status") as "done"));
    refreshLead(task.leadId ?? undefined);
    return str(form, "status") === "done" ? "Task completed" : "Task updated";
  });
}

export async function createCalendarEntryAction(_: ActionState, form: FormData): Promise<ActionState> {
  const leadId = optStr(form, "leadId");
  return runAction(async () => {
    const { warning } = await inStudio("staff", (svc) =>
      createCalendarEntry(svc, {
        type: str(form, "type") as "consultation",
        title: str(form, "title"),
        entryDate: str(form, "entryDate"),
        startTime: str(form, "startTime"),
        endTime: str(form, "endTime"),
        leadId,
        notes: optStr(form, "notes"),
      }),
    );
    refreshLead(leadId);
    return warning ? `Saved. ${warning}` : "Added to the calendar";
  });
}

export async function deleteCalendarEntryAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await inStudio("staff", (svc) => deleteCalendarEntry(svc, str(form, "entryId")));
    refreshLead(optStr(form, "leadId"));
    return "Removed";
  });
}

export async function setAvailabilityAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await inStudio("staff", (svc) => setDateAvailability(svc, str(form, "date"), str(form, "state") as "available", optStr(form, "note")));
    refreshLead(optStr(form, "leadId"));
    return "Availability recorded";
  });
}

export async function createDraftAction(_: ActionState, form: FormData): Promise<ActionState> {
  const leadId = str(form, "leadId");
  return runAction(async () => {
    const templateId = optStr(form, "templateId");
    await inStudio("staff", (svc) =>
      templateId
        ? createDraftFromTemplate(svc, leadId, templateId)
        : createDraft(svc, { leadId, channel: str(form, "channel") as "whatsapp", subject: optStr(form, "subject"), body: str(form, "body") }),
    );
    refreshLead(leadId);
    return "Draft saved for approval";
  });
}

export async function updateDraftAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const msg = await inStudio("staff", (svc) => updateDraft(svc, str(form, "messageId"), { subject: optStr(form, "subject"), body: str(form, "body") }));
    refreshLead(msg.leadId);
    return "Draft updated";
  });
}

export async function approveMessageAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await inStudio("staff", (svc) => approveMessage(svc, str(form, "messageId")));
    refreshLead(optStr(form, "leadId"));
    return "Approved and queued. Delivery status will update automatically.";
  });
}

export async function cancelMessageAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await inStudio("staff", (svc) => cancelMessage(svc, str(form, "messageId")));
    refreshLead(optStr(form, "leadId"));
    return "Message cancelled";
  });
}

export async function markNotificationsReadAction() {
  await inStudio("viewer", (svc) => markNotificationsRead(svc));
  revalidatePath("/", "layout");
}
