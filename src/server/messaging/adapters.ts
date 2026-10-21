import "server-only";
import nodemailer from "nodemailer";
import { randomUUID } from "node:crypto";
import { env } from "@/server/env";

export type OutboundMessage = {
  channel: "whatsapp" | "email";
  to: string;
  subject?: string | null;
  body: string;
  whatsappTemplateName?: string | null;
  templateLanguage?: string | null;
  templateParams?: string[] | null;
  fromName?: string;
  replyTo?: string | null;
};

export type SendResult = { providerMessageId: string };

export interface ChannelAdapter {
  provider: string;
  isDemo: boolean;
  send(message: OutboundMessage): Promise<SendResult>;
}

/** A provider rejection that will not succeed on retry (bad number, rejected template…). */
export class PermanentSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentSendError";
  }
}

export class ChannelNotConfiguredError extends PermanentSendError {
  constructor(channel: string) {
    super(`${channel === "whatsapp" ? "WhatsApp" : "Email"} is not configured for this studio`);
    this.name = "ChannelNotConfiguredError";
  }
}

/**
 * Demo adapter: records the message but never contacts anyone. Every message sent
 * through it is stored with is_demo = true and shown as "Demo — not sent".
 */
export class DemoAdapter implements ChannelAdapter {
  provider = "demo";
  isDemo = true;
  static sent: OutboundMessage[] = [];
  async send(message: OutboundMessage): Promise<SendResult> {
    DemoAdapter.sent.push(message);
    return { providerMessageId: `demo-${randomUUID()}` };
  }
}

/** WhatsApp Business Platform – Cloud API (official Graph API endpoint). */
export class WhatsAppCloudAdapter implements ChannelAdapter {
  provider = "whatsapp_cloud";
  isDemo = false;
  constructor(
    private readonly phoneNumberId: string,
    private readonly accessToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: OutboundMessage): Promise<SendResult> {
    const to = message.to.replace(/[^\d]/g, "");
    const payload = message.whatsappTemplateName
      ? {
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
            name: message.whatsappTemplateName,
            language: { code: message.templateLanguage ?? "en" },
            components: message.templateParams?.length
              ? [{ type: "body", parameters: message.templateParams.map((text) => ({ type: "text", text })) }]
              : undefined,
          },
        }
      : { messaging_product: "whatsapp", to, type: "text", text: { body: message.body, preview_url: false } };

    const res = await this.fetchImpl(`https://graph.facebook.com/${env().WHATSAPP_GRAPH_VERSION}/${this.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
    if (!res.ok) {
      const detail = json.error?.message ?? `HTTP ${res.status}`;
      // 4xx (except 429) are permanent: invalid number, template not approved, window closed…
      if (res.status >= 400 && res.status < 500 && res.status !== 429) throw new PermanentSendError(`WhatsApp rejected the message: ${detail}`);
      throw new Error(`WhatsApp API error: ${detail}`);
    }
    const id = json.messages?.[0]?.id;
    if (!id) throw new Error("WhatsApp API response did not include a message id");
    // Acceptance by the API is NOT delivery; delivery arrives later via the status webhook.
    return { providerMessageId: id };
  }
}

export class SmtpAdapter implements ChannelAdapter {
  provider = "smtp";
  isDemo = false;
  async send(message: OutboundMessage): Promise<SendResult> {
    const e = env();
    if (!e.SMTP_HOST || !e.EMAIL_FROM) throw new ChannelNotConfiguredError("email");
    const transport = nodemailer.createTransport({
      host: e.SMTP_HOST,
      port: e.SMTP_PORT,
      secure: e.SMTP_SECURE,
      auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASS } : undefined,
      connectionTimeout: 15_000,
    });
    try {
      const info = await transport.sendMail({
        from: message.fromName ? { name: message.fromName, address: e.EMAIL_FROM } : e.EMAIL_FROM,
        to: message.to,
        replyTo: message.replyTo ?? undefined,
        subject: message.subject ?? "",
        text: message.body,
      });
      // SMTP acceptance means the relay took the message, not that it reached the inbox.
      return { providerMessageId: info.messageId };
    } catch (err) {
      const code = (err as { responseCode?: number }).responseCode;
      if (code && code >= 500 && code < 600) throw new PermanentSendError(`Mail server rejected the message: ${(err as Error).message}`);
      throw err;
    }
  }
}

export function isSmtpConfigured() {
  return Boolean(env().SMTP_HOST && env().EMAIL_FROM);
}
