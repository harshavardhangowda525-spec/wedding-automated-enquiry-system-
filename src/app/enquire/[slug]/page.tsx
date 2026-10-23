import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EnquiryForm } from "@/components/client/enquiry-form";
import { Alert } from "@/components/ui";
import { parseStudioSettings } from "@/lib/studio-settings";
import { isDemoMode } from "@/server/env";
import { issueFormToken } from "@/server/services/enquiries";
import { getPublicStudioBySlug } from "@/server/services/studios";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const found = await getPublicStudioBySlug(slug);
  return { title: found ? `Enquire – ${found.studio.name}` : "Enquiry", robots: { index: Boolean(found) } };
}

export default async function EnquirePage({ params }: Props) {
  const { slug } = await params;
  const found = await getPublicStudioBySlug(slug);
  if (!found) notFound();
  const { studio, services } = found;
  const settings = parseStudioSettings(studio.settings);
  return (
    <div className="min-h-dvh bg-ivory">
      <div className="h-1.5" style={{ background: studio.brandColor }} />
      <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
        <header className="mb-8 text-center">
          {studio.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={studio.logoUrl} alt={`${studio.name} logo`} className="mx-auto mb-4 h-16 w-auto object-contain" />
          ) : (
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border font-display text-2xl" style={{ borderColor: studio.brandColor, color: studio.brandColor }}>
              {studio.name[0]}
            </div>
          )}
          <h1 className="font-display text-4xl font-semibold">{studio.name}</h1>
          {studio.welcomeMessage && <p className="mx-auto mt-3 max-w-xl text-ink-soft">{studio.welcomeMessage}</p>}
        </header>
        {(studio.isDemo || isDemoMode()) && (
          <Alert tone="warning" className="mb-6" title="Demonstration form">
            This form belongs to a demo environment. Submissions are stored as sample data and no real messages are sent.
          </Alert>
        )}
        {services.length > 0 && (
          <Link
            href={`/enquire/${studio.slug}/chat`}
            className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-line bg-white px-4 py-3 text-sm shadow-sm hover:border-gold"
          >
            <span>
              <span className="font-medium text-ink">Prefer to chat?</span>{" "}
              <span className="text-muted">Answer a few quick questions instead of filling in the form.</span>
            </span>
            <span className="font-medium" style={{ color: studio.brandColor }}>
              Start chat →
            </span>
          </Link>
        )}
        <div className="rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-8">
          {services.length === 0 ? (
            <p className="text-center text-sm text-muted">This studio is not accepting online enquiries yet.</p>
          ) : (
            <EnquiryForm
              slug={studio.slug}
              formToken={issueFormToken(studio.id)}
              services={services}
              enabledFields={settings.enquiryForm.enabledFields}
              budgetRanges={settings.enquiryForm.budgetRanges}
              consentText={settings.enquiryForm.consentText}
              brandColor={studio.brandColor}
            />
          )}
        </div>
        {studio.privacyNotice && <p className="mx-auto mt-6 max-w-2xl text-center text-xs leading-relaxed text-muted">{studio.privacyNotice}</p>}
        <p className="mt-6 text-center text-xs text-muted/80">Powered by WeddingFlow AI</p>
      </div>
    </div>
  );
}
