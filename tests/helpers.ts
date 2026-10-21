import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { asSystem, withStudio } from "@/server/db/client";
import { profiles, services, studioMembers } from "@/server/db/schema";
import type { ServiceContext } from "@/server/auth/context";
import type { MemberRole } from "@/lib/domain";
import { createStudio } from "@/server/services/studios";
import { issueFormToken } from "@/server/services/enquiries";

export async function createUser(email = `user-${randomUUID().slice(0, 8)}@test.local`, name = "Test User") {
  const id = randomUUID();
  await asSystem((tx) => tx.insert(profiles).values({ id, email, fullName: name }));
  return { id, email };
}

export async function createTestStudio(name = "Test Studio") {
  const owner = await createUser();
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${randomUUID().slice(0, 6)}`;
  const studio = await createStudio(owner.id, { name, slug, businessType: "photo_video" });
  // Give services prices so quotation tests have data.
  const svc = await asSystem((tx) => tx.select().from(services).where(eq(services.studioId, studio.id)));
  await asSystem(async (tx) => {
    let price = 5_000_000;
    for (const s of svc) {
      await tx.update(services).set({ priceMinor: price }).where(eq(services.id, s.id));
      price += 1_000_000;
    }
  });
  return { studio, owner, services: svc };
}

export async function addMember(studioId: string, role: MemberRole) {
  const user = await createUser();
  await asSystem((tx) => tx.insert(studioMembers).values({ studioId, userId: user.id, role }));
  return user;
}

/** Runs fn as a studio member inside an RLS-scoped transaction. */
export function asMember<T>(studioId: string, userId: string, role: MemberRole, fn: (svc: ServiceContext) => Promise<T>) {
  return withStudio(studioId, (tx) => fn({ tx, studioId, userId, role, actorType: "user" }));
}

export function enquiryPayload(studioId: string, serviceIds: string[], overrides: Record<string, unknown> = {}) {
  return {
    contactName: "Ananya Rao",
    partnerName: "Vikram",
    countryCode: "+91",
    phone: `98${Math.floor(10000000 + Math.random() * 89999999)}`,
    email: "ananya@example.com",
    eventType: "Wedding",
    dateKnown: "yes",
    eventDate: "2027-02-14",
    city: "Bengaluru",
    serviceIds,
    preferredChannel: "whatsapp",
    consent: true,
    website: "",
    formToken: issueFormToken(studioId, Date.now() - 10_000),
    ...overrides,
  };
}

/** Resolves to the underlying PostgreSQL error message of a rejected query. */
export async function pgErrorMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    const e = err as { message?: string; cause?: { message?: string } };
    return e.cause?.message ?? e.message ?? String(err);
  }
  throw new Error("Expected the query to fail");
}

import { sql as dsql } from "drizzle-orm";
import { jobHandlers } from "@/server/jobs/handlers";
import { runDueJobs } from "@/server/jobs/queue";

/** Makes every pending job due immediately (simulates time passing). */
export async function makeJobsDue() {
  await asSystem((tx) => tx.execute(dsql`update wf.jobs set run_at = now() - interval '1 second' where status = 'pending'`));
}

/** Runs due jobs until the queue is idle. Never processes sweep jobs unless asked. */
export async function drainJobs(opts: { includeDelayed?: boolean; maxRounds?: number } = {}) {
  let total = 0;
  for (let i = 0; i < (opts.maxRounds ?? 10); i++) {
    if (opts.includeDelayed) await makeJobsDue();
    await asSystem((tx) => tx.execute(dsql`update wf.jobs set status = 'cancelled' where type = 'automation.sweep' and status = 'pending'`));
    const { processed } = await runDueJobs(jobHandlers, { workerId: "test", limit: 100 });
    total += processed;
    if (processed === 0) break;
  }
  return total;
}
