import "server-only";
import { headers } from "next/headers";
import { hashIp } from "./crypto";

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

export async function clientIpHash(): Promise<string | null> {
  return hashIp(await clientIp());
}
