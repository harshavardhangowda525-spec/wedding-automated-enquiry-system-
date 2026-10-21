"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { inStudio } from "@/server/auth/context";
import { createQuotation, setQuotationStatus, updateQuotation, type QuotationInput } from "@/server/services/quotations";
import { runAction, str } from "./_run";

/** The builder posts its full state as JSON in a hidden "payload" field. */
function parsePayload(form: FormData): QuotationInput {
  try {
    return JSON.parse(str(form, "payload")) as QuotationInput;
  } catch {
    throw new z.ZodError([{ code: "custom", path: ["form"], message: "Could not read the quotation", input: null }]);
  }
}

export async function saveQuotationAction(_: ActionState, form: FormData): Promise<ActionState> {
  const quotationId = str(form, "quotationId");
  const leadId = str(form, "leadId");
  let createdId = "";
  const result = await runAction(async () => {
    const payload = parsePayload(form);
    if (quotationId) {
      await inStudio("staff", (svc) => updateQuotation(svc, quotationId, payload));
      return "Quotation saved";
    }
    const q = await inStudio("staff", (svc) => createQuotation(svc, leadId, payload));
    createdId = q.id;
  });
  if (!result.ok || quotationId) {
    if (quotationId) revalidatePath(`/quotations/${quotationId}`);
    return result;
  }
  revalidatePath(`/leads/${leadId}`);
  redirect(`/quotations/${createdId}`);
}

export async function quotationStatusAction(_: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form, "quotationId");
  return runAction(async () => {
    await inStudio("staff", (svc) => setQuotationStatus(svc, id, str(form, "status") as "approved"));
    revalidatePath(`/quotations/${id}`);
    revalidatePath("/quotations");
    revalidatePath(`/leads/${str(form, "leadId")}`);
    return "Quotation updated";
  });
}
