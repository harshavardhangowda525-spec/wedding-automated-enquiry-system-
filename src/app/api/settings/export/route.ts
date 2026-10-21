import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, getStudioContext } from "@/server/auth/context";
import { withStudio } from "@/server/db/client";
import { hashIp } from "@/server/lib/crypto";
import { ForbiddenError } from "@/server/lib/errors";
import { exportStudioData } from "@/server/services/settings";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  const ctx = user ? await getStudioContext() : null;
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const data = await withStudio(ctx.studio.id, (tx) =>
      exportStudioData({ tx, studioId: ctx.studio.id, userId: ctx.user.id, role: ctx.role, actorType: "user" }, { ipHash: hashIp(request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()) }),
    );
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${ctx.studio.slug}-export-${new Date().toISOString().slice(0, 10)}.json"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
}
