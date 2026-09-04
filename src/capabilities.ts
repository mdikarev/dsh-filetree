// src/capabilities.ts
import { randomBytes, timingSafeEqual } from "node:crypto";

export const DEFAULT_CAP_TTL_MS = 8 * 60 * 60 * 1000;

export interface CapabilityIssuer {
  issueFor(hint: string): string;
  isValid(hint: string, token: string): boolean;
}

export interface CapabilityIssuerOptions {
  now?: () => number;
  randomToken?: () => string;
  ttlMs?: number;
}

function constantTimeEqual(a: string, b: string): boolean {
  // Opaque compare: tokens are hex in production but injected fakes in tests
  // are arbitrary strings; decode utf8 so equal non-hex tokens validate too.
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length > 0 && ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function createCapabilityIssuer(options: CapabilityIssuerOptions = {}): CapabilityIssuer {
  const now = options.now ?? Date.now;
  const randomToken = options.randomToken ?? (() => randomBytes(32).toString("hex"));
  const ttlMs = options.ttlMs ?? DEFAULT_CAP_TTL_MS;
  const store = new Map<string, { token: string; expiresAt: number }>();

  return {
    issueFor(hint: string): string {
      const token = randomToken();
      store.set(hint, { token, expiresAt: now() + ttlMs });
      return token;
    },
    isValid(hint: string, token: string): boolean {
      const entry = store.get(hint);
      if (!entry) return false;
      if (now() >= entry.expiresAt) {
        store.delete(hint);
        return false;
      }
      return constantTimeEqual(entry.token, token);
    },
  };
}
