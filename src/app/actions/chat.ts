"use server";

import { headers } from "next/headers";
import type { ChatFields } from "@/lib/chat-intake";
import { RateLimitError } from "@/server/lib/errors";
import { clientIp } from "@/server/lib/request";
import { processChatTurn, submitChatEnquiry, type ChatTurnResult } from "@/server/services/chat-intake";

type TurnInput = { text?: string; choice?: string; choices?: string[]; date?: string; countryCode?: string; skip?: boolean };

export async function chatTurnAction(slug: string, fields: ChatFields, input: TurnInput): Promise<ChatTurnResult> {
  try {
    return await processChatTurn(slug, { fields, input }, { ip: await clientIp() });
  } catch (err) {
    if (err instanceof RateLimitError) return { ok: false, error: err.message };
    console.error("[chat] turn failed:", err instanceof Error ? err.message : err);
    return { ok: false, error: "Sorry, something went wrong on our side. Please try again in a moment." };
  }
}

export async function chatSubmitAction(slug: string, fields: ChatFields, formToken: string): Promise<{ ok: true; reference: string; whatsappQueued: boolean } | { ok: false; error: string }> {
  try {
    const result = await submitChatEnquiry(slug, { fields, formToken }, { ip: await clientIp(), userAgent: (await headers()).get("user-agent") });
    if (!result.ok) {
      const first = result.fieldErrors ? Object.values(result.fieldErrors)[0]?.[0] : undefined;
      return { ok: false, error: first ?? result.error };
    }
    return { ok: true, reference: result.reference, whatsappQueued: result.autoAcknowledgement === "queued" };
  } catch (err) {
    if (err instanceof RateLimitError) return { ok: false, error: err.message };
    console.error("[chat] submit failed:", err instanceof Error ? err.message : err);
    return { ok: false, error: "We could not send your enquiry right now. Please try again in a moment." };
  }
}
