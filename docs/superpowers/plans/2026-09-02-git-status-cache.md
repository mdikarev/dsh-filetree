# Git Status Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Cut repeated full git status runs by caching the per-workspace snapshot on the host (TTL + event invalidation) so bursts of listings share one git run.

**Architecture:** A generic per-root snapshot cache module (collector injected, TTL, dirty flag, LRU) is instantiated once per fs-api handler and shared with the fs-events SSE handler, which invalidates on git-metadata writes and workspace fs events. Watch strategy stays per-directory (W1).

**Tech Stack:** TypeScript (node:test + tsx), existing fs-api.ts / fs-events.ts host code. No new runtime dependencies.

**Spec:** docs/superpowers/specs/2026-09-02-git-status-cache-design.md

## Global Constraints

- New module must stay git-agnostic: generic value type, collector injected.
- Default TTL 2000 ms; default maxRoots 8; clock injectable (now option).
- Cache instance is per createHandler (constructor injection, not a module singleton).
- createEventsHandler gains an optional gitCache parameter (minimal structural type: invalidate(root) only); optional so existing callers/tests keep working.
- HTTP API, response shapes, badge logic unchanged.
- Security/read-only invariants unchanged: x-dsh-filemanager header, realpath + isInside containment, GIT_OPTIONAL_LOCKS=0, git never mutates the index.
- Cache entries are read-only for callers (never mutate the returned map).
- Gate before every commit: npm run typecheck, npm test, npm run build all green.

## File Structure

- Create: src/git-status-cache.ts  (generic snapshot cache)
- Modify: src/fs-api.ts  (options param, default cache, list uses cache)
- Modify: src/fs-events.ts  (optional gitCache param + invalidate calls)
- Create: test/git-status-cache.test.ts
- Modify: test/fs-api.test.ts  (integration: reuse + invalidate)
- Modify: test/fs-events.test.ts  (invalidate on git and fs events)
- Modify: CHANGELOG.md, docs/superpowers/plans/2026-09-02-maturity-roadmap.md (final task)

---

### Task 1: git-status-cache module (generic snapshot cache)

**Files:**
- Create: src/git-status-cache.ts
- Test: test/git-status-cache.test.ts

**Interfaces:**
- Consumes: nothing.
- Produces (used by Tasks 2-3 and all later tests):

    export interface SnapshotCache<V> {
      get(root: string): Promise<Map<string, V>>;
      invalidate(root: string): void;
      stats(): CacheStats;
    }
    export interface CacheStats { roots: number; collects: number; hits: number; dirtyRoots: number; }
    export interface CreateGitStatusCacheOptions<V> {
      collect(root: string): Promise<Map<string, V>>;
      ttlMs?: number;      // default 2000
      maxRoots?: number;   // default 8
      now?: () => number;  // injectable clock
    }
    export const DEFAULT_TTL_MS = 2000;
    export const DEFAULT_MAX_ROOTS = 8;
    export function createGitStatusCache<V>(options: CreateGitStatusCacheOptions<V>): SnapshotCache<V>;

