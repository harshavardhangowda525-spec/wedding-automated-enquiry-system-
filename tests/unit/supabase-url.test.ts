import { describe, expect, it } from "vitest";
import { normalizeSupabaseUrl } from "@/lib/supabase-url";

const ok = { url: "https://abcdefghijklmnopqrst.supabase.co" };

describe("normalizeSupabaseUrl", () => {
  it("accepts every address form Supabase shows", () => {
    expect(normalizeSupabaseUrl("https://abcdefghijklmnopqrst.supabase.co")).toEqual(ok);
    expect(normalizeSupabaseUrl("https://abcdefghijklmnopqrst.supabase.co/")).toEqual(ok);
    expect(normalizeSupabaseUrl("https://abcdefghijklmnopqrst.supabase.co/rest/v1/")).toEqual(ok);
    expect(normalizeSupabaseUrl("  'https://abcdefghijklmnopqrst.supabase.co'  ")).toEqual(ok);
    expect(normalizeSupabaseUrl("abcdefghijklmnopqrst.supabase.co")).toEqual(ok);
    expect(normalizeSupabaseUrl("https://supabase.com/dashboard/project/abcdefghijklmnopqrst/settings/api")).toEqual(ok);
    expect(normalizeSupabaseUrl("abcdefghijklmnopqrst")).toEqual(ok);
  });

  it("explains what is wrong otherwise", () => {
    expect(normalizeSupabaseUrl("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.x.y")).toEqual({ error: expect.stringMatching(/API key/) });
    expect(normalizeSupabaseUrl("sb_publishable_123")).toEqual({ error: expect.stringMatching(/API key/) });
    expect(normalizeSupabaseUrl("hello world")).toEqual({ error: expect.stringMatching(/Project URL/) });
  });
});
