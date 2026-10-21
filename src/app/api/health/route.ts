import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { asSystem } from "@/server/db/client";
import { env } from "@/server/env";

export async function GET() {
  try {
    const rows = await asSystem((tx) =>
      tx.execute<{ overdue: number }>(sql`select count(*)::int as overdue from wf.jobs where status = 'pending' and run_at < now() - interval '10 minutes'`),
    );
    const overdue = Number(rows.rows[0]?.overdue ?? 0);
    return NextResponse.json({ ok: true, mode: env().APP_MODE, database: "ok", overdueJobs: overdue, worker: overdue > 0 ? "lagging – is the worker or cron tick running?" : "ok" });
  } catch {
    return NextResponse.json({ ok: false, database: "unreachable" }, { status: 503 });
  }
}
