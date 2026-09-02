// src/git-status-cache.ts
// Per-root snapshot cache with TTL + dirty invalidation, generic over the
// entry value. Used by fs-api to share one git-status run across the burst
// of listings triggered by a single change event (spec:
// docs/superpowers/specs/2026-09-02-git-status-cache-design.md).
// The module is git-agnostic: the collector is injected.

export interface CacheStats {
  roots: number;
  collects: number;
  hits: number;
  dirtyRoots: number;
}

export interface SnapshotCache<V> {
  get(root: string): Promise<Map<string, V>>;
  invalidate(root: string): void;
  stats(): CacheStats;
}

export interface CreateGitStatusCacheOptions<V> {
  collect(root: string): Promise<Map<string, V>>;
  ttlMs?: number;
  maxRoots?: number;
  now?: () => number;
}

export const DEFAULT_TTL_MS = 2000;
export const DEFAULT_MAX_ROOTS = 8;

interface CacheEntry<V> {
  map: Map<string, V>;
  dirty: boolean;
  lastAccess: number;
  computedAt: number;
  computing: Promise<Map<string, V>> | null;
}

export function createGitStatusCache<V>(
  options: CreateGitStatusCacheOptions<V>
): SnapshotCache<V> {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const maxRoots = options.maxRoots ?? DEFAULT_MAX_ROOTS;
  const now = options.now ?? (() => Date.now());
  const entries = new Map<string, CacheEntry<V>>();
  let collects = 0;
  let hits = 0;

  const evict = (): void => {
    while (entries.size > maxRoots) {
      let oldestKey: string | null = null;
      let oldestAccess = Infinity;
      for (const [key, entry] of entries) {
        if (entry.lastAccess < oldestAccess) {
          oldestAccess = entry.lastAccess;
          oldestKey = key;
        }
      }
      if (oldestKey === null) break;
      entries.delete(oldestKey);
    }
  };

  return {
    async get(root: string): Promise<Map<string, V>> {
      const existing = entries.get(root);
      if (existing) existing.lastAccess = now();
      // Join an in-flight run before the freshness check: an entry that is
      // computing holds only a placeholder map (computedAt 0), never a real
      // snapshot, so concurrent getters must await the shared promise.
      if (existing?.computing) return existing.computing;
      if (existing && !existing.dirty && now() - existing.computedAt < ttlMs) {
        hits += 1;
        return existing.map;
      }

      const promise = (async () => {
        let map: Map<string, V>;
        let failed = false;
        try {
          map = await options.collect(root);
        } catch {
          map = new Map();
          failed = true;
        }
        collects += 1;
        const current = entries.get(root);
        const dirtyDuringRun = current?.dirty ?? false;
        entries.set(root, {
          map,
          dirty: dirtyDuringRun || failed,
          lastAccess: now(),
          computedAt: now(),
          computing: null,
        });
        return map;
      })();

      entries.set(root, {
        map: new Map(),
        dirty: false,
        lastAccess: now(),
        computedAt: 0,
        computing: promise,
      });
      evict();
      return promise;
    },

    invalidate(root: string): void {
      const entry = entries.get(root);
      if (entry) entry.dirty = true;
    },

    stats(): CacheStats {
      let dirtyRoots = 0;
      for (const entry of entries.values()) {
        if (entry.dirty) dirtyRoots += 1;
      }
      return { roots: entries.size, collects, hits, dirtyRoots };
    },
  };
}
