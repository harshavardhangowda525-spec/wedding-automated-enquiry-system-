import { afterEach, describe, expect, it } from "vitest";
import { hashPassword, signLocalSession, verifyLocalSession, verifyPassword } from "@/server/auth/local";
import { decryptSecret, encryptSecret, hashIp } from "@/server/lib/crypto";
import { env, resetEnvCache } from "@/server/env";
import { renderTemplate, whatsappTemplateParams } from "@/server/messaging/templates";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  resetEnvCache();
});

describe("local demo authentication", () => {
  it("hashes passwords with a salt and verifies them", async () => {
    const a = await hashPassword("correct horse battery");
    const b = await hashPassword("correct horse battery");
    expect(a).not.toBe(b);
    expect(await verifyPassword("correct horse battery", a)).toBe(true);
    expect(await verifyPassword("wrong", a)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });

  it("signs sessions that cannot be forged", async () => {
    const token = await signLocalSession({ id: "11111111-1111-1111-1111-111111111111", email: "a@b.c" });
    expect(await verifyLocalSession(token)).toEqual({ id: "11111111-1111-1111-1111-111111111111", email: "a@b.c" });
    const [h, p] = token.split(".");
    const forged = `${h}.${Buffer.from(JSON.stringify({ sub: "x", email: "evil@x", aud: "weddingflow-demo" })).toString("base64url")}.${token.split(".")[2]}`;
    expect(await verifyLocalSession(forged)).toBeNull();
    expect(await verifyLocalSession(`${h}.${p}.invalid`)).toBeNull();
  });
});

describe("environment safety", () => {
  it("refuses production mode without Supabase, encryption key and cron secret", () => {
    process.env.APP_MODE = "production";
    process.env.ENCRYPTION_KEY = "";
    process.env.SUPABASE_URL = "";
    resetEnvCache();
    expect(() => env()).toThrow(/Production mode requires/);
  });

  it("treats blank optional values as unset", () => {
    process.env.AI_PRICE_INPUT_PER_MTOK_USD = "";
    process.env.AI_TIMEOUT_MS = "";
    resetEnvCache();
    expect(env().AI_PRICE_INPUT_PER_MTOK_USD).toBeUndefined();
    expect(env().AI_TIMEOUT_MS).toBe(30000);
  });
});

describe("secret handling", () => {
  it("encrypts integration secrets with authenticated encryption", () => {
    const enc = encryptSecret("EAAG-very-secret-token");
    expect(enc).not.toContain("very-secret");
    expect(decryptSecret(enc)).toBe("EAAG-very-secret-token");
    const tampered = enc.slice(0, -2) + (enc.endsWith("A") ? "B" : "A") + enc.slice(-1);
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("never stores raw IP addresses", () => {
    expect(hashIp("203.0.113.9")).toMatch(/^[0-9a-f]{32}$/);
    expect(hashIp("203.0.113.9")).not.toContain("203");
    expect(hashIp(null)).toBeNull();
  });
});

describe("message templates", () => {
  it("renders placeholders and maps WhatsApp parameters in order", () => {
    const body = "Hi {{contact_name}}, ref {{reference}} for {{event_type}} – {{unknown}}";
    const vars = { contact_name: "Ananya", reference: "ENQ-ABC123", event_type: "Wedding" };
    expect(renderTemplate(body, vars)).toBe("Hi Ananya, ref ENQ-ABC123 for Wedding –");
    expect(whatsappTemplateParams(body, vars)).toEqual(["Ananya", "ENQ-ABC123", "Wedding", ""]);
  });
});

describe("Supabase configuration", () => {
  it("prefers the server-only names, accepts the legacy public names and rejects invalid URLs", async () => {
    const { supabaseConfig } = await import("@/server/env");
    process.env.SUPABASE_URL = "https://abcdefgh.supabase.co/";
    process.env.SUPABASE_ANON_KEY = "anon-key";
    resetEnvCache();
    expect(supabaseConfig()).toEqual({ url: "https://abcdefgh.supabase.co", anonKey: "anon-key" });

    process.env.SUPABASE_URL = "";
    process.env.SUPABASE_ANON_KEY = "";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://legacy.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "legacy-key";
    resetEnvCache();
    expect(supabaseConfig()).toEqual({ url: "https://legacy.supabase.co", anonKey: "legacy-key" });

    process.env.SUPABASE_URL = "https://supabase.com/dashboard/project/abcdefgh";
    resetEnvCache();
    expect(() => env()).toThrow(/Project URL/);
    process.env.SUPABASE_URL = "abcdefgh";
    resetEnvCache();
    expect(() => env()).toThrow(/Project URL/);
  });
});