- [ ] **Step 1: Write the failing unit tests**

    Create test/git-status-cache.test.ts with a fake collector (counts runs, records roots) and an injectable clock:

        import { describe, it } from "node:test";
        import assert from "node:assert";
        import { createGitStatusCache } from "../src/git-status-cache.js";

        type Entry = { status: string; isDir: boolean };

        function makeCache(overrides?: {
          ttlMs?: number;
          maxRoots?: number;
          delayMs?: number;
          fail?: boolean;
        }) {
          const roots: string[] = [];
          let runs = 0;
          let time = 0;
          const cache = createGitStatusCache<Entry>({
            collect: async (root: string) => {
              roots.push(root);
              runs += 1;
              if (overrides?.delayMs) {
                await new Promise((r) => setTimeout(r, overrides.delayMs as number));
              }
              if (overrides?.fail) throw new Error("boom");
              const map = new Map<string, Entry>();
              map.set(root, { status: "modified", isDir: false });
              return map;
            },
            ttlMs: overrides?.ttlMs ?? 100,
            maxRoots: overrides?.maxRoots ?? 8,
            now: () => time,
          });
          return {
            cache,
            runs: () => runs,
            roots: () => roots,
            tick: (ms: number) => { time += ms; },
          };
        }

        describe("createGitStatusCache", () => {
          it("reuses a fresh, clean snapshot without recollecting", async () => {
            const c = makeCache();
            const first = await c.cache.get("r1");
            const second = await c.cache.get("r1");
            assert.strictEqual(c.runs(), 1);
            assert.strictEqual(first, second);
          });

          it("recollects once after invalidate, then stays clean", async () => {
            const c = makeCache();
            await c.cache.get("r1");
            c.cache.invalidate("r1");
            await c.cache.get("r1");
            assert.strictEqual(c.runs(), 2);
            await c.cache.get("r1");
            assert.strictEqual(c.runs(), 2);
          });

          it("recollects after the TTL expires", async () => {
            const c = makeCache();
            await c.cache.get("r1");
            c.tick(101);
            await c.cache.get("r1");
            assert.strictEqual(c.runs(), 2);
          });

          it("recollects when the snapshot is dirty (even inside TTL)", async () => {
            const c = makeCache({ ttlMs: 1000 });
            await c.cache.get("r1");
            c.cache.invalidate("r1");
            await c.cache.get("r1");
            assert.strictEqual(c.runs(), 2);
          });

          it("shares one in-flight run between concurrent getters", async () => {
            const c = makeCache({ delayMs: 30 });
            const [a, b] = await Promise.all([c.cache.get("r1"), c.cache.get("r1")]);
            assert.strictEqual(c.runs(), 1);
            assert.deepStrictEqual([...a.keys()], [...b.keys()]);
          });

          it("leaves the result dirty when invalidate arrives during a run", async () => {
            const c = makeCache({ delayMs: 30 });
            const pending = c.cache.get("r1");
            c.cache.invalidate("r1");
            await pending;
            assert.strictEqual(c.runs(), 1); // in-flight run completed
            await c.cache.get("r1");
            assert.strictEqual(c.runs(), 2); // result was dirty, so next get recollects
          });

          it("isolates roots and evicts least-recently-used past maxRoots", async () => {
            const c = makeCache({ ttlMs: 1000, maxRoots: 2 });
            await c.cache.get("a");
            await c.cache.get("b");
            await c.cache.get("a"); // refresh a's recency
            await c.cache.get("c"); // evicts b (least recently used)
            assert.strictEqual(c.cache.stats().roots, 2);
            const bSnap = await c.cache.get("b");
            assert.ok(bSnap.size > 0); // recollects the evicted root
            assert.strictEqual(c.runs(), 5);
          });

          it("falls back to an empty snapshot when the collector throws", async () => {
            const c = makeCache({ fail: true });
            const snap = await c.cache.get("r1");
            assert.strictEqual(snap.size, 0);
            assert.strictEqual(c.cache.stats().dirtyRoots, 1); // retried on next get
          });
        });

- [ ] **Step 2: Run the tests and confirm they fail**

    Run: npm test -- --test-name-pattern="createGitStatusCache"
    Expected: FAIL — module ../src/git-status-cache.js cannot be resolved (file does not exist yet).

