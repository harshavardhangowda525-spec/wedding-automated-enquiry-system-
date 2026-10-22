import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { roleAtLeast, type MemberRole } from "@/lib/domain";
import { asSystem, withStudio, type Tx } from "@/server/db/client";
import { profiles, studioMembers, studios } from "@/server/db/schema";
import { getAuthUser } from "./session";

export const ACTIVE_STUDIO_COOKIE = "wf_studio";

export type CurrentUser = {
  id: string;
  email: string;
  fullName: string | null;
  isPlatformAdmin: boolean;
};
export type Studio = typeof studios.$inferSelect;
export type Membership = { studio: Studio; role: MemberRole };

export type StudioContext = {
  user: CurrentUser;
  studio: Studio;
  role: MemberRole;
  memberships: Membership[];
};

/** Context passed to service functions. `tx` is already scoped to `studioId` by RLS. */
export type ServiceContext = {
  tx: Tx;
  studioId: string;
  userId: string | null;
  role: MemberRole | "system";
  actorType: "user" | "system" | "automation" | "client" | "ai" | "platform_admin";
};

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  // Signed-in pages depend on the request: never try to prerender them at build time
  // (where configuration errors would otherwise fail the whole build).
  await connection();
  const auth = await getAuthUser();
  if (!auth) return null;
  const [profile] = await asSystem((tx) => tx.select().from(profiles).where(eq(profiles.id, auth.id)));
  if (!profile) return null;
  return { id: profile.id, email: profile.email, fullName: profile.fullName, isPlatformAdmin: profile.isPlatformAdmin };
});

export async function getMemberships(userId: string): Promise<Membership[]> {
  const rows = await asSystem((tx) =>
    tx
      .select({ studio: studios, role: studioMembers.role })
      .from(studioMembers)
      .innerJoin(studios, eq(studios.id, studioMembers.studioId))
      .where(and(eq(studioMembers.userId, userId), eq(studios.status, "active")))
      .orderBy(asc(studios.name)),
  );
  return rows;
}

export const getStudioContext = cache(async (): Promise<StudioContext | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  const memberships = await getMemberships(user.id);
  if (memberships.length === 0) return null;
  const preferred = (await cookies()).get(ACTIVE_STUDIO_COOKIE)?.value;
  const active = memberships.find((m) => m.studio.id === preferred) ?? memberships[0];
  return { user, studio: active.studio, role: active.role, memberships };
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** For pages: redirects to login/onboarding when needed; throws when the role is insufficient. */
export async function requireStudio(minRole: MemberRole = "viewer"): Promise<StudioContext> {
  const user = await requireUser();
  const ctx = await getStudioContext();
  if (!ctx) {
    if (user.isPlatformAdmin) redirect("/admin");
    redirect("/onboarding");
  }
  // UI already hides controls the role cannot use; reaching here means a direct URL.
  if (!roleAtLeast(ctx.role, minRole)) redirect("/dashboard?denied=1");
  return ctx;
}

export async function requirePlatformAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  // Do not reveal that the admin area exists to non-admins.
  if (!user.isPlatformAdmin) notFound();
  return user;
}

/** Runs `fn` with an RLS-scoped transaction for the current user's active studio. */
export async function inStudio<T>(minRole: MemberRole, fn: (svc: ServiceContext, ctx: StudioContext) => Promise<T>): Promise<T> {
  const ctx = await requireStudio(minRole);
  return withStudio(ctx.studio.id, (tx) =>
    fn({ tx, studioId: ctx.studio.id, userId: ctx.user.id, role: ctx.role, actorType: "user" }, ctx),
  );
}
