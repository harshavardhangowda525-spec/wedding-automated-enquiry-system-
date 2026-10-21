import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/server/auth/supabase";
import { ensureProfile } from "@/server/auth/session";
import { acceptInvites } from "@/server/services/studios";
import { isSupabaseConfigured } from "@/server/env";

/** Supabase email-confirmation / magic-link callback: exchanges the code for a session. */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code || !isSupabaseConfigured()) return NextResponse.redirect(new URL("/login", request.url));
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user?.email) return NextResponse.redirect(new URL("/login?error=confirmation", request.url));
  const fullName = typeof data.user.user_metadata?.full_name === "string" ? data.user.user_metadata.full_name : undefined;
  await ensureProfile({ id: data.user.id, email: data.user.email.toLowerCase() }, fullName);
  await acceptInvites(data.user.id, data.user.email.toLowerCase());
  return NextResponse.redirect(new URL("/dashboard", request.url));
}
