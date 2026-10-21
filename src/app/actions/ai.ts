"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { inStudio } from "@/server/auth/context";
import {
  applyPrioritySuggestion,
  draftQuotation,
  draftReply,
  suggestNextAction,
  suggestPriority,
  summarizeConversation,
  summarizeEnquiry,
} from "@/server/ai/service";
import { optStr, runAction, str } from "./_run";

export async function aiLeadAction(_: ActionState, form: FormData): Promise<ActionState> {
  const leadId = str(form, "leadId");
  const kind = str(form, "kind");
  return runAction(async () => {
    await inStudio("staff", async (svc) => {
      if (kind === "summary") await summarizeEnquiry(svc, leadId);
      else if (kind === "priority") await suggestPriority(svc, leadId);
      else if (kind === "conversation") await summarizeConversation(svc, leadId);
      else if (kind === "next_action") await suggestNextAction(svc, leadId);
      else throw new Error("Unknown AI request");
    });
    revalidatePath(`/leads/${leadId}`);
    return "Done – review the result below.";
  });
}

export async function aiDraftReplyAction(_: ActionState, form: FormData): Promise<ActionState> {
  const leadId = str(form, "leadId");
  return runAction(async () => {
    await inStudio("staff", (svc) =>
      draftReply(svc, leadId, {
        purpose: (str(form, "purpose") || "follow_up") as "follow_up",
        channel: (str(form, "channel") || "whatsapp") as "whatsapp",
        instructions: optStr(form, "instructions"),
      }),
    );
    revalidatePath(`/leads/${leadId}`);
    revalidatePath("/messages");
    return "AI draft created. Review and approve it before anything is sent.";
  });
}

export async function applyPriorityAction(_: ActionState, form: FormData): Promise<ActionState> {
  const leadId = str(form, "leadId");
  return runAction(async () => {
    await inStudio("staff", (svc) => applyPrioritySuggestion(svc, leadId, str(form, "insightId")));
    revalidatePath(`/leads/${leadId}`);
    return "Priority applied";
  });
}

export async function aiDraftQuotationAction(_: ActionState, form: FormData): Promise<ActionState> {
  const leadId = str(form, "leadId");
  let id = "";
  const result = await runAction(async () => {
    const q = await inStudio("staff", (svc) => draftQuotation(svc, leadId));
    id = q.id;
  });
  if (!result.ok) return result;
  revalidatePath(`/leads/${leadId}`);
  redirect(`/quotations/${id}`);
}
