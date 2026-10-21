import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getCurrentUser, getStudioContext } from "@/server/auth/context";
import { withStudio } from "@/server/db/client";
import { studios } from "@/server/db/schema";
import { getQuotation } from "@/server/services/quotations";
import { renderQuotationPdf } from "@/server/services/quotation-pdf";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  const ctx = user ? await getStudioContext() : null;
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const result = await withStudio(ctx.studio.id, async (tx) => {
    const q = await getQuotation({ tx, studioId: ctx.studio.id }, id).catch(() => null);
    if (!q) return null;
    const [studio] = await tx.select().from(studios).where(eq(studios.id, ctx.studio.id));
    return { ...q, studio };
  });
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const bytes = await renderQuotationPdf(result.quotation, result.items, result.studio);
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${result.quotation.number}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
