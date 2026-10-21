/**
 * Demo data for sales demonstrations and local development.
 *
 *   pnpm demo:seed      – create sample studios, users and leads (idempotent)
 *   pnpm demo:reset     – delete all sample studios and recreate them
 *
 * Refuses to run when APP_MODE=production. Every record is flagged is_demo and shown
 * as "Sample" in the UI; demo studios always use the simulated messaging adapter.
 */
import "dotenv/config";
import { eq, inArray, like, sql } from "drizzle-orm";
import { asSystem, closeDb, withStudio } from "@/server/db/client";
import { activities, calendarEntries, consents, leads, localAuthUsers, messages, profiles, services, studioMembers, studios, tasks } from "@/server/db/schema";
import { isSupabaseConfigured } from "@/server/env";
import { createLocalUser } from "@/server/auth/session";
import { createStudio } from "@/server/services/studios";
import { createQuotation, quotationDefaults, setQuotationStatus } from "@/server/services/quotations";
import type { ServiceContext } from "@/server/auth/context";

const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "weddingflow-demo";

const PRICES: Record<string, number> = {
  "Candid Photography": 6_500_000,
  "Traditional Photography": 4_000_000,
  "Cinematic Wedding Film": 15_000_000,
  "Traditional Videography": 4_500_000,
  "Highlight Teaser": 2_500_000,
  "Pre-wedding Shoot": 5_500_000,
  "Drone Coverage": 2_000_000,
  "Premium Wedding Album": 3_500_000,
};

const SAMPLE_LEADS = [
  { name: "Ananya Rao", partner: "Vikram Shetty", status: "new_enquiry", daysAgo: 0, eventIn: 120, city: "Bengaluru", source: "website_form", services: ["Candid Photography", "Cinematic Wedding Film"], budget: "₹2,50,000 – ₹5,00,000" },
  { name: "Meera Iyer", partner: "Arjun Nair", status: "new_enquiry", daysAgo: 1, eventIn: 200, city: "Kochi", source: "instagram", services: ["Pre-wedding Shoot", "Candid Photography"] },
  { name: "Riya Kapoor", partner: "Kabir Malhotra", status: "contact_attempted", daysAgo: 3, eventIn: 75, city: "Udaipur", source: "website_form", services: ["Cinematic Wedding Film", "Drone Coverage"] },
  { name: "Sneha Patil", partner: "Rohan Deshmukh", status: "contacted", daysAgo: 5, eventIn: 160, city: "Pune", source: "referral", services: ["Candid Photography", "Premium Wedding Album"] },
  { name: "Divya Menon", partner: "Karthik Pillai", status: "qualified", daysAgo: 8, eventIn: 95, city: "Chennai", source: "whatsapp", services: ["Candid Photography", "Traditional Videography"] },
  { name: "Aisha Khan", partner: "Imran Siddiqui", status: "consultation_scheduled", daysAgo: 9, eventIn: 140, city: "Hyderabad", source: "website_form", services: ["Cinematic Wedding Film", "Highlight Teaser"] },
  { name: "Pooja Sharma", partner: "Aditya Verma", status: "quotation_sent", daysAgo: 12, eventIn: 60, city: "Jaipur", source: "website_form", services: ["Candid Photography", "Cinematic Wedding Film", "Drone Coverage"] },
  { name: "Nisha Reddy", partner: "Sai Krishna", status: "negotiation", daysAgo: 15, eventIn: 50, city: "Hyderabad", source: "wedding_fair", services: ["Candid Photography", "Premium Wedding Album"] },
  { name: "Tanvi Joshi", partner: "Neel Mehta", status: "tentative_hold", daysAgo: 18, eventIn: 110, city: "Mumbai", source: "instagram", services: ["Cinematic Wedding Film"] },
  { name: "Kavya Gowda", partner: "Pranav Hegde", status: "booking_confirmed", daysAgo: 30, eventIn: 40, city: "Mysuru", source: "referral", services: ["Candid Photography", "Cinematic Wedding Film"] },
  { name: "Ishita Bose", partner: "Arnav Sen", status: "lost", daysAgo: 25, eventIn: 30, city: "Kolkata", source: "website_form", services: ["Candid Photography"], lostReason: "Chose another studio" },
  { name: "Simran Gill", partner: null, status: "not_interested", daysAgo: 20, eventIn: null, city: "Chandigarh", source: "phone", services: ["Pre-wedding Shoot"], lostReason: "Budget" },
] as const;

