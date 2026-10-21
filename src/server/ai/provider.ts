import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { env } from "@/server/env";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

export type GenerateRequest<T> = {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
};

export type GenerateResult<T> = {
  data: T;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export interface AiProvider {
  name: string;
  model: string;
  generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>>;
}

export class AiUnavailableError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "AiUnavailableError";
  }
}

/** The model returned output that failed schema validation, or declined the request. */
export class AiInvalidOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiInvalidOutputError";
  }
}

// Models that accept the server-side refusal fallback (`fallbacks: "default"`).
const FALLBACK_CAPABLE = /^claude-(opus-5|opus-5-5|fable-5-1|sonnet-5-5)$/;

export class AnthropicProvider implements AiProvider {
  name = "anthropic";
  private client: Anthropic;
  constructor(
    apiKey: string,
    public readonly model: string,
    opts: { baseURL: string; timeoutMs: number; maxRetries: number },
  ) {
    // The SDK retries 408/409/429/5xx and connection errors with backoff (bounded by maxRetries).
    this.client = new Anthropic({ apiKey, baseURL: opts.baseURL, timeout: opts.timeoutMs, maxRetries: opts.maxRetries });
  }

  async generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>> {
    const useFallback = FALLBACK_CAPABLE.test(this.model);
    let response;
    try {
      response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: req.maxTokens ?? 4000,
        system: req.system,
        messages: [{ role: "user", content: req.prompt }],
        output_config: { format: betaZodOutputFormat(req.schema) },
        ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      });
    } catch (err) {
      // HTTP/API failures propagate (the caller reports "AI unavailable"); anything else is the
      // SDK failing to parse the model's output (e.g. after a refusal or truncation).
      if (err instanceof Anthropic.APIError) throw err;
      throw new AiInvalidOutputError("The AI response did not match the expected format");
    }
    if (response.stop_reason === "refusal") throw new AiInvalidOutputError("The AI model declined this request");
    if (response.stop_reason === "max_tokens") throw new AiInvalidOutputError("The AI response was cut off before it finished");
    if (response.parsed_output === null || response.parsed_output === undefined) {
      throw new AiInvalidOutputError("The AI response did not match the expected format");
    }
    return {
      data: response.parsed_output as T,
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }
}

let override: AiProvider | null | undefined;
/** Test hook: inject a fake provider (or null to simulate "not configured"). */
export function setAiProviderForTests(provider: AiProvider | null | undefined) {
  override = provider;
}

/** Returns the configured provider, or throws AiUnavailableError explaining why it is unavailable. */
export function getAiProvider(): AiProvider {
  if (override !== undefined) {
    if (override === null) throw new AiUnavailableError("AI is not configured");
    return override;
  }
  const e = env();
  if (e.AI_PROVIDER === "none") throw new AiUnavailableError("AI features are disabled by configuration");
  if (!e.ANTHROPIC_API_KEY) throw new AiUnavailableError("AI is not configured (ANTHROPIC_API_KEY is not set)");
  return new AnthropicProvider(e.ANTHROPIC_API_KEY, e.AI_MODEL ?? DEFAULT_ANTHROPIC_MODEL, {
    baseURL: e.AI_BASE_URL,
    timeoutMs: e.AI_TIMEOUT_MS,
    maxRetries: e.AI_MAX_RETRIES,
  });
}

export function aiConfigured(): boolean {
  try {
    getAiProvider();
    return true;
  } catch {
    return false;
  }
}
