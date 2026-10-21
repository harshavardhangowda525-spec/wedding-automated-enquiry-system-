import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { AiInvalidOutputError, AiProviderError, XaiProvider } from "@/server/ai/provider";

/**
 * Exercises the real xAI provider code (request shape, structured output parsing, retries,
 * refusal handling) against a local stand-in for the Chat Completions API. No network, no key.
 */
let server: Server;
let baseURL = "";
const seen: { headers: IncomingMessage["headers"]; body: Record<string, unknown> }[] = [];
let reply: (n: number) => { status: number; body: unknown } = () => ({ status: 200, body: {} });

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      seen.push({ headers: req.headers, body: JSON.parse(raw || "{}") });
      const { status, body } = reply(seen.length);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const completion = (content: string | null, finish_reason = "stop", extra: Record<string, unknown> = {}) => ({
  status: 200,
  body: {
    id: "chatcmpl-test",
    object: "chat.completion",
    model: "grok-test-model",
    choices: [{ index: 0, finish_reason, message: { role: "assistant", content, ...extra } }],
    usage: { prompt_tokens: 321, completion_tokens: 45, total_tokens: 366 },
  },
});

const schema = z.object({ summary: z.string(), missingInformation: z.array(z.string()) });
const provider = (maxRetries = 0) => new XaiProvider("xai-test-key", "grok-test-model", { baseURL, timeoutMs: 5000, maxRetries });

describe("XaiProvider (against a local Chat Completions stand-in)", () => {
  it("sends a JSON-schema structured output request and returns validated data", async () => {
    reply = () => completion(JSON.stringify({ summary: "Wedding in Goa", missingInformation: ["Venue"] }));
    const before = seen.length;
    const result = await provider().generate({ system: "rules", prompt: "context", schema, maxTokens: 500 });
    expect(result).toEqual({ data: { summary: "Wedding in Goa", missingInformation: ["Venue"] }, model: "grok-test-model", inputTokens: 321, outputTokens: 45 });

    const req = seen[before];
    expect(req.headers.authorization).toBe("Bearer xai-test-key");
    expect(req.body).toMatchObject({
      model: "grok-test-model",
      max_tokens: 500,
      messages: [
        { role: "system", content: "rules" },
        { role: "user", content: "context" },
      ],
      response_format: { type: "json_schema", json_schema: { name: "result", strict: true } },
    });
    const sent = (req.body.response_format as { json_schema: { schema: Record<string, unknown> } }).json_schema.schema;
    expect(sent).toMatchObject({ type: "object", required: ["summary", "missingInformation"], additionalProperties: false });
    expect(sent.$schema).toBeUndefined();
  });

  it("retries rate limits and server errors, then succeeds", async () => {
    const start = seen.length;
    reply = (n) => (n - start <= 2 ? { status: n - start === 1 ? 429 : 503, body: { error: "busy" } } : completion(JSON.stringify({ summary: "ok", missingInformation: [] })));
    const result = await provider(2).generate({ system: "s", prompt: "p", schema });
    expect(result.data.summary).toBe("ok");
    expect(seen.length - start).toBe(3);
  });

  it("does not retry client errors and reports them as provider errors", async () => {
    const start = seen.length;
    reply = () => ({ status: 401, body: { error: "Incorrect API key" } });
    await expect(provider(3).generate({ system: "s", prompt: "p", schema })).rejects.toBeInstanceOf(AiProviderError);
    expect(seen.length - start).toBe(1);
  });

  it("rejects refusals, truncation, empty and schema-violating output", async () => {
    reply = () => completion(null, "stop", { refusal: "I can't help with that" });
    await expect(provider().generate({ system: "s", prompt: "p", schema })).rejects.toBeInstanceOf(AiInvalidOutputError);
    reply = () => completion('{"summary": "cut', "length");
    await expect(provider().generate({ system: "s", prompt: "p", schema })).rejects.toBeInstanceOf(AiInvalidOutputError);
    reply = () => completion("");
    await expect(provider().generate({ system: "s", prompt: "p", schema })).rejects.toBeInstanceOf(AiInvalidOutputError);
    reply = () => completion(JSON.stringify({ summary: 42 }));
    await expect(provider().generate({ system: "s", prompt: "p", schema })).rejects.toBeInstanceOf(AiInvalidOutputError);
  });
});