- [ ] **Step 3: Implement src/git-status-cache.ts**

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
              if (existing && !existing.dirty && now() - existing.computedAt < ttlMs) {
                hits += 1;
                return existing.map;
              }
              if (existing?.computing) return existing.computing;

              const promise = (async () => {
                let map: Map<string, V>;
                try {
                  map = await options.collect(root);
                } catch {
                  map = new Map();
                }
                collects += 1;
                const current = entries.get(root);
                const dirtyDuringRun = current?.dirty ?? false;
                entries.set(root, {
                  map,
                  dirty: dirtyDuringRun,
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

- [ ] **Step 4: Run the unit tests and confirm they pass**

    Run: npm test -- --test-name-pattern="createGitStatusCache"
    Expected: PASS (all createGitStatusCache tests green).

- [ ] **Step 5: Run the full gate**

    Run: npm run typecheck && npm test && npm run build
    Expected: typecheck clean, 283+ existing + new tests pass, build complete.

- [ ] **Step 6: Commit**

    git add src/git-status-cache.ts test/git-status-cache.test.ts
    git commit -m "feat: generic git-status snapshot cache (TTL + dirty invalidation)"

---

### Task 2: Wire the cache into fs-api

**Files:**
- Modify: src/fs-api.ts (imports; createHandler signature; list action)
- Test: test/fs-api.test.ts (append a new describe block)

**Interfaces:**
- Consumes: Task 1 — createGitStatusCache<V>, SnapshotCache<V>; existing runGitStatus and debugCollectStatuses in fs-api.ts.
- Produces:

    export type GitStatusCache = SnapshotCache<GitEntry>;
    export interface CreateHandlerOptions { gitStatusCache?: GitStatusCache; }
    export function createHandler(defaultRoot: string, options?: CreateHandlerOptions): (req, res) => Promise<void>;

  Also passes the cache instance to createEventsHandler (Task 3 parameter).

- [ ] **Step 1: Write the failing integration tests**

    Append a new top-level describe block to test/fs-api.test.ts. It builds a real git fixture (mirroring the existing list fixture), a counting cache whose collector delegates to the exported, uncached debugCollectStatuses, and a handler created with the injected cache:

        describe("git-status cache integration", () => {
          let tempDir: string;
          let handler: ReturnType<typeof createHandler>;
          let collectCount: number;
          let invalidateRoot: (root: string) => void;

          before(async () => {
            tempDir = await mkdtemp(join(tmpdir(), "fs-api-cache-"));
            await writeFile(join(tempDir, "tracked.txt"), "one");
            await execFileAsync("git", ["init"], { cwd: tempDir });
            await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: tempDir });
            await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: tempDir });
            await execFileAsync("git", ["add", "tracked.txt"], { cwd: tempDir });
            await execFileAsync("git", ["commit", "-m", "init"], { cwd: tempDir });

            collectCount = 0;
            // fullCache keeps the real SnapshotCache<GitEntry> type for the
            // handler option; invalidateRoot is a narrow alias for assertions.
            const fullCache = createGitStatusCache({
              ttlMs: 60_000, // isolate TTL: only invalidation may trigger a rerun
              collect: async (root: string) => {
                collectCount += 1;
                return debugCollectStatuses(root);
              },
            });
            invalidateRoot = (root: string) => fullCache.invalidate(root);
            handler = createHandler(tempDir, { gitStatusCache: fullCache });
          });

          after(async () => {
            await rm(tempDir, { recursive: true, force: true });
          });

          it("shares one git run across a burst of listings", async () => {
            for (let i = 0; i < 3; i += 1) {
              const { status } = await request(
                handler,
                "/filemanager-fs/list?hint=" + encodeURIComponent(tempDir) + "&path=",
                { "x-dsh-filemanager": "1" }
              );
              assert.strictEqual(status, 200);
            }
            assert.strictEqual(collectCount, 1);
          });

          it("recomputes after invalidate and reflects a new untracked file", async () => {
            await writeFile(join(tempDir, "fresh.txt"), "new");
            invalidateRoot(tempDir);
            const { status, body } = await request(
              handler,
              "/filemanager-fs/list?hint=" + encodeURIComponent(tempDir) + "&path=",
              { "x-dsh-filemanager": "1" }
            );
            assert.strictEqual(status, 200);
            assert.strictEqual(collectCount, 2);
            const names = ((body as any).entries as Array<{ name: string }>).map((e) => e.name);
            assert.ok(names.includes("fresh.txt"), "new file must appear after invalidation");
            const fresh = ((body as any).entries as Array<{ name: string; gitStatus?: string }>).find(
              (e) => e.name === "fresh.txt"
            );
            assert.strictEqual(fresh?.gitStatus, "untracked");
          });
        });

    Add imports at the top of test/fs-api.test.ts:

        import { createGitStatusCache } from "../src/git-status-cache.js";
        import { createHandler, debugCollectStatuses } from "../src/fs-api.js";

    (debugCollectStatuses is already exported from fs-api.ts.)

