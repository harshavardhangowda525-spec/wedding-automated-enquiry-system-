"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { parseMoneyToMinor } from "@/lib/money";
import { inStudio } from "@/server/auth/context";
import { ValidationError } from "@/server/lib/errors";
import { clientIpHash } from "@/server/lib/request";
import {
  addNote,
  assignLead,
  bulkUpdateLeads,
  changeLeadStatus,
  createLeadManually,
  deleteLead,
  logContact,
  optInLead,
  optOutLead,
  recordDeposit,
  setTags,
  updateLead,
} from "@/server/services/leads";
import { bool, optStr, runAction, str } from "./_run";

const refresh = (id?: string) => {
  revalidatePath("/leads");
  revalidatePath("/dashboard");
  if (id) revalidatePath(`/leads/${id}`);
};

export async function createLeadAction(_: ActionState, form: FormData): Promise<ActionState> {
  let id = "";
  const result = await runAction(async () => {
    const lead = await inStudio("staff", (svc) =>
      createLeadManually(svc, {
        contactName: str(form, "contactName"),
        partnerName: optStr(form, "partnerName"),
        countryCode: str(form, "countryCode") || "+91",
        phone: str(form, "phone"),
        email: str(form, "email"),
        eventType: str(form, "eventType") as "Wedding",
        eventDate: optStr(form, "eventDate"),
        city: optStr(form, "city"),
        venue: optStr(form, "venue"),
        serviceIds: form.getAll("serviceIds").map(String),
        budgetRange: optStr(form, "budgetRange"),
        message: optStr(form, "message"),
        source: str(form, "source") as "phone",
        sourceDetail: optStr(form, "sourceDetail"),
        preferredChannel: (str(form, "preferredChannel") || "any") as "any",
        consentContact: bool(form, "consentContact"),
      }),
    );
    id = lead.id;
  });
  if (!result.ok) return result;
  refresh();
  redirect(`/leads/${id}`);
}

export async function updateLeadAction(_: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form, "leadId");
  return runAction(async () => {
    const amount = str(form, "quotationAmount");
    const quotationAmountMinor = amount === "" ? null : parseMoneyToMinor(amount);
    if (amount !== "" && quotationAmountMinor === null) throw new ValidationError("Enter a valid amount", { quotationAmount: ["Enter a valid amount"] });
    const nextActionAt = str(form, "nextActionAt");
    await inStudio("staff", (svc) =>
      updateLead(svc, id, {
        contactName: str(form, "contactName"),
        partnerName: optStr(form, "partnerName") ?? null,
        email: str(form, "email"),
        eventType: str(form, "eventType") as "Wedding",
        eventDate: str(form, "eventDate"),
        city: optStr(form, "city") ?? null,
        venue: optStr(form, "venue") ?? null,
        budgetRange: optStr(form, "budgetRange") ?? null,
        source: str(form, "source") as "phone",
        priority: (optStr(form, "priority") ?? null) as "low" | null,
        nextAction: optStr(form, "nextAction") ?? null,
        nextActionAt: nextActionAt ? new Date(nextActionAt) : null,
        quotationAmountMinor,
        serviceIds: form.getAll("serviceIds").map(String),
        preferredChannel: (str(form, "preferredChannel") || "any") as "any",
      }),
    );
    refresh(id);
    return "Lead updated";
  });
}

export async function changeStatusAction(_: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form, "leadId");
  return runAction(async () => {
    await inStudio("staff", (svc) => changeLeadStatus(svc, id, { status: str(form, "status") as "contacted", lostReason: optStr(form, "lostReason"), note: optStr(form, "note") }));
    refresh(id);
    return "Status updated";
  });
}

export async function assignLeadAction(_: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form, "leadId");
  return runAction(async () => {
    await inStudio("staff", (svc) => assignLead(svc, id, optStr(form, "userId") ?? null));
    refresh(id);
    return "Assignment saved";
  });
}

export async function addNoteAction(_: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form, "leadId");
  return runAction(async () => {
    await inStudio("staff", (svc) => addNote(svc, id, str(form, "body")));
    refresh(id);
    return "Note added";
  });
}

export async function setTagsAction(_: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form, "leadId");
  return runAction(async () => {
    await inStudio("staff", (svc) => setTags(svc, id, str(form, "tags").split(",")));
    refresh(id);
    return "Tags saved";
  });
}

export async function logContactAction(_: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form, "leadId");
  return runAction(async () => {
    await inStudio("staff", (svc) =>
      logContact(svc, id, { channel: str(form, "channel") as "phone", outcome: str(form, "outcome") as "reached", summary: optStr(form, "summary") }),
    );
    refresh(id);
    return "Contact logged";
  });
}

export async function recordDepositAction(_: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form, "leadId");
  return runAction(async () => {
    const minor = parseMoneyToMinor(str(form, "amount"));
    if (!minor) throw new ValidationError("Enter the deposit amount", { amount: ["Enter the deposit amount"] });
    await inStudio("staff", (svc) => recordDeposit(svc, id, minor));
    refresh(id);
    return "Deposit recorded";
  });
}

export async function optOutAction(_: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form, "leadId");
  return runAction(async () => {
    await inStudio("staff", (svc) => optOutLead(svc, id, `staff_recorded:${str(form, "source") || "request"}`));
    refresh(id);
    return "Opt-out recorded. Pending messages were cancelled.";
  });
}

export async function optInAction(_: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form, "leadId");
  return runAction(async () => {
    await inStudio("staff", (svc) => optInLead(svc, id, str(form, "note")));
    refresh(id);
    return "Consent re-recorded";
  });
}

export async function bulkLeadsAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ids = form.getAll("leadIds").map(String);
    if (ids.length === 0) throw new ValidationError("Select at least one lead");
    const kind = str(form, "bulkAction");
    const action =
      kind === "status"
        ? { action: "status" as const, status: str(form, "status") as "contacted", lostReason: optStr(form, "lostReason") }
        : kind === "assign"
          ? { action: "assign" as const, userId: optStr(form, "userId") ?? null }
          : { action: "add_tag" as const, tag: str(form, "tag") };
    const result = await inStudio("staff", (svc) => bulkUpdateLeads(svc, ids, action));
    refresh();
    const skipped = result.skipped.length ? ` ${result.skipped.length} skipped: ${[...new Set(result.skipped.map((s) => s.reason))].slice(0, 2).join(" ")}` : "";
    return `${result.updated} lead(s) updated.${skipped}`;
  });
}

export async function deleteLeadAction(_: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form, "leadId");
  const result = await runAction(async () => {
    if (str(form, "confirm").trim().toUpperCase() !== "DELETE") throw new ValidationError("Type DELETE to confirm");
    const ipHash = await clientIpHash();
    await inStudio("admin", (svc) => deleteLead(svc, id, { ipHash }));
  });
  if (!result.ok) return result;
  refresh();
  redirect("/leads");
}
