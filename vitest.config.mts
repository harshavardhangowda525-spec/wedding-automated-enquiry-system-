import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    setupFiles: ["tests/setup.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    env: {
      APP_MODE: "demo",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/weddingflow_test",
      APP_SECRET: "test-secret-test-secret-test-secret-123",
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      AI_PROVIDER: "xai",
      XAI_API_KEY: "",
      AI_MODEL: "",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      WHATSAPP_APP_SECRET: "test-whatsapp-app-secret",
      WHATSAPP_VERIFY_TOKEN: "test-verify-token",
      CRON_SECRET: "test-cron-secret",
    },
  },
});
