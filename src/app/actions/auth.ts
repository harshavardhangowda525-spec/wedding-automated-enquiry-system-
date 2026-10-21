"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { ACTIVE_STUDIO_COOKIE, getMemberships, requireUser } from "@/server/auth/context";
import { signInWithPassword, signOut, signUpWithPassword } from "@/server/auth/session";
import { AppError, RateLimitError } from "@/server/lib/errors";
import { checkRateLimit, isRateLimited } from "@/server/lib/rate-limit";
import { clientIpHash } from "@/server/lib/request";
import { acceptInvites, createStudio, slugify } from "@/server/services/studios";
import { runAction, str } from "./_run";

const credentials = z.object({
  email: z.string().trim().email("Enter a valid email"),
  password: z.string().min(8, "At least 8 characters").max(200),
});

const ATTEMPTS = 10;
const WINDOW_SECONDS = 15 * 60;
const limitKey = async (kind: string) => `auth:${kind}:${(await clientIpHash()) ?? "unknown"}`;

/** Blocks a connection after too many failed attempts (successful attempts are not counted). */
async function limit(kind: string) {
  if (await isRateLimited(await limitKey(kind), ATTEMPTS, WINDOW_SECONDS)) throw new RateLimitError("Too many attempts. Please wait a few minutes.");
}
async function recordFailure(kind: string) {
  await checkRateLimit(await limitKey(kind), ATTEMPTS, WINDOW_SECONDS);
}

export async function signInAction(_: ActionState, form: FormData): Promise<ActionState> {
  const result = await runAction(async () => {
    await limit("signin");
    const data = credentials.parse({ email: str(form, "email"), password: str(form, "password") });
    const res = await signInWithPassword(data.email, data.password);
    if (!res.ok) {
      await recordFailure("signin");
      throw new AppError(res.error);
    }
  });
  if (!result.ok) return result;
  const user = await requireUser();
  await acceptInvites(user.id, user.email);
  redirect("/dashboard");
}

export async function signUpAction(_: ActionState, form: FormData): Promise<ActionState> {
  let needsConfirmation = false;
  const result = await runAction(async () => {
    await limit("signup");
    const data = credentials.extend({ fullName: z.string().trim().min(2, "Enter your name").max(120) }).parse({
      email: str(form, "email"),
      password: str(form, "password"),
      fullName: str(form, "fullName"),
    });
    // Every sign-up attempt counts, to slow down account creation abuse.
    await recordFailure("signup");
    const res = await signUpWithPassword(data.email, data.password, data.fullName);
    if (!res.ok) throw new AppError(res.error);
    needsConfirmation = res.needsConfirmation;
  });
  if (!result.ok) return result;
  if (needsConfirmation) return { ok: true, message: "Check your inbox to confirm your email address, then sign in.", at: Date.now() };
  const user = await requireUser();
  await acceptInvites(user.id, user.email);
  redirect("/onboarding");
}

export async function signOutAction() {
  await signOut();
  redirect("/login");
}

export async function createStudioAction(_: ActionState, form: FormData): Promise<ActionState> {
  let studioId = "";
  const result = await runAction(async () => {
    const user = await requireUser();
    const name = str(form, "name");
    const studio = await createStudio(user.id, {
      name,
      slug: str(form, "slug") || slugify(name),
      businessType: str(form, "businessType") as "photo_video",
      city: str(form, "city") || undefined,
      phone: str(form, "phone") || undefined,
      email: str(form, "email") || undefined,
    });
    studioId = studio.id;
  });
  if (!result.ok) return result;
  (await cookies()).set(ACTIVE_STUDIO_COOKIE, studioId, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
  redirect("/settings?welcome=1");
}

export async function switchStudioAction(form: FormData) {
  const user = await requireUser();
  const id = str(form, "studioId");
  const memberships = await getMemberships(user.id);
  if (memberships.some((m) => m.studio.id === id)) {
    (await cookies()).set(ACTIVE_STUDIO_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
  }
  redirect("/dashboard");
}