function dateIn(days: number) {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

async function ensureUser(email: string, name: string) {
  const [existing] = await asSystem((tx) => tx.select().from(profiles).where(eq(profiles.email, email)));
  if (existing) return existing.id;
  if (isSupabaseConfigured()) {
    throw new Error(`Supabase Auth is configured. Create ${email} in Supabase first (or unset Supabase for a local demo), then re-run.`);
  }
  const res = await createLocalUser(email, DEMO_PASSWORD, name);
  if (!res.ok) throw new Error(res.error);
  return res.id;
}

async function seedStudio(opts: { name: string; slug: string; ownerEmail: string; ownerName: string; staff?: { email: string; name: string }[]; leadsCount: number }) {
  const [existing] = await asSystem((tx) => tx.select().from(studios).where(eq(studios.slug, opts.slug)));
  if (existing) {
    console.log(`• ${opts.name} already exists – skipping (use demo:reset to recreate)`);
    return existing;
  }
  const ownerId = await ensureUser(opts.ownerEmail, opts.ownerName);
  const studio = await createStudio(ownerId, { name: opts.name, slug: opts.slug, businessType: "photo_video", city: "Bengaluru", phone: "+91 80 0000 0000", email: opts.ownerEmail }, { isDemo: true });
  const staffIds: string[] = [];
  for (const s of opts.staff ?? []) {
    const id = await ensureUser(s.email, s.name);
    staffIds.push(id);
    await asSystem((tx) => tx.insert(studioMembers).values({ studioId: studio.id, userId: id, role: "staff" }).onConflictDoNothing());
  }
  await asSystem(async (tx) => {
    await tx
      .update(studios)
      .set({ welcomeMessage: `Thank you for considering ${opts.name}. Tell us about your celebration and our team will reach out personally.` })
      .where(eq(studios.id, studio.id));
    const svcRows = await tx.select().from(services).where(eq(services.studioId, studio.id));
    for (const s of svcRows) if (PRICES[s.name]) await tx.update(services).set({ priceMinor: PRICES[s.name] }).where(eq(services.id, s.id));
  });

  await withStudio(studio.id, async (tx) => {
    const svcRows = await tx.select().from(services).where(eq(services.studioId, studio.id));
    const byName = new Map(svcRows.map((s) => [s.name, s.id]));
    const team = [ownerId, ...staffIds];
    const svc: ServiceContext = { tx, studioId: studio.id, userId: ownerId, role: "owner", actorType: "user" };
    let i = 0;
    for (const sample of SAMPLE_LEADS.slice(0, opts.leadsCount)) {
      const createdAt = new Date(Date.now() - sample.daysAgo * 86_400_000 - (i % 5) * 3_600_000);
      const contacted = !["new_enquiry", "contact_attempted"].includes(sample.status);
      const ref = `ENQ-DEMO${String(i + 1).padStart(2, "0")}`;
      const [lead] = await tx
        .insert(leads)
        .values({
          studioId: studio.id,
          reference: ref,
          contactName: sample.name,
          partnerName: sample.partner,
          phone: `+9190000${String(10000 + i).padStart(5, "0")}`,
          email: `${sample.name.split(" ")[0].toLowerCase()}.sample@example.com`,
          eventType: "Wedding",
          eventDate: sample.eventIn === null ? null : dateIn(sample.eventIn),
          city: sample.city,
          serviceIds: sample.services.map((n) => byName.get(n)).filter(Boolean) as string[],
          budgetRange: "budget" in sample ? sample.budget : null,
          message: "Sample enquiry created for demonstration purposes.",
          preferredChannel: "whatsapp",
          source: sample.source,
          status: sample.status,
          assignedTo: team[i % team.length],
          consentContact: true,
          consentAt: createdAt,
          firstContactedAt: contacted ? new Date(createdAt.getTime() + (2 + i) * 3_600_000) : null,
          lastContactedAt: contacted ? new Date(createdAt.getTime() + (2 + i) * 3_600_000) : null,
          lastActivityAt: new Date(createdAt.getTime() + 3_600_000),
          lostReason: "lostReason" in sample ? sample.lostReason : null,
          revenueMinor: sample.status === "booking_confirmed" ? 21_500_000 : null,
          quotationAmountMinor: ["quotation_sent", "negotiation", "booking_confirmed"].includes(sample.status) ? 21_500_000 : null,
          depositRecordedAt: sample.status === "booking_confirmed" ? createdAt : null,
          depositAmountMinor: sample.status === "booking_confirmed" ? 6_450_000 : null,
          isDemo: true,
          createdAt,
          updatedAt: createdAt,
        })
        .returning();
      await tx.insert(consents).values({ studioId: studio.id, leadId: lead.id, granted: true, text: "Sample consent (demo data)", source: "demo_seed", createdAt });
      await tx.insert(activities).values({ studioId: studio.id, leadId: lead.id, actorType: "client", type: "lead_created", summary: `Sample enquiry received (${ref})`, createdAt });
      if (contacted) {
        await tx.insert(activities).values({
          studioId: studio.id,
          leadId: lead.id,
          actorType: "user",
          actorId: team[i % team.length],
          type: "status_changed",
          summary: `Status set to ${sample.status.replace(/_/g, " ")} (sample history)`,
          data: { to: sample.status },
          createdAt: new Date(createdAt.getTime() + 3_600_000),
        });
      }
      if (sample.status === "booking_confirmed" && lead.eventDate) {
        await tx.insert(calendarEntries).values({ studioId: studio.id, leadId: lead.id, type: "confirmed_booking", title: `Booked: ${sample.name} & ${sample.partner} – Wedding`, entryDate: lead.eventDate });
      }
      if (sample.status === "tentative_hold" && lead.eventDate) {
        await tx.insert(calendarEntries).values({ studioId: studio.id, leadId: lead.id, type: "tentative_hold", title: `Hold: ${sample.name} & ${sample.partner} – Wedding`, entryDate: lead.eventDate });
      }
      if (sample.status === "consultation_scheduled") {
        await tx.insert(calendarEntries).values({ studioId: studio.id, leadId: lead.id, type: "consultation", title: `Consultation: ${sample.name}`, entryDate: dateIn(2), startTime: "16:00", endTime: "16:45" });
      }
      if (["new_enquiry", "contact_attempted", "contacted"].includes(sample.status)) {
        await tx.insert(tasks).values({
          studioId: studio.id,
          leadId: lead.id,
          title: `Follow up with ${sample.name}`,
          type: "follow_up",
          dueAt: new Date(Date.now() + (i % 3 === 0 ? -2 : 4) * 3_600_000),
          assignedTo: team[i % team.length],
          createdByType: "automation",
        });
      }
      if (sample.status === "new_enquiry") {
        await tx.insert(messages).values({
          studioId: studio.id,
          leadId: lead.id,
          channel: "whatsapp",
          status: "awaiting_approval",
          purpose: "acknowledgement",
          body: `Hi ${sample.name.split(" ")[0]}, thank you for your enquiry with ${opts.name} (ref ${ref}). We have received your details and a member of our team will contact you shortly.`,
          toAddress: lead.phone,
          createdByType: "automation",
        });
      }
      if (sample.status === "quotation_sent" || sample.status === "negotiation") {
        const { defaults } = await quotationDefaults(svc, lead.id);
        const q = await createQuotation(svc, lead.id, {
          ...defaults,
          items: sample.services.map((n) => ({ serviceId: byName.get(n), description: n, quantity: 1, unitPriceMinor: PRICES[n] })),
          internalNotes: "Sample quotation (demo data)",
        });
        await setQuotationStatus(svc, q.id, "approved");
        await setQuotationStatus(svc, q.id, "sent");
      }
      i++;
    }
  });
  console.log(`✓ ${opts.name} → /enquire/${opts.slug}`);
  return studio;
}

export async function seedDemo() {
  if (process.env.APP_MODE === "production") throw new Error("Refusing to seed demo data in production mode.");
  const adminEmail = "admin@infinitywebapps.demo";
  await ensureUser(adminEmail, "Infinity Admin");
  await asSystem((tx) => tx.update(profiles).set({ isPlatformAdmin: true }).where(eq(profiles.email, adminEmail)));
  await seedStudio({
    name: "Aurora Wedding Films (Sample)",
    slug: "aurora-films-demo",
    ownerEmail: "owner@aurora.demo",
    ownerName: "Aarav (Sample Owner)",
    staff: [{ email: "staff@aurora.demo", name: "Diya (Sample Staff)" }],
    leadsCount: SAMPLE_LEADS.length,
  });
  await seedStudio({ name: "Lumière Photography (Sample)", slug: "lumiere-demo", ownerEmail: "owner@lumiere.demo", ownerName: "Zara (Sample Owner)", leadsCount: 4 });
  console.log(`\nDemo logins (local demo auth, password "${DEMO_PASSWORD}"):\n  owner@aurora.demo · staff@aurora.demo · owner@lumiere.demo · ${adminEmail} (platform admin)`);
}

export async function resetDemo() {
  if (process.env.APP_MODE === "production") throw new Error("Refusing to reset demo data in production mode.");
  await asSystem(async (tx) => {
    const demo = await tx.select({ id: studios.id }).from(studios).where(eq(studios.isDemo, true));
    if (demo.length) await tx.delete(studios).where(inArray(studios.id, demo.map((d) => d.id)));
    await tx.execute(sql`delete from wf.jobs where studio_id is not null and studio_id not in (select id from wf.studios)`);
    await tx.delete(profiles).where(like(profiles.email, "%.demo"));
    await tx.delete(localAuthUsers).where(like(localAuthUsers.email, "%.demo"));
    console.log(`Removed ${demo.length} sample studio(s) and demo logins.`);
  });
}

async function main() {
  if (process.argv.includes("--reset")) await resetDemo();
  await seedDemo();
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
