import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EnquiryChat } from "@/components/client/enquiry-chat";
import { Alert } from "@/components/ui";
import { EVENT_TYPES } from "@/lib/domain";
import { parseStudioSettings } from "@/lib/studio-settings";
import { aiConfigured } from "@/server/ai/provider";
import { isDemoMode } from "@/server/env";
import { chatOpening } from "@/server/services/chat-intake";
import { issueFormToken } from "@/server/services/enquiries";
import { getPublicStudioBySlug } from "@/server/services/studios";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const found = await getPublicStudioBySlug(slug);
  return { title: found ? `Chat with ${found.studio.name}` : "Enquiry chat", robots: { index: Boolean(found) } };
}

export default async function EnquiryChatPage({ params }: Props) {
  const { slug } = await params;
  const found = await getPublicStudioBySlug(slug);
  if (!found || found.services.length === 0) notFound();
  const { studio, services } = found;
  const settings = parseStudioSettings(studio.settings);
  return (
    <div className="min-h-dvh bg-ivory">
      <div className="mx-auto max-w-2xl px-4 py-6 sm:py-10">
        <div className="mb-4 flex items-center justify-between gap-3 text-sm">
          <h1 className="font-display text-2xl font-semibold">{studio.name}</h1>
          <Link href={`/enquire/${studio.slug}`} className="text-muted hover:text-ink">
            Use the form instead
          </Link>
        </div>
        {(studio.isDemo || isDemoMode()) && (
          <Alert tone="warning" className="mb-4" title="Demonstration chat">
            Enquiries are stored as sample data and WhatsApp messages are simulated, not sent.
          </Alert>
        )}
        <EnquiryChat
          slug={studio.slug}
          formToken={issueFormToken(studio.id)}
          studioName={studio.name}
          brandColor={studio.brandColor}
          opening={chatOpening(studio.name, settings.enquiryForm.consentText)}
          services={services.map((s) => ({ id: s.id, name: s.name, description: s.description }))}
          eventTypes={EVENT_TYPES}
          budgetRanges={settings.enquiryForm.budgetRanges}
          aiOn={aiConfigured() && studio.aiEnabled}
        />
        {studio.privacyNotice && <p className="mx-auto mt-5 max-w-xl text-center text-xs leading-relaxed text-muted">{studio.privacyNotice}</p>}
      </div>
    </div>
  );
}