- [ ] **Step 2: Run the tests and confirm the new block fails**

    Run: npm test -- --test-name-pattern="git-status cache integration"
    Expected: FAIL — createHandler does not accept options yet, or gitMap is recomputed per call (collectCount > 1).

- [ ] **Step 3: Implement the fs-api wiring**

    Add the import next to the existing fs-events import:

        import { createGitStatusCache, type SnapshotCache } from "./git-status-cache.js";

    Add exports after the GitStatus/GitEntry type declarations:

        export type GitStatusCache = SnapshotCache<GitEntry>;

        export interface CreateHandlerOptions {
          /** Override the per-handler git-status cache (tests inject spies). */
          gitStatusCache?: GitStatusCache;
        }

    Replace the createHandler signature and body head:

        export function createHandler(defaultRoot: string, options: CreateHandlerOptions = {}) {
          const gitCache =
            options.gitStatusCache ??
            createGitStatusCache<GitEntry>({ collect: runGitStatus });
          const eventsHandler = createEventsHandler(defaultRoot, gitCache);
          return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {

    In the list action, replace the git-map fetch:

        const gitMap = await runGitStatus(root);

    with:

        const gitMap = await gitCache.get(root);

    (runGitStatus stays untouched and remains the collector; debugCollectStatuses keeps calling it uncached.)

- [ ] **Step 4: Run the integration tests and confirm they pass**

    Run: npm test -- --test-name-pattern="git-status cache integration"
    Expected: PASS — one collect across three list calls; invalidate forces a second collect and the new file is reported untracked.

- [ ] **Step 5: Run the full gate**

    Run: npm run typecheck && npm test && npm run build
    Expected: green (all existing fs-api tests unchanged and passing).

- [ ] **Step 6: Commit**

    git add src/fs-api.ts test/fs-api.test.ts
    git commit -m "feat: share one git-status run across listing bursts (fs-api cache wiring)"

---

### Task 3: Invalidate the cache from fs-events

**Files:**
- Modify: src/fs-events.ts
- Test: test/fs-events.test.ts (append a new describe block)

**Interfaces:**
- Consumes: the cache object fs-api already passes (minimal structural type only).
- Produces:

    export function createEventsHandler(
      defaultRoot: string,
      gitCache?: { invalidate(root: string): void }
    ): (req, res) => Promise<void>;

- [ ] **Step 1: Write the failing tests**

    Append a describe block to test/fs-events.test.ts that instruments invalidations through the existing openSse helper (it uses createHandler, so the cache flows fs-api -> fs-events):

        describe("git-status cache invalidation", () => {
          let tempDir: string;
          let invalidated: string[];
          let handler: Handler;

          before(async () => {
            tempDir = await mkdtemp(join(tmpdir(), "fs-events-cache-"));
            await writeFile(join(tempDir, "tracked.txt"), "one");
            execFileSync("git", ["init"], { cwd: tempDir });
            execFileSync("git", ["config", "user.email", "t@e.c"], { cwd: tempDir });
            execFileSync("git", ["config", "user.name", "T"], { cwd: tempDir });
            execFileSync("git", ["add", "tracked.txt"], { cwd: tempDir });
            execFileSync("git", ["commit", "-m", "init"], { cwd: tempDir });

            invalidated = [];
            // The events handler only needs the invalidate half of the cache;
            // use the handler directly (openSse already targets the events URL).
            handler = createEventsHandler(tempDir, {
              invalidate: (root: string) => {
                invalidated.push(root);
              },
            });
          });

          after(async () => {
            await rm(tempDir, { recursive: true, force: true });
          });

          it("invalidates on a git metadata change (commit)", async () => {
            const conn = await openSse(handler, "hint=" + encodeURIComponent(tempDir) + "&paths=%5B%5D");
            try {
              await writeFile(join(tempDir, "tracked.txt"), "two");
              execFileSync("git", ["add", "tracked.txt"], { cwd: tempDir });
              execFileSync("git", ["commit", "-m", "second"], { cwd: tempDir });
              await waitFor(() => invalidated.length >= 1, { message: "git change did not invalidate" });
            } finally {
              await conn.close();
            }
          });

          it("invalidates on a workspace fs change", async () => {
            const conn = await openSse(handler, "hint=" + encodeURIComponent(tempDir) + "&paths=%5B%5D");
            try {
              const before = invalidated.length;
              await writeFile(join(tempDir, "note.txt"), "hello");
              await waitFor(() => invalidated.length > before, { message: "fs change did not invalidate" });
            } finally {
              await conn.close();
            }
          });
        });

    No new imports are needed in test/fs-events.test.ts: createEventsHandler, openSse, waitFor, Handler, execFileSync, mkdtemp/rm/writeFile/join/tmpdir already exist there.

    Note: paths=%5B%5D decodes to paths=[] (watch the root). openSse opens a fresh connection per test and targets the events URL, which the events handler serves directly.

- [ ] **Step 2: Run the tests and confirm the new block fails**

    Run: npm test -- --test-name-pattern="git-status cache invalidation"
    Expected: FAIL — invalidated stays empty (no invalidation wiring yet).

- [ ] **Step 3: Implement the invalidation in fs-events.ts**

    Change the createEventsHandler signature:

        export function createEventsHandler(
          defaultRoot: string,
          gitCache?: { invalidate(root: string): void }
        ) {

    Inside emitGitChanged (the git-metadata watcher callback), invalidate before writing the frame:

        const emitGitChanged = (): void => {
          if (disposed) return;
          gitCache?.invalidate(root);
          try {
            res.write("event: git-changed\ndata: " + JSON.stringify({ type: "git-changed" }) + "\n\n");
          } catch {
            // connection closing; close/error handlers own cleanup
          }
        };

    Inside the fs.watch callback, invalidate after a normalized event is produced (right before writing it):

        const norm = normalizeFsEvent(root, target, filename as string | Buffer, eventType as FsEventKind);
        if (!norm) return;
        gitCache?.invalidate(root);
        try {
          res.write("event: changed\ndata: " + JSON.stringify(norm) + "\n\n");
        } catch {
          // connection closing; close/error handlers own cleanup
        }

    gitCache is optional, so existing direct createEventsHandler(root) callers and tests are unaffected.

- [ ] **Step 4: Run the tests and confirm they pass**

    Run: npm test -- --test-name-pattern="git-status cache invalidation"
    Expected: PASS — commit triggers at least one invalidation; a workspace file write triggers another.

- [ ] **Step 5: Run the full gate**

    Run: npm run typecheck && npm test && npm run build
    Expected: green.

- [ ] **Step 6: Commit**

    git add src/fs-events.ts test/fs-events.test.ts
    git commit -m "feat: invalidate git-status cache on git metadata and workspace fs events"

---

### Task 4: Documentation status and final gate

**Files:**
- Modify: CHANGELOG.md
- Modify: docs/superpowers/plans/2026-09-02-maturity-roadmap.md

**Interfaces:**
- Consumes: Tasks 1-3 merged.
- Produces: nothing code-facing.

- [ ] **Step 1: Update the roadmap**

    In docs/superpowers/plans/2026-09-02-maturity-roadmap.md change the phase A row Status cell to done (append: done - this plan), keep the row text otherwise.

- [ ] **Step 2: Update the changelog**

    Under CHANGELOG.md Unreleased > Changed add one line:

        - Server caches the workspace git-status snapshot (TTL + event
          invalidation); bursts of refresh listings now share a single git run

- [ ] **Step 3: Run the full gate once more**

    Run: npm run typecheck && npm test && npm run build
    Expected: all green.

- [ ] **Step 4: Commit**

    git add CHANGELOG.md docs/superpowers/plans/2026-09-02-maturity-roadmap.md
    git commit -m "docs: mark phase A (git-status cache) complete"
