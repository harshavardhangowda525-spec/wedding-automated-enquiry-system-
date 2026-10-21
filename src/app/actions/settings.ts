"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { parseMoneyToMinor } from "@/lib/money";
import { formFieldKeys } from "@/lib/studio-settings";
import { inStudio } from "@/server/auth/context";
import { studioIntegrations } from "@/server/db/schema";
import { decryptSecret } from "@/server/lib/crypto";
import { ValidationError } from "@/server/lib/errors";
import {
  changeMemberRole,
  deleteRule,
  deleteService,
  disconnectIntegration,
  inviteMember,
  recordIntegrationCheck,
  removeMember,
  revokeInvite,
  saveRule,
  saveService,
  saveTemplate,
  saveWhatsAppIntegration,
  setAiEnabled,
  setAutomationPaused,
  setRetention,
  toggleRule,
  updateProfile,
  updateSettingsSection,
  verifyWhatsAppCredentials,
} from "@/server/services/settings";
import { bool, optStr, runAction, str } from "./_run";

const refresh = () => revalidatePath("/", "layout");

export async function updateProfileAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await inStudio("admin", (svc) =>
      updateProfile(svc, {
        name: str(form, "name"),
        businessType: str(form, "businessType") as "photo_video",
        email: str(form, "email"),
        phone: str(form, "phone"),
        city: str(form, "city"),
        website: str(form, "website"),
        logoUrl: str(form, "logoUrl"),
        brandColor: str(form, "brandColor"),
        welcomeMessage: str(form, "welcomeMessage"),
        privacyNotice: str(form, "privacyNotice"),
        currency: str(form, "currency") as "INR",
        timezone: str(form, "timezone"),
      }),
    );
    refresh();
    return "Studio profile saved";
  });
}

export async function updateEnquiryFormAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await inStudio("admin", (svc) =>
      updateSettingsSection(svc, "enquiryForm", {
        enabledFields: formFieldKeys.filter((k) => bool(form, `field_${k}`)),
        budgetRanges: str(form, "budgetRanges")
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        consentText: str(form, "consentText"),
      }),
    );
    refresh();
    return "Enquiry form saved";
  });
}

export async function updatePolicyAction(_: ActionState, form: FormData): Promise<ActionState> {
  const num = (k: string) => Number(str(form, k));
  return runAction(async () => {
    await inStudio("admin", async (svc) => {
      await updateSettingsSection(svc, "businessHours", {
        days: form.getAll("days").map(Number),
        start: str(form, "start"),
        end: str(form, "end"),
      });
      await updateSettingsSection(svc, "followUp", {
        maxAutomatedMessagesPerLead: num("maxAutomatedMessagesPerLead"),
        minHoursBetweenMessages: num("minHoursBetweenMessages"),
        inactiveAfterDays: num("inactiveAfterDays"),
        eventApproachingDays: num("eventApproachingDays"),
        consultationReminderHours: num("consultationReminderHours"),
        quotationAwaitingDays: num("quotationAwaitingDays"),
      });
      await updateSettingsSection(svc, "booking", {
        requireAcceptedQuotation: bool(form, "requireAcceptedQuotation"),
        requireDepositRecorded: bool(form, "requireDepositRecorded"),
        maxBookingsPerDay: num("maxBookingsPerDay"),
      });
    });
    refresh();
    return "Policies saved";
  });
}

export async function updateQuotationSettingsAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const tax = Number(str(form, "taxRate"));
    if (!Number.isFinite(tax)) throw new ValidationError("Enter a tax rate", { taxRate: ["Enter a number"] });
    await inStudio("admin", (svc) =>
      updateSettingsSection(svc, "quotation", {
        taxRateBps: Math.round(tax * 100),
        taxLabel: str(form, "taxLabel"),
        validityDays: Number(str(form, "validityDays")),
        defaultDepositPercent: Number(str(form, "defaultDepositPercent")),
        terms: str(form, "terms"),
        prefix: str(form, "prefix"),
      }),
    );
    refresh();
    return "Quotation defaults saved";
  });
}

export async function saveServiceAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const priceText = str(form, "price").trim();
    const priceMinor = priceText === "" ? null : parseMoneyToMinor(priceText);
    if (priceText !== "" && priceMinor === null) throw new ValidationError("Enter a valid price", { price: ["Enter a valid price"] });
    await inStudio("admin", (svc) =>
      saveService(svc, optStr(form, "serviceId") ?? null, {
        name: str(form, "name"),
        description: str(form, "description"),
        category: str(form, "category") as "photography",
        unit: str(form, "unit") as "per_event",
        priceMinor,
        active: bool(form, "active"),
        showOnForm: bool(form, "showOnForm"),
      }),
    );
    refresh();
    return "Service saved";
  });
}

