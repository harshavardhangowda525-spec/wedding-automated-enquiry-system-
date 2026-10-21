import { afterAll } from "vitest";
import { closeDb } from "@/server/db/client";

afterAll(async () => {
  await closeDb();
});
