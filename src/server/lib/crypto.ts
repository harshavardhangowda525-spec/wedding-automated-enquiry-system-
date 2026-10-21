import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt } from "node:crypto";
import { env } from "@/server/env";

function encryptionKey(): Buffer {
  const raw = env().ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY is not configured; cannot store integration secrets");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return key;
}

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(payload: string): string {
  const [v, iv, tag, ct] = payload.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unrecognised secret format");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

/** Keyed hash so IP addresses are never stored in clear text. */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return createHmac("sha256", env().APP_SECRET).update(ip).digest("hex").slice(0, 32);
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O/1/I
export function randomCode(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}
