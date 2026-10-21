import { NextResponse, type NextRequest } from "next/server";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/domain";
import { getCurrentUser, getStudioContext } from "@/server/auth/context";
import { withStudio } from "@/server/db/client";
import { ForbiddenError } from "@/server/lib/errors";
import { hashIp } from "@/server/lib/crypto";
import { exportLeadsCsv, type LeadFilters } from "@/server/services/leads";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  const ctx = user ? await getStudioContext() : null;
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const p = request.nextUrl.searchParams;
  const status = p.get("status");
  const filters: Partial<LeadFilters> = {
    q: p.get("q") ?? undefined,
    status: status && (LEAD_STATUSES as readonly string[]).includes(status) ? [status as LeadStatus] : undefined,
    view: (p.get("scope") as LeadFilters["view"]) ?? "all",
  };
  try {
    const { csv } = await withStudio(ctx.studio.id, (tx) =>
      exportLeadsCsv({ tx, studioId: ctx.studio.id, userId: ctx.user.id, role: ctx.role, actorType: "user" }, filters, {
        ipHash: hashIp(request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()),
      }),
    );
    return new NextResponse(`﻿${csv}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
}
