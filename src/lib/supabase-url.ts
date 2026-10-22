/**
 * Accepts the various addresses Supabase shows and returns the Project URL origin
 * (https://<ref>.supabase.co), or an explanation of what is wrong.
 *   https://abcd….supabase.co            → as is
 *   https://abcd….supabase.co/rest/v1/   → path removed
 *   https://supabase.com/dashboard/project/abcd…  → https://abcd….supabase.co
 *   abcd…  (project ref only)            → https://abcd….supabase.co
 */
export function normalizeSupabaseUrl(raw: string): { url: string } | { error: string } {
  const value = raw.trim().replace(/^["']|["']$/g, "").trim();
  if (/^(eyJ|sb_)/.test(value)) return { error: "SUPABASE_URL contains an API key, not the Project URL" };
  const dashboard = value.match(/supabase\.com\/dashboard\/project\/([a-z0-9]{15,40})/i);
  if (dashboard) return { url: `https://${dashboard[1].toLowerCase()}.supabase.co` };
  if (/^[a-z0-9]{15,40}$/i.test(value)) return { url: `https://${value.toLowerCase()}.supabase.co` };
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const parsed = new URL(withScheme);
    if (!parsed.hostname.includes(".")) throw new Error("no host");
    return { url: parsed.origin };
  } catch {
    return { error: "SUPABASE_URL must be the Supabase Project URL, e.g. https://abcdefgh.supabase.co" };
  }
}
