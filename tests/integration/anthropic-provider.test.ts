import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { AiInvalidOutputError, AnthropicProvider } from "@/server/ai/provider";

/**
 * Exercises the real Anthropic SDK code path (request shape, structured output parsing,
 * refusal handling) against a local stand-in for the Messages API. No network, no key.
 */
let server: Server;
let baseURL = "";
const seen: { headers: IncomingMessage["headers"]; body: Record<string, unknown> }[] = [];
let reply: (body: Record<string, unknown>) => Record<string, unknown> = () => ({});

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      seen.push({ headers: req.headers, body });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(reply(body)));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const message = (text: string, stop_reason = "end_turn") => ({
  id: "msg_test",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content: [{ type: "text", text }],
  stop_reason,
  stop_sequence: null,
  usage: { input_tokens: 321, output_tokens: 45 },
});

const schema = z.object({ summary: z.string(), missingInformation: z.array(z.string()) });

describe("AnthropicProvider (real SDK against a local API stand-in)", () => {
  it("sends a structured-output request and parses validated JSON", async () => {
    reply = () => message(JSON.stringify({ summary: "Wedding in Goa", missingInformation: ["Venue"] }));
    const provider = new AnthropicProvider("sk-ant-test", "claude-opus-5-5", { baseURL, timeoutMs: 5000, maxRetries: 0 });
    const result = await provider.generate({ system: "rules", prompt: "context", schema, maxTokens: 500 });
    expect(result.data).toEqual({ summary: "Wedding in Goa", missingInformation: ["Venue"] });
    expect(result).toMatchObject({ inputTokens: 321, outputTokens: 45, model: "claude-opus-5-5" });

    const req = seen.at(-1)!;
    expect(req.headers["x-api-key"]).toBe("sk-ant-test");
    expect(String(req.headers["anthropic-beta"])).toContain("server-side-fallback-2026-07-01");
    expect(req.body).toMatchObject({ model: "claude-opus-5-5", max_tokens: 500, system: "rules", fallbacks: "default" });
    expect((req.body.output_config as { format: { type: string } }).format.type).toBe("json_schema");
    expect(req.body.thinking).toBeUndefined();
  });

  it("does not send fallback parameters for models that do not support them", async () => {
    reply = () => message(JSON.stringify({ summary: "x", missingInformation: [] }));
    const provider = new AnthropicProvider("sk-ant-test", "claude-haiku-5-5", { baseURL, timeoutMs: 5000, maxRetries: 0 });
    await provider.generate({ system: "s", prompt: "p", schema });
    expect(seen.at(-1)!.body.fallbacks).toBeUndefined();
  });

  it("treats refusals and truncated output as invalid output", async () => {
    const provider = new AnthropicProvider("sk-ant-test", "claude-opus-5-5", { baseURL, timeoutMs: 5000, maxRetries: 0 });
    reply = () => message("", "refusal");
    await expect(provider.generate({ system: "s", prompt: "p", schema })).rejects.toBeInstanceOf(AiInvalidOutputError);
    reply = () => message('{"summary": "cut', "max_tokens");
    await expect(provider.generate({ system: "s", prompt: "p", schema })).rejects.toBeInstanceOf(AiInvalidOutputError);
  });
});
