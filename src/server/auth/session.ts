import "server-only";
import { eq, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { asSystem } from "@/server/db/client";
import { localAuthUsers, profiles } from "@/server/db/schema";
import { env, isDemoMode, isSupabaseConfigured, platformAdminEmails } from "@/server/env";
import {
  LOCAL_SESSION_COOKIE,
  hashPassword,
  localSessionCookieOptions,
  signLocalSession,
  verifyLocalSession,
  verifyPassword,
} from "./local";
import { createSupabaseServerClient } from "./supabase";

export type AuthUser = { id: string; email: string };
export type AuthMode = "supabase" | "local_demo" | "unconfigured";

export function authMode(): AuthMode {
  if (isSupabaseConfigured()) return "supabase";
  if (isDemoMode()) return "local_demo";
  return "unconfigured";
}

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Returns the verified user for this request, or null. */
export async function getAuthUser(): Promise<AuthUser | null> {
  const mode = authMode();
  if (mode === "supabase") {
    const supabase = await createSupabaseServerClient();
    // getUser() validates the token with Supabase Auth instead of trusting the cookie.
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user?.email) return null;
    return { id: data.user.id, email: data.user.email.toLowerCase() };
  }
  if (mode === "local_demo") {
    const token = (await cookies()).get(LOCAL_SESSION_COOKIE)?.value;
    return token ? verifyLocalSession(token) : null;
  }
  return null;
}

export async function signInWithPassword(email: string, password: string): Promise<Result> {
  const normalized = email.trim().toLowerCase();
  const mode = authMode();
  if (mode === "supabase") {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email: normalized, password });
    if (error || !data.user) return { ok: false, error: error?.message ?? "Sign in failed" };
    await ensureProfile({ id: data.user.id, email: normalized });
    return { ok: true };
  }
  if (mode === "local_demo") {
    const user = await asSystem(async (tx) => {
      const [row] = await tx.select().from(localAuthUsers).where(eq(localAuthUsers.email, normalized));
      return row;
    });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return { ok: false, error: "Incorrect email or password" };
    }
    await ensureProfile({ id: user.id, email: normalized });
    (await cookies()).set(LOCAL_SESSION_COOKIE, await signLocalSession({ id: user.id, email: normalized }), localSessionCookieOptions);
    return { ok: true };
  }
  return { ok: false, error: "Authentication is not configured" };
}

export async function signUpWithPassword(
  email: string,
  password: string,
  fullName: string,
): Promise<Result<{ needsConfirmation: boolean }>> {
  const normalized = email.trim().toLowerCase();
  const mode = authMode();
  if (mode === "supabase") {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signUp({
      email: normalized,
      password,
      options: { data: { full_name: fullName }, emailRedirectTo: `${env().APP_URL}/auth/callback` },
    });
    if (error || !data.user) return { ok: false, error: error?.message ?? "Sign up failed" };
    await ensureProfile({ id: data.user.id, email: normalized }, fullName);
    return { ok: true, needsConfirmation: !data.session };
  }
  if (mode === "local_demo") {
    const created = await createLocalUser(normalized, password, fullName);
    if (!created.ok) return created;
    (await cookies()).set(LOCAL_SESSION_COOKIE, await signLocalSession({ id: created.id, email: normalized }), localSessionCookieOptions);
    return { ok: true, needsConfirmation: false };
  }
  return { ok: false, error: "Authentication is not configured" };
}

/** Creates a local demo login (also used by the demo seed). */
export async function createLocalUser(email: string, password: string, fullName?: string): Promise<Result<{ id: string }>> {
  const normalized = email.trim().toLowerCase();
  const passwordHash = await hashPassword(password);
  const id = await asSystem(async (tx) => {
    const [row] = await tx
      .insert(localAuthUsers)
      .values({ email: normalized, passwordHash })
      .onConflictDoNothing()
      .returning({ id: localAuthUsers.id });
    return row?.id;
  });
  if (!id) return { ok: false, error: "An account with this email already exists" };
  await ensureProfile({ id, email: normalized }, fullName);
  return { ok: true, id };
}

export async function signOut(): Promise<void> {
  const mode = authMode();
  if (mode === "supabase") {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  (await cookies()).delete(LOCAL_SESSION_COOKIE);
}

/** Creates or refreshes the application profile for an authenticated user. */
export async function ensureProfile(user: AuthUser, fullName?: string) {
  const isAdmin = platformAdminEmails().includes(user.email.toLowerCase());
  await asSystem(async (tx) => {
    await tx
      .insert(profiles)
      .values({ id: user.id, email: user.email, fullName: fullName ?? null, isPlatformAdmin: isAdmin })
      .onConflictDoUpdate({
        target: profiles.id,
        set: {
          email: user.email,
          fullName: fullName ? fullName : sql`${profiles.fullName}`,
          // Platform admin is granted from configuration only; never self-assigned.
          isPlatformAdmin: isAdmin ? true : sql`${profiles.isPlatformAdmin}`,
        },
      });
  });
}
