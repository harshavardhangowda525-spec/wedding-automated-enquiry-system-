import { Download } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { quotationStatusAction } from "@/app/actions/quotations";
import { ActionForm, SubmitButton } from "@/components/client/forms";
import { QuotationBuilder } from "@/components/client/quotation-builder";
import { Alert, Card, PageHeader, QuotationStatusBadge, buttonClass, Badge } from "@/components/ui";
import { QUOTATION_TRANSITIONS, roleAtLeast, type QuotationStatus } from "@/lib/domain";
import { formatInTz } from "@/lib/time";
import { inStudio } from "@/server/auth/context";
import { getQuotation, listPricedServices } from "@/server/services/quotations";

export const metadata = { title: "Quotation" };

const ACTION_LABEL: Record<QuotationStatus, string> = {
  draft: "Move back to draft",
  approved: "Approve",
  sent: "Mark as sent to client",
  accepted: "Client accepted",
  rejected: "Client rejected",
  expired: "Mark expired",
};

export default async function QuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await inStudio("viewer", async (svc, ctx) => {
    const q = await getQuotation(svc, id).catch(() => null);
    if (!q) return null;
    return { ...q, services: await listPricedServices(svc), ctx };
  });
  if (!data) notFound();
  const { quotation: q, items, ctx } = data;
  const canEdit = roleAtLeast(ctx.role, "staff");
  const tz = ctx.studio.timezone;
  const next = QUOTATION_TRANSITIONS[q.status];

  return (
    <>
      <div className="mb-3 text-sm">
        <Link href={`/leads/${q.leadId}`} className="text-muted hover:text-ink">
          ← Back to lead
        </Link>
      </div>
      <PageHeader
        eyebrow={<span className="font-mono">{q.number}</span>}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {q.title} <QuotationStatusBadge status={q.status} />
            {q.aiAssisted && <Badge tone="gold">AI-assisted</Badge>}
          </span>
        }
        description={`For ${q.clientName}. Created ${formatInTz(q.createdAt, tz, "d MMM yyyy")}${q.sentAt ? ` · sent ${formatInTz(q.sentAt, tz, "d MMM yyyy")}` : ""}.`}
        actions={
          <>
            <a href={`/api/quotations/${q.id}/pdf`} className={buttonClass("secondary")}>
              <Download size={15} /> PDF
            </a>
            {canEdit &&
              next.map((s) => (
                <ActionForm key={s} action={quotationStatusAction} showMessage={false}>
                  <input type="hidden" name="quotationId" value={q.id} />
                  <input type="hidden" name="leadId" value={q.leadId} />
                  <input type="hidden" name="status" value={s} />
                  <SubmitButton variant={s === "approved" || s === "sent" || s === "accepted" ? "primary" : "secondary"}>{ACTION_LABEL[s]}</SubmitButton>
                </ActionForm>
              ))}
          </>
        }
      />
      {q.status === "accepted" && (
        <Alert tone="success" className="mb-4" title="Quotation accepted">
          This does not confirm the booking by itself. Record the deposit and confirm the booking from the lead page when your studio&apos;s conditions are met.
        </Alert>
      )}
      {q.status !== "draft" && (
        <Alert tone="info" className="mb-4">
          {q.status === "approved" ? "Approved quotations are locked. Move back to draft to edit." : "This quotation is locked. Create a new quotation for changes."}
        </Alert>
      )}
      <Card className="p-6">
        <QuotationBuilder
          leadId={q.leadId}
          quotationId={q.id}
          readOnly={!canEdit || q.status !== "draft"}
          currency={q.currency}
          services={data.services.map((s) => ({ id: s.id, name: s.name, priceMinor: s.priceMinor, unit: s.unit }))}
          initial={{
            title: q.title,
            clientName: q.clientName,
            clientEmail: q.clientEmail ?? "",
            clientPhone: q.clientPhone ?? "",
            eventSummary: q.eventSummary ?? "",
            eventDate: q.eventDate ?? "",
            validUntil: q.validUntil ?? "",
            items: items.map((i) => ({ serviceId: i.serviceId, description: i.description, quantity: i.quantity, unitPriceMinor: i.unitPriceMinor })),
            discountType: q.discountType as "none",
            discountValue: q.discountValue,
            taxRateBps: q.taxRateBps,
            taxLabel: q.taxLabel,
            depositType: q.depositType as "percent",
            depositValue: q.depositValue,
            milestones: q.milestones,
            terms: q.terms ?? "",
            internalNotes: q.internalNotes ?? "",
          }}
        />
      </Card>
    </>
  );
}