export async function deleteServiceAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await inStudio("admin", (svc) => deleteService(svc, str(form, "serviceId")));
    refresh();
    return "Service deactivated";
  });
}

export async function saveTemplateAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await inStudio("admin", (svc) =>
      saveTemplate(svc, optStr(form, "templateId") ?? null, {
        name: str(form, "name"),
        channel: str(form, "channel") as "whatsapp",
        purpose: str(form, "purpose") as "general",
        whatsappTemplateName: str(form, "whatsappTemplateName"),
        language: str(form, "language") || "en",
        subject: str(form, "subject"),
        body: str(form, "body"),
        approved: bool(form, "approved"),
        active: bool(form, "active"),
      }),
    );
    refresh();
    return "Template saved";
  });
}

export async function inviteMemberAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await inStudio("admin", (svc) => inviteMember(svc, str(form, "email"), str(form, "role") as "staff"));
    refresh();
    return "Invitation recorded. They join automatically when they sign up or sign in with that email.";
  });
}

export async function changeRoleAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await inStudio("admin", (svc) => changeMemberRole(svc, str(form, "memberId"), str(form, "role") as "staff"));
    refresh();
    return "Role updated";
  });
}

export async function removeMemberAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await inStudio("admin", (svc) => removeMember(svc, str(form, "memberId")));
    refresh();
    return "Member removed";
  });
}

export async function revokeInviteAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await inStudio("admin", (svc) => revokeInvite(svc, str(form, "inviteId")));
    refresh();
    return "Invitation revoked";
  });
}

export async function saveWhatsAppAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await inStudio("owner", (svc) =>
      saveWhatsAppIntegration(svc, { phoneNumberId: str(form, "phoneNumberId"), businessAccountId: str(form, "businessAccountId"), accessToken: str(form, "accessToken") }),
    );
    refresh();
    return "Saved. Use “Test connection” to verify the credentials.";
  });
}

export async function testWhatsAppAction(): Promise<ActionState> {
  return runAction(async () => {
    const outcome = await inStudio("owner", async (svc) => {
      const [row] = await svc.tx
        .select()
        .from(studioIntegrations)
        .where(and(eq(studioIntegrations.studioId, svc.studioId), eq(studioIntegrations.provider, "whatsapp_cloud")));
      if (!row?.secretEncrypted || !row.config.phoneNumberId) throw new ValidationError("Save WhatsApp credentials first");
      const result = await verifyWhatsAppCredentials(row.config.phoneNumberId, decryptSecret(row.secretEncrypted));
      await recordIntegrationCheck(svc, "whatsapp_cloud", result.ok, result.detail);
      return result;
    });
    refresh();
    if (!outcome.ok) throw new ValidationError(`Connection failed: ${outcome.detail}`);
    return outcome.detail;
  });
}

export async function disconnectWhatsAppAction(_: ActionState): Promise<ActionState> {
  return runAction(async () => {
    await inStudio("owner", (svc) => disconnectIntegration(svc, "whatsapp_cloud"));
    refresh();
    return "WhatsApp disconnected";
  });
}

export async function setPausedAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const paused = str(form, "paused") === "true";
    await inStudio("staff", (svc) => setAutomationPaused(svc, paused));
    refresh();
    return paused ? "Automation paused. No automated actions or sends will run." : "Automation resumed";
  });
}

export async function setAiEnabledAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await inStudio("admin", (svc) => setAiEnabled(svc, str(form, "enabled") === "true"));
    refresh();
    return "AI preference saved";
  });
}

export async function setRetentionAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const v = str(form, "days");
    await inStudio("owner", (svc) => setRetention(svc, v === "" ? null : Number(v)));
    refresh();
    return "Retention setting saved";
  });
}

export async function saveRuleAction(_: ActionState, form: FormData): Promise<ActionState> {
  const ruleId = optStr(form, "ruleId") ?? null;
  let id = "";
  const result = await runAction(async () => {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(str(form, "payload"));
    } catch {
      throw new ValidationError("Could not read the rule");
    }
    const rule = await inStudio("admin", (svc) => saveRule(svc, ruleId, payload as never));
    id = rule.id;
    return "Rule saved";
  });
  if (!result.ok) return result;
  refresh();
  if (!ruleId) redirect(`/automations/${id}`);
  return result;
}

export async function toggleRuleAction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    await inStudio("admin", (svc) => toggleRule(svc, str(form, "ruleId"), str(form, "enabled") === "true"));
    refresh();
    return "Rule updated";
  });
}

export async function deleteRuleAction(_: ActionState, form: FormData): Promise<ActionState> {
  const result = await runAction(async () => {
    await inStudio("admin", (svc) => deleteRule(svc, str(form, "ruleId")));
  });
  if (!result.ok) return result;
  refresh();
  redirect("/automations");
}
