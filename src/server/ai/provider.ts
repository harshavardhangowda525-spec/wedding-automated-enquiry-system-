import "server-only";
import { z } from "zod";
import { env } from "@/server/env";

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

/** An HTTP or network failure talking to the provider (reported to users as "AI unavailable"). */
export class AiProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

type ChatCompletionResponse = {
  model?: string;
  choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string } | string;
};

/**
 * xAI Grok via its Chat Completions endpoint (`POST {baseURL}/chat/completions`) with
 * JSON-schema structured outputs. Requests have a timeout and bounded retries with
 * exponential backoff for rate limits, server errors and network failures.
 */
export class XaiProvider implements AiProvider {
  name = "xai";
  constructor(
    private readonly apiKey: string,
    public readonly model: string,
    private readonly opts: { baseURL: string; timeoutMs: number; maxRetries: number; fetchImpl?: typeof fetch },
  ) {}

  async generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>> {
    const { $schema: _ignored, ...schema } = z.toJSONSchema(req.schema, { target: "draft-7" }) as Record<string, unknown>;
    const body = {
      model: this.model,
      max_tokens: req.maxTokens ?? 4000,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.prompt },
      ],
      response_format: { type: "json_schema", json_schema: { name: "result", schema, strict: true } },
    };
    const json = await this.post(body);
    const choice = json.choices?.[0];
    if (choice?.message?.refusal) throw new AiInvalidOutputError("The AI model declined this request");
    if (choice?.finish_reason === "length") throw new AiInvalidOutputError("The AI response was cut off before it finished");
    const content = choice?.message?.content;
    if (!content) throw new AiInvalidOutputError("The AI returned an empty response");
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new AiInvalidOutputError("The AI response did not match the expected format");
    }
    const validated = req.schema.safeParse(parsed);
    if (!validated.success) throw new AiInvalidOutputError("The AI response did not match the expected format");
    return {
      data: validated.data,
      model: json.model ?? this.model,
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
    };
  }

  private async post(body: unknown): Promise<ChatCompletionResponse> {
    const doFetch = this.opts.fetchImpl ?? fetch;
    const url = `${this.opts.baseURL.replace(/\/$/, "")}/chat/completions`;
    let lastError: AiProviderError | undefined;
    for (let attempt = 0; attempt <= this.opts.maxRetries; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, Math.min(500 * 2 ** (attempt - 1), 8000) * (1 + Math.random() * 0.2)));
      let res: Response;
      try {
        res = await doFetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.opts.timeoutMs),
        });
      } catch (err) {
        lastError = new AiProviderError(`Network error contacting xAI: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      const json = (await res.json().catch(() => ({}))) as ChatCompletionResponse;
      if (res.ok) return json;
      const detail = typeof json.error === "string" ? json.error : (json.error?.message ?? `HTTP ${res.status}`);
      lastError = new AiProviderError(`xAI API error (${res.status}): ${detail}`, res.status);
      if (!RETRYABLE_STATUS.has(res.status)) break;
    }
    throw lastError ?? new AiProviderError("xAI request failed");
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
  if (!e.XAI_API_KEY) throw new AiUnavailableError("AI is not configured (XAI_API_KEY is not set)");
  if (!e.AI_MODEL) throw new AiUnavailableError("AI is not configured (AI_MODEL is not set)");
  return new XaiProvider(e.XAI_API_KEY, e.AI_MODEL, { baseURL: e.AI_BASE_URL, timeoutMs: e.AI_TIMEOUT_MS, maxRetries: e.AI_MAX_RETRIES });
}

export function aiConfigured(): boolean {
  try {
    getAiProvider();
    return true;
  } catch {
    return false;
  }
}
