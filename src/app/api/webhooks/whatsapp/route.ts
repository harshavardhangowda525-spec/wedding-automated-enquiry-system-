import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/server/env";
import { processWhatsAppWebhook, verifyWhatsAppSignature, type WhatsAppWebhookPayload } from "@/server/messaging/whatsapp-webhook";

/** Meta webhook verification handshake. */
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const token = env().WHATSAPP_VERIFY_TOKEN;
  if (token && p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === token) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

/** Delivery statuses and inbound messages. Signed with the app secret; processed idempotently. */
export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!verifyWhatsAppSignature(raw, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  let payload: WhatsAppWebhookPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    const result = await processWhatsAppWebhook(payload);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[webhook] whatsapp processing failed:", err instanceof Error ? err.message : err);
    // A 500 makes Meta retry; already-processed events are skipped on retry.
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
