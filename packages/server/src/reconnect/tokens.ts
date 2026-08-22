import { randomBytes, createHash, timingSafeEqual } from "crypto";
import { RECONNECT_TOKEN_BYTES } from "@fairy/shared";

/** Generates a fresh secret reconnect token. Sent to the client exactly once, at join/create time. */
export function generateReconnectToken(): string {
  return randomBytes(RECONNECT_TOKEN_BYTES).toString("hex");
}

/** The server never stores the raw token — only its hash, so a memory dump / log leak can't be replayed as a seat claim. */
export function hashReconnectToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function verifyReconnectToken(token: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashReconnectToken(token), "hex");
  const stored = Buffer.from(storedHash, "hex");
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}
