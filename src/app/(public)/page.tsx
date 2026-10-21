import { ArrowRight, BellRing, CalendarCheck, FileText, MessageCircle, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { ButtonLink, Logo } from "@/components/ui";

const features = [
  { icon: MessageCircle, title: "Every enquiry in one place", body: "Website form, Instagram, WhatsApp, phone calls and referrals land in one organised pipeline with a unique reference." },
  { icon: BellRing, title: "Follow-ups that never slip", body: "Durable, business-hours-aware reminders and tasks. Gentle by default, editable by you, paused in one click." },
  { icon: Sparkles, title: "AI-assisted drafting", body: "Summaries, replies, follow-ups and quotation drafts grounded in your real services and prices. You approve everything." },
  { icon: CalendarCheck, title: "Dates you can trust", body: "Tentative holds, confirmed bookings and conflict warnings. A date is never shown as available unless you recorded it." },
  { icon: FileText, title: "Branded quotations", body: "Deterministic totals, taxes, deposits and milestones with PDF export. Acceptance never silently becomes a booking." },
  { icon: ShieldCheck, title: "Built for trust", body: "Consent records, opt-out handling, tenant isolation enforced in the database, and an audit trail for sensitive actions." },
];

export default function Home() {
  return (
    <div className="min-h-dvh bg-ivory">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-5 sm:px-5">
        <Logo />
        <nav className="flex items-center gap-2">
          <ButtonLink href="/login" variant="ghost">
            Sign in
          </ButtonLink>
          <ButtonLink href="/register" variant="primary">
            <span className="sm:hidden">Start</span>
            <span className="hidden sm:inline">Create studio account</span>
          </ButtonLink>
        </nav>
      </header>

      <main>
        <section className="relative mx-auto max-w-6xl overflow-hidden px-5 pb-16 pt-10 md:overflow-visible md:pt-20">
          <div aria-hidden className="pointer-events-none absolute -right-24 top-0 hidden h-[420px] w-[420px] rounded-full border border-gold/30 md:block" />
          <div aria-hidden className="pointer-events-none absolute right-24 top-24 hidden h-[300px] w-[300px] rounded-full border border-ink/10 md:block" />
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">For wedding photography &amp; cinematography studios</p>
          <h1 className="mt-4 max-w-3xl font-display text-5xl font-semibold leading-[1.05] text-ink md:text-6xl">
            Every enquiry tracked.
            <br />
            Every follow-up remembered.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-soft">
            WeddingFlow AI centralises your enquiries, helps your team reply beautifully and on time, and automates the repetitive follow-up work
            without ever sending anything you have not approved.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/register" variant="gold" className="h-11 px-5">
              Get started <ArrowRight size={16} />
            </ButtonLink>
            <ButtonLink href="/login" variant="secondary" className="h-11 px-5">
              Sign in to your studio
            </ButtonLink>
          </div>
        </section>

        <section className="border-y border-line bg-white/60">
          <div className="mx-auto grid max-w-6xl gap-px px-5 py-14 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(({ icon: Icon, title, body }) => (
              <div key={title} className="p-5">
                <Icon className="text-gold" size={22} aria-hidden />
                <h2 className="mt-3 font-display text-xl font-semibold">{title}</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-16">
          <div className="grid gap-8 md:grid-cols-3">
            {[
              ["1", "Share your enquiry link", "Each studio gets a branded form at /enquire/your-studio for your website and Instagram bio."],
              ["2", "Respond while it matters", "New enquiries notify your team instantly with an acknowledgement draft ready to approve."],
              ["3", "Follow up with care", "Business-day follow-up tasks and suggestions stop automatically on opt-out, rejection or booking."],
            ].map(([n, t, b]) => (
              <div key={n}>
                <div className="flex h-9 w-9 items-center justify-center rounded-full border border-gold font-display text-lg text-gold">{n}</div>
                <h3 className="mt-3 font-semibold">{t}</h3>
                <p className="mt-1 text-sm text-muted">{b}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-xs text-muted">
          <span>WeddingFlow AI · A product by Infinity Web &amp; Apps</span>
          <Link href="/login" className="hover:text-ink">
            Studio sign in
          </Link>
        </div>
      </footer>
    </div>
  );
}
