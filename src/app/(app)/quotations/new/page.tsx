import { notFound } from "next/navigation";
import Link from "next/link";
import { QuotationBuilder } from "@/components/client/quotation-builder";
import { Alert, Card, PageHeader } from "@/components/ui";
import { inStudio } from "@/server/auth/context";
import { listPricedServices, quotationDefaults } from "@/server/services/quotations";

export const metadata = { title: "New quotation" };

export default async function NewQuotationPage({ searchParams }: { searchParams: Promise<{ leadId?: string }> }) {
  const { leadId } = await searchParams;
  if (!leadId) notFound();
  const data = await inStudio("staff", async (svc, ctx) => {
    const d = await quotationDefaults(svc, leadId).catch(() => null);
    if (!d) return null;
    return { ...d, services: await listPricedServices(svc), currency: ctx.studio.currency };
  });
  if (!data) notFound();
  const { lead, defaults, services } = data;
  const requested = services.filter((s) => lead.serviceIds.includes(s.id));
  const unpriced = services.filter((s) => s.priceMinor === null);
  return (
    <>
      <div className="mb-3 text-sm">
        <Link href={`/leads/${lead.id}`} className="text-muted hover:text-ink">
          ← Back to {lead.contactName}
        </Link>
      </div>
      <PageHeader title="New quotation" description="Starts as a draft. Approve it, then mark it sent when you share it with the client." />
      {unpriced.length > 0 && (
        <Alert tone="info" className="mb-4">
          {unpriced.length} service(s) have no price yet ({unpriced.map((s) => s.name).join(", ")}). Add prices in Settings → Services, or enter them per quotation.
        </Alert>
      )}
      <Card className="p-6">
        <QuotationBuilder
          leadId={lead.id}
          services={services.map((s) => ({ id: s.id, name: s.name, priceMinor: s.priceMinor, unit: s.unit }))}
          currency={data.currency}
          initial={{
            ...defaults,
            items: requested.map((s) => ({ serviceId: s.id, description: s.name, quantity: 1, unitPriceMinor: s.priceMinor ?? 0 })),
            discountType: "none",
            discountValue: 0,
            milestones: [],
            internalNotes: "",
          }}
        />
      </Card>
    </>
  );
}
