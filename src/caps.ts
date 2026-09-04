// src/caps.ts
import { fetchCap } from "./preview-api.js";

export interface CapCache {
  getCap(hint: string): Promise<string>;
  invalidate(hint: string): void;
}

export function createCapCache(fetch: (hint: string) => Promise<string>): CapCache {
  const entries = new Map<string, Promise<string>>();
  return {
    getCap(hint: string): Promise<string> {
      let promise = entries.get(hint);
      if (!promise) {
        promise = fetch(hint).catch((error) => {
          entries.delete(hint);
          throw error;
        });
        entries.set(hint, promise);
      }
      return promise;
    },
    invalidate(hint: string): void {
      entries.delete(hint);
    },
  };
}

export const capCache: CapCache = createCapCache(fetchCap);
