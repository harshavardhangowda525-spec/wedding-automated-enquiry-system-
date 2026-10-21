import { disconnectWhatsAppAction, saveWhatsAppAction, testWhatsAppAction } from "@/app/actions/settings";
import { ActionForm, ConfirmAction, SubmitButton } from "@/components/client/forms";
import { Alert, Badge, Card, CardHeader, Field, Input } from "@/components/ui";
import { roleAtLeast } from "@/lib/domain";
import { formatInTz } from "@/lib/time";
import { aiConfigured } from "@/server/ai/provider";
import { inStudio } from "@/server/auth/context";
import { env, isDemoMode } from "@/server/env";
import { isSmtpConfigured } from "@/server/messaging/adapters";
import { listIntegrations } from "@/server/services/settings";

export const metadata = { title: "Integrations" };

export default async function IntegrationsSettings() {
  const { integrations, ctx } = await inStudio("admin", async (svc, ctx) => ({ integrations: await listIntegrations(svc), ctx }));
  const wa = integrations.find((i) => i.provider === "whatsapp_cloud");
  const isOwner = roleAtLeast(ctx.role, "owner");
  const tz = ctx.studio.timezone;
  const webhookUrl = `${env().APP_URL.replace(/\/$/, "")}/api/webhooks/whatsapp`;
  const testAction = async () => {
    "use server";
    return testWhatsAppAction();
  };
  return (
    <div className="max-w-4xl space-y-6">
      {(isDemoMode() || ctx.studio.isDemo) && (
        <Alert tone="warning" title="Demo messaging is active">
          {ctx.studio.isDemo ? "This is a sample studio, so it" : "This server runs in demo mode, so it"} always uses the simulated adapter – even if credentials are saved below. Nothing is sent to real people.
        </Alert>
      )}
      <Card>
        <CardHeader
          title="WhatsApp Business Platform (Cloud API)"
          description="Official Meta Cloud API. Requires a WhatsApp Business Account, a registered phone number and a permanent system-user access token."
          action={<Badge tone={wa?.status === "verified" ? "success" : wa?.status === "error" ? "danger" : wa ? "warning" : "neutral"}>{wa ? wa.status.replace("_", " ") : "not configured"}</Badge>}
        />
        <div className="space-y-4 p-5">
          {wa?.lastError && <Alert tone="danger">Last check failed: {wa.lastError}</Alert>}
          {wa?.lastVerifiedAt && <p className="text-xs text-success">Verified {formatInTz(wa.lastVerifiedAt, tz)} with the Graph API.</p>}
          {isOwner ? (
            <ActionForm action={saveWhatsAppAction} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Phone number ID" htmlFor="phoneNumberId" name="phoneNumberId">
                  <Input id="phoneNumberId" name="phoneNumberId" defaultValue={wa?.config.phoneNumberId ?? ""} inputMode="numeric" />
                </Field>
                <Field label="WhatsApp Business Account ID (optional)" htmlFor="businessAccountId" name="businessAccountId">
                  <Input id="businessAccountId" name="businessAccountId" defaultValue={wa?.config.businessAccountId ?? ""} inputMode="numeric" />
                </Field>
              </div>
              <Field label="Access token" htmlFor="accessToken" name="accessToken" hint={wa?.hasSecret ? "A token is stored (encrypted). Leave blank to keep it." : "Stored encrypted (AES-256-GCM) and never shown again."}>
                <Input id="accessToken" name="accessToken" type="password" autoComplete="off" />
              </Field>
              <SubmitButton>Save credentials</SubmitButton>
            </ActionForm>
          ) : (
            <p className="text-sm text-muted">Only studio owners can change integration credentials.</p>
          )}
          {isOwner && wa && (
            <div className="flex flex-wrap gap-2 border-t border-line pt-4">
              <ActionForm action={testAction}>
                <SubmitButton variant="secondary" pendingText="Testing…">
                  Test connection
                </SubmitButton>
              </ActionForm>
              <ConfirmAction action={disconnectWhatsAppAction} label="Disconnect" variant="ghost" title="Disconnect WhatsApp?" description="Stored credentials are deleted. Queued WhatsApp messages will fail until you reconnect." confirmLabel="Disconnect" />
            </div>
          )}
          <div className="rounded-lg bg-sand/60 p-4 text-xs text-ink-soft">
            <p className="font-semibold">Webhook (configure once in your Meta app)</p>
            <p className="mt-1">
              Callback URL: <span className="font-mono">{webhookUrl}</span>
            </p>
            <p>Verify token: the server&apos;s WHATSAPP_VERIFY_TOKEN · Subscribe to the “messages” field. Delivery receipts and replies (including STOP opt-outs) are processed automatically.</p>
            <p className="mt-1">Server webhook secret: {env().WHATSAPP_APP_SECRET ? <Badge tone="success">configured</Badge> : <Badge tone="danger">WHATSAPP_APP_SECRET not set</Badge>}</p>
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Email (SMTP)" description="Configured by the platform operator for all studios. Messages are sent from the platform address with your studio name and your reply-to email." action={<Badge tone={isSmtpConfigured() ? "success" : "neutral"}>{isSmtpConfigured() ? "configured" : "not configured"}</Badge>} />
        <p className="p-5 text-sm text-muted">SMTP acceptance is shown as “Sent”. Inbox delivery is not confirmed by SMTP, so emails never show as “Delivered”.</p>
      </Card>
      <Card>
        <CardHeader title="Claude AI" description="Summaries, reply drafts, priority and next-step suggestions, quotation drafts." action={<Badge tone={aiConfigured() ? "success" : "neutral"}>{aiConfigured() ? "configured" : "not configured"}</Badge>} />
        <p className="p-5 text-sm text-muted">Configured by the platform operator (ANTHROPIC_API_KEY, AI_MODEL). Turn AI on or off for your studio in AI, data &amp; privacy.</p>
      </Card>
      <Card>
        <CardHeader title="Google Calendar" action={<Badge>not connected</Badge>} />
        <p className="p-5 text-sm text-muted">External calendar sync is not available yet. Your WeddingFlow calendar remains the source of truth for availability.</p>
      </Card>
    </div>
  );
}
