import "server-only";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import type { ActionState } from "@/lib/action-state";
import { AiInvalidOutputError, AiUnavailableError } from "@/server/ai/provider";
import { AppError, ValidationError } from "@/server/lib/errors";

/**
 * Wraps a server action: converts known errors into user-facing messages and lets
 * Next.js navigation signals (redirect/notFound) pass through.
 */
export async function runAction(fn: () => Promise<string | void | ActionState>): Promise<ActionState> {
  try {
    const result = await fn();
    if (typeof result === "string") return { ok: true, message: result, at: Date.now() };
    return { ok: true, at: Date.now(), ...(result ?? {}) };
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof ValidationError) return { ok: false, error: err.message, fieldErrors: err.fieldErrors, at: Date.now() };
    if (err instanceof ZodError) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of err.issues) (fieldErrors[String(issue.path[0] ?? "form")] ??= []).push(issue.message);
      return { ok: false, error: "Please check the highlighted fields.", fieldErrors, at: Date.now() };
    }
    if (err instanceof AiUnavailableError) return { ok: false, error: `AI unavailable: ${err.reason}`, at: Date.now() };
    if (err instanceof AiInvalidOutputError) return { ok: false, error: `${err.message}. Nothing was saved; please try again or continue manually.`, at: Date.now() };
    if (err instanceof AppError) return { ok: false, error: err.message, at: Date.now() };
    console.error("[action] unexpected error:", err);
    return { ok: false, error: "Something went wrong. Please try again.", at: Date.now() };
  }
}

export function str(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
}
export function optStr(form: FormData, key: string): string | undefined {
  const v = str(form, key).trim();
  return v === "" ? undefined : v;
}
export function bool(form: FormData, key: string): boolean {
  const v = form.get(key);
  return v === "on" || v === "true" || v === "1";
}
