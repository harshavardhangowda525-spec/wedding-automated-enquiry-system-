import { CheckCircle2 } from "lucide-react";
import { notFound } from "next/navigation";
import { getPublicStudioBySlug } from "@/server/services/studios";

export const metadata = { title: "Enquiry received", robots: { index: false } };

export default async function ThanksPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ ref?: string; wa?: string }> }) {
  const { slug } = await params;
  const { ref, wa } = await searchParams;
  const found = await getPublicStudioBySlug(slug);
  if (!found) notFound();
  const reference = ref && /^ENQ-[A-Z0-9]{6}$/.test(ref) ? ref : null;
  return (
    <div className="flex min-h-dvh items-center justify-center bg-ivory px-4">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-white p-8 text-center shadow-sm">
        <CheckCircle2 className="mx-auto" size={44} style={{ color: found.studio.brandColor }} aria-hidden />
        <h1 className="mt-4 font-display text-3xl font-semibold">Thank you – your enquiry was received</h1>
        <p className="mt-3 text-ink-soft">
          {found.studio.name} has received your enquiry and will be in touch soon. This confirms that we received your details; it is{" "}
          <strong>not a booking confirmation</strong> and your date is not yet reserved.
        </p>
        {reference && (
          <p className="mt-5 rounded-lg bg-sand px-4 py-3 text-sm">
            Your enquiry reference: <span className="font-mono font-semibold">{reference}</span>
          </p>
        )}
        {wa === "1" && <p className="mt-4 text-sm text-ink-soft">We&apos;re also sending a confirmation to your WhatsApp number.</p>}
        <p className="mt-5 text-xs text-muted">You can reply STOP on WhatsApp at any time to stop receiving messages.</p>
      </div>
    </div>
  );
}
