import "server-only";
import { z } from "zod";

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

/** Empty strings in .env files mean "not set". */
const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const num = <T extends z.ZodTypeAny>(inner: T) => z.preprocess(blank, inner);

const schema = z.object({
  APP_MODE: z.preprocess(blank, z.enum(["demo", "production"]).default("demo")),
  APP_URL: z.preprocess(blank, z.string().url().default("http://localhost:3000")),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  APP_SECRET: z.string().min(32, "APP_SECRET must be at least 32 characters"),
  ENCRYPTION_KEY: optional,

  // Supabase is only used on the server, so the unprefixed names are preferred.
  // The NEXT_PUBLIC_ names are still accepted for older configurations.
  SUPABASE_URL: optional,
  SUPABASE_ANON_KEY: optional,
  NEXT_PUBLIC_SUPABASE_URL: optional,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optional,

  AI_PROVIDER: z.preprocess(blank, z.enum(["xai", "none"]).default("xai")),
  XAI_API_KEY: optional,
  // Base URL is explicit so the app never inherits a base URL meant for other tooling.
  AI_BASE_URL: z.preprocess(blank, z.string().url().default("https://api.x.ai/v1")),
  AI_MODEL: optional,
  AI_TIMEOUT_MS: num(z.coerce.number().int().positive().default(30000)),
  AI_MAX_RETRIES: num(z.coerce.number().int().min(0).max(5).default(2)),
  AI_RATE_LIMIT_PER_HOUR: num(z.coerce.number().int().positive().default(120)),
  AI_PRICE_INPUT_PER_MTOK_USD: num(z.coerce.number().positive().optional()),
  AI_PRICE_OUTPUT_PER_MTOK_USD: num(z.coerce.number().positive().optional()),

  WHATSAPP_VERIFY_TOKEN: optional,
  WHATSAPP_APP_SECRET: optional,
  WHATSAPP_GRAPH_VERSION: z.preprocess(blank, z.string().default("v23.0")),

  SMTP_HOST: optional,
  SMTP_PORT: num(z.coerce.number().int().positive().default(587)),
  SMTP_USER: optional,
  SMTP_PASS: optional,
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  EMAIL_FROM: optional,

  CRON_SECRET: optional,
  PLATFORM_ADMIN_EMAILS: optional,
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const value = parsed.data;
  const supabaseUrl = value.SUPABASE_URL ?? value.NEXT_PUBLIC_SUPABASE_URL;
  if (supabaseUrl && !/^https?:\/\/[^/\s]+\/?$/.test(supabaseUrl)) {
    throw new Error("Invalid environment configuration: SUPABASE_URL must be the Supabase Project URL, e.g. https://abcdefgh.supabase.co");
  }
  if (value.APP_MODE === "production") {
    const missing: string[] = [];
    if (!supabaseUrl || !(value.SUPABASE_ANON_KEY ?? value.NEXT_PUBLIC_SUPABASE_ANON_KEY)) missing.push("SUPABASE_URL and SUPABASE_ANON_KEY");
    if (!value.ENCRYPTION_KEY) missing.push("ENCRYPTION_KEY");
    if (!value.CRON_SECRET) missing.push("CRON_SECRET");
    if (missing.length) {
      throw new Error(`Production mode requires: ${missing.join(", ")}`);
    }
  }
  cached = value;
  return value;
}

/** Test helper: forget the cached environment so tests can change process.env. */
export function resetEnvCache() {
  cached = undefined;
}

export const isDemoMode = () => env().APP_MODE === "demo";
/** Supabase project URL and anon/publishable key, or null when Supabase Auth is not configured. */
export function supabaseConfig(): { url: string; anonKey: string } | null {
  const e = env();
  const url = e.SUPABASE_URL ?? e.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = e.SUPABASE_ANON_KEY ?? e.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && anonKey ? { url: url.replace(/\/$/, ""), anonKey } : null;
}

export const isSupabaseConfigured = () => supabaseConfig() !== null;

export function platformAdminEmails(): string[] {
  return (env().PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
