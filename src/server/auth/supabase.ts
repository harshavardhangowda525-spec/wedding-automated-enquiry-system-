import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseConfig } from "@/server/env";

/** A per-request Supabase client bound to the request cookies (never reuse across requests). */
export async function createSupabaseServerClient() {
  const config = supabaseConfig();
  if (!config) throw new Error("Supabase is not configured");
  const { url, anonKey: key } = config;
  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component, where cookies are read-only. The proxy refreshes the
          // session cookies on every request, so this is safe to ignore here.
        }
      },
    },
  });
}
