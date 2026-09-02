# Git Status Cache — Design

**Status:** draft (phase A of the maturity roadmap, 2026-09-02).
**Scope:** server-side caching of the workspace git-status snapshot to cut
repeated full `git status` runs; watch strategy stays per-directory (W1).
**Spec for:** docs/superpowers/plans/2026-09-02-maturity-roadmap.md phase A.

## Problem

Every `GET /filemanager-fs/list` of any directory runs a full
`git status --ignored --porcelain` from the workspace root
(`src/fs-api.ts` → `runGitStatus`) with no caching:

- expanding one directory = one listing = one full git run;
- a `git-changed` SSE event makes the client refresh **every visible
  directory** (root + all expanded), so N listings = N full git runs in a
  burst;
- the polling fallback (every 5 s) polls every visible directory = N full
  git runs per cycle.

On large repositories each run costs hundreds of ms to seconds, so bursts
degrade interaction. The git snapshot is what actually changes on git
operations and on file edits inside the workspace.

## Decisions (agreed)

- **D1 (cache):** server-side snapshot cache with TTL + event invalidation
  (approach A1). Not a TTL-only cache (badges would lag after commits) and
  not client-side coalescing alone (N runs remain).
- **D2 (watchers):** keep per-directory `fs.watch` + the two git-metadata
  watchers (approach W1). No recursive watcher: `fs.watch` `recursive` is
  unsupported on Linux (CI + headless hosts), and a root-recursive watcher
  would deliver events for collapsed subtrees (`node_modules`, build dirs)
  that the current design deliberately never observes.

## Design

### 1. New module `src/git-status-cache.ts` (generic, no git logic)

GIT-agnostic snapshot cache with an injected collector so it is unit-testable
without a git binary:

```ts
export interface GitStatusCacheOptions {
  collect(root: string): Promise<Map<string, GitEntry>>; // or unknown map type
  ttlMs?: number;      // default GIT_STATUS_CACHE_TTL_MS = 2000
  maxRoots?: number;   // default 8 (LRU eviction)
  now?: () => number;  // injectable clock for tests
}

export interface GitStatusCache {
  get(root: string): Promise<Map<string, GitEntry>>;
  invalidate(root: string): void;
  stats(): { roots: number; collects: number; hits: number; dirtyRoots: number };
}
```

Per-root entry: `{ map, dirty, lastAccess, computedAt, computing: Promise | null }`.

Semantics of `get(root)`:

1. If an entry exists, is `!dirty`, and `now() - computedAt < ttlMs` —
   return the stored snapshot (read-only contract: callers must not mutate it).
2. Otherwise compute: if `computing` exists, await the shared promise (one
   in-flight run per root, concurrent listers wait for it). Else start a run,
   store the promise, and on resolution install `{ map, dirty: false, computedAt }`.
3. If `invalidate(root)` arrived while a run was in flight, the resolved
   entry is left `dirty: true` so the next `get` recollects (the in-flight
   result may already be stale relative to the invalidation).
4. `invalidate(root)` only flips `dirty` — O(1), no work, safe to call per
   fs event.
5. LRU eviction on `maxRoots` overflow, keyed by `lastAccess`.
6. The collector never rejects (current `runGitStatus` swallows errors into
   an empty map); if it ever did, `get` falls back to a fresh empty map and
   marks the entry dirty so the next call retries — a listing never fails
   because of git.

### 2. Wiring in `src/fs-api.ts`

- The cache instance is created **per `createHandler`** (constructor
  injection, not a module singleton):

  ```ts
  export function createHandler(
    defaultRoot: string,
    options?: { gitStatusCache?: GitStatusCache }
  )
  ```

  Tests inject a cache whose collector counts runs (no shared global state).
- In the `list` action, replace `await runGitStatus(root)` with
  `await gitCache.get(root)`. `runGitStatus` and its helpers stay
  unchanged; `debugCollectStatuses` stays uncached.
- The default instance is built with `collect: runGitStatus`, the exported
  TTL constant, and maxRoots 8.

### 3. Invalidation in `src/fs-events.ts`

`createEventsHandler(defaultRoot, gitCache?: GitStatusCache)` receives the
same instance created by `createHandler` (constructor injection — no import
cycle: fs-api already imports fs-events). Optional so existing fs-events
tests that construct the handler without a cache keep working (no-op default).

Invalidate on:

- **git-metadata writes**: inside `emitGitChanged` (watchers on `.git` and
  `.git/refs/heads`) call `gitCache?.invalidate(root)` before writing the
  SSE frame — commit/stage/checkout refresh badges promptly.
- **workspace fs events**: for every normalized change event written to the
  stream, call `gitCache?.invalidate(root)` — a file edit marks its parent
  dirty so the triggered listing recollects and the `modified` badge
  appears. This fixes a current limitation: today a content edit (no git
  metadata write) only updates the badge on the next git-changed event or
  manual refresh.

Dirty flags are cheap (O(1) per event), and the 250 ms client debounce
already coalesces the resulting refresh burst into one recompute.

### 4. Behavior and compatibility

- HTTP API, response shapes, and git badge logic are unchanged.
- Security/read-only invariants unchanged: `x-dsh-filemanager: 1` header,
  realpath + isInside containment, `GIT_OPTIONAL_LOCKS=0` in the spawned
  git, git never mutates the index.
- Freshness model:
  - burst (git-changed refresh of N dirs): 1 git run per burst;
  - polling cycle: 1 git run per cycle (first dir recollects after TTL);
  - panel closed, external edits: reopen lists after TTL elapsed → recompute;
  - events during an open panel: invalidation keeps badges ≤250 ms fresh.
- Cache keys are the realpath'd roots already produced by `resolveRoot` /
  `resolveStrictHint`, so list and events handlers address the same entry.

### 5. Testing

Unit (`test/git-status-cache.test.ts`), fake collector counting runs and an
injectable clock:

- fresh & clean entry → reuse, no recollect;
- `invalidate` → next get recollects once, then stays clean;
- TTL expiry → recollect;
- concurrent gets during a run → exactly one collect, both await it;
- invalidate during an in-flight run → result left dirty, next get recollects;
- per-root isolation; LRU eviction at `maxRoots`;
- collector rejection → empty-map fallback, entry dirty, listing never throws.

fs-api integration (extend `test/fs-api.test.ts` with an injected spy cache):

- two rapid lists of the same root → exactly one collect;
- cache invalidate between lists → second list reflects a newly created file
  badge.

fs-events (extend `test/fs-events.test.ts` with a spy cache):

- a git-metadata event and a normalized workspace event each call
  `invalidate(root)`.

Full gate: `npm run typecheck`, `npm test`, `npm run build`.

## Non-goals (parked)

- Recursive/platform watchers (W2); server-side SSE coalescing; client-side
  caches; listing pagination/UX; moving git-status logic into the cache
  module (it stays generic by design).

## Rollout

Single commit set on main after this spec is reviewed: new module + fs-api
wiring + fs-events invalidation + tests. No contract or schema change; no
user-visible UI change (only latency/badge freshness).
