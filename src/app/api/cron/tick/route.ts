import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/server/env";
import { tick } from "@/server/jobs/handlers";

/**
 * Runs one batch of due background jobs. For hosts without a long-running worker
 * (e.g. serverless), call this every minute from a scheduler with
 * `Authorization: Bearer $CRON_SECRET`. Safe to call concurrently.
 */
async function handle(request: NextRequest) {
  const secret = env().CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  const given = Buffer.from(header.replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(secret ?? "");
  if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await tick(`cron:${process.pid}`, 50);
  return NextResponse.json({ ok: true, ...result });
}

export const GET = handle;
export const POST = handle;
