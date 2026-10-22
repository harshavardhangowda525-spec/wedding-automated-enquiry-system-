import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase session cookie on navigation so Server Components see a
 * valid session. Authorization itself is enforced in server code, never here.
 */
export async function proxy(request: NextRequest) {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.trim().replace(/\/$/, "");
  const key = (process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim();
  let response = NextResponse.next({ request });
  if (!url || !key) return response;
  try {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
        },
      },
    });
    await supabase.auth.getUser();
  } catch (err) {
    // A session refresh failure (e.g. a mistyped Supabase URL or an outage) must not take the
    // whole site down. Pages still verify the user themselves and will ask them to sign in.
    console.error("[proxy] Supabase session refresh failed:", err instanceof Error ? err.message : err);
    return NextResponse.next({ request });
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/cron|api/health|enquire).*)"],
};
