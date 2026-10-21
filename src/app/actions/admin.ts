"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { requirePlatformAdmin } from "@/server/auth/context";
import { adminAddSupportNote, adminRetryJob, adminSetStudioStatus } from "@/server/services/admin";
import { runAction, str } from "./_run";

export async function retryJobAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePlatformAdmin();
    await adminRetryJob(user, str(form, "jobId"));
    revalidatePath("/admin/failures");
    return "Job re-queued";
  });
}

export async function addSupportNoteAction(_: ActionState, form: FormData): Promise<ActionState> {
  const studioId = str(form, "studioId");
  return runAction(async () => {
    const user = await requirePlatformAdmin();
    await adminAddSupportNote(user, studioId, str(form, "body"));
    revalidatePath(`/admin/studios/${studioId}`);
    return "Note added";
  });
}

export async function setStudioStatusAction(_: ActionState, form: FormData): Promise<ActionState> {
  const studioId = str(form, "studioId");
  return runAction(async () => {
    const user = await requirePlatformAdmin();
    await adminSetStudioStatus(user, studioId, str(form, "status") as "active");
    revalidatePath(`/admin/studios/${studioId}`);
    revalidatePath("/admin");
    return "Studio status updated";
  });
}
