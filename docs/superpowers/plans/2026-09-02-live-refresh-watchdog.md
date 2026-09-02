# Live-Refresh Watchdog + Poller/Hint Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Detect a stalled live-refresh SSE connection (server heartbeat + client inactivity watchdog with fallback to polling) and make the polling fallback always target the current workspace after setHint (Panel adopts setHint with a hint-ref-backed listDir).

**Architecture:** fs-events emits periodic event: ping blocks; the live-refresh coordinator owns one inactivity timer reset by open/changed/git-changed/ping that fires into the existing error path (reconnect + poller + onError); Panel keeps a single coordinator per open panel and routes hint changes through setHint with listDir reading a hint ref.

**Tech Stack:** TypeScript, node:test + tsx, existing fs-events.ts / live-refresh.ts / Panel.tsx. No new runtime dependencies.

**Spec:** docs/superpowers/specs/2026-09-02-live-refresh-watchdog-design.md

## Global Constraints

- Server heartbeat: SSE_HEARTBEAT_MS = 10000 default; createEventsHandler(defaultRoot, gitCache?, opts?: { heartbeatMs?: number }); interval cleared in dispose; no writes after dispose.
- Client watchdog: LIVE_REFRESH_INACTIVITY_MS = 30000 default; options.inactivityMs injectable; one timer per coordinator; reset on open, changed, git-changed, ping; fire = onError + closeSource + scheduleReconnect + startPoller (the existing error path); cleared in stop().
- B2: single coordinator for the lifetime of an open panel; hint changes call setHint; listDir reads current hint through a ref; coordinator-dependent callbacks (refreshRootEntries via hintRef, handleRefreshDirs, listDirStable) stay stable across hint changes so the coordinator is not recreated per hint.
- Effect ordering in Panel: store.setWorkspace effect and coordinator-creation effect run before the setHint effect.
- SSE framing/client parser unchanged; ping is a new ignorable event type. Security/containment invariants and fs-api response shapes unchanged.
- Gate before every commit: npm run typecheck && npm test && npm run build (currently 295 tests).

## File Structure

- Modify: src/fs-events.ts  (heartbeat const, opts param, interval lifecycle)
- Modify: src/live-refresh.ts  (inactivity const/option, watchdog timer, reset points, ping listener, stop cleanup)
- Modify: src/Panel.tsx  (single coordinator, hintRef listDir, stabilized callbacks, setHint effect)
- Test: test/fs-events.test.ts  (heartbeat emits and stops)
- Test: test/live-coordinator.test.ts  (watchdog fire/reset/stop; setHint poller restart)
- Modify: CHANGELOG.md, docs/superpowers/plans/2026-09-02-maturity-roadmap.md (final task)

---

### Task 1: Server heartbeat in fs-events

**Files:**
- Modify: src/fs-events.ts
- Test: test/fs-events.test.ts (append a describe block)

**Interfaces:**
- Consumes: nothing new.
- Produces: export const SSE_HEARTBEAT_MS = 10000; createEventsHandler(defaultRoot, gitCache?, opts?: { heartbeatMs?: number }). fs-api call site stays createEventsHandler(defaultRoot, gitCache) — heartbeat defaults apply in production.

- [ ] **Step 1: Write the failing heartbeat test**

    Append to test/fs-events.test.ts a describe using the existing openSse helper:

        describe("heartbeat", () => {
          it("emits event: ping blocks at the injected interval while connected", async () => {
            const tempDir = await mkdtemp(join(tmpdir(), "fs-events-hb-"));
            try {
              const handler = createEventsHandler(tempDir, undefined, { heartbeatMs: 40 });
              const conn = await openSse(handler, "hint=" + encodeURIComponent(tempDir) + "&paths=%5B%5D");
              try {
                await waitFor(() => conn.buffer().includes("event: ping"), {
                  message: "no heartbeat ping received",
                });
              } finally {
                await conn.close();
              }
            } finally {
              await rm(tempDir, { recursive: true, force: true });
            }
          });
        });

    Note: paths=%5B%5D decodes to paths=[] (no workspace watcher; git metadata watchers still start if .git exists — this fixture has none, so only the heartbeat timer is under test). Reuse openSse, waitFor, mkdtemp, join, tmpdir, rm, createEventsHandler from the existing imports/helpers in this file.

- [ ] **Step 2: Run the test and confirm it fails**

    Run: npx tsx --test --test-name-pattern="heartbeat" test/fs-events.test.ts
    Expected: FAIL (no event: ping in the stream — timeout).

- [ ] **Step 3: Implement the heartbeat**

    In src/fs-events.ts:

    Add near the top (next to the other constants/exports):

        /** Server heartbeat cadence for live SSE connections (ms). */
        export const SSE_HEARTBEAT_MS = 10000;

    Change the signature:

        export function createEventsHandler(
          defaultRoot: string,
          gitCache?: { invalidate(root: string): void },
          opts?: { heartbeatMs?: number }
        ) {

    In createEventsHandler, declare the timer next to the watcher sets:

        const heartbeatMs = opts?.heartbeatMs ?? SSE_HEARTBEAT_MS;
        let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    In dispose(), clear it (add before or after the gitWatchers loop):

        if (heartbeatTimer !== null) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }

    After the per-target watcher loop (and before await watchGitMetadata(root)), start it:

        heartbeatTimer = setInterval(() => {
          if (disposed) return;
          try {
            res.write("event: ping\ndata: {}\n\n");
          } catch {
            // connection closing; close/error handlers own cleanup
          }
        }, heartbeatMs);

- [ ] **Step 4: Run the test and confirm it passes**

    Run: npx tsx --test --test-name-pattern="heartbeat" test/fs-events.test.ts
    Expected: PASS.

- [ ] **Step 5: Run the full gate**

    Run: npm run typecheck && npm test && npm run build
    Expected: green (295 existing + 1 new).

- [ ] **Step 6: Commit**

    git add src/fs-events.ts test/fs-events.test.ts
    git commit -m "feat: SSE heartbeat (event: ping) so stalled live-refresh connections can be detected"

---

### Task 2: Client inactivity watchdog + setHint poller transitions in live-refresh

**Files:**
- Modify: src/live-refresh.ts
- Test: test/live-coordinator.test.ts (append tests to the existing describe)

**Interfaces:**
- Consumes: Task 1 (ping event arrives on the source; no parser change needed).
- Produces: export const LIVE_REFRESH_INACTIVITY_MS = 30000; new option inactivityMs?: number on LiveRefreshCoordinatorOptions. Watchdog behavior per spec; no changes to the public LiveRefreshCoordinator surface.

- [ ] **Step 1: Write the failing watchdog tests**

    Append tests inside the existing describe("live refresh coordinator") in test/live-coordinator.test.ts. Follow the file's harness patterns for creating a coordinator with a fake source (open via harness.sourceOpen or equivalent), faking time via real short timers, and waiting with the file's existing wait helper (mirror the style used by the reconnect tests). Placeholder shape:

        describe("inactivity watchdog", () => {
          it("fires into the error path after inactivityMs with no activity", async () => {
            // coordinator with inactivityMs 60; open the first source; emit nothing;
            // expect onError called, first source closed, a reconnect scheduled,
            // and the poller started (onFallbackChange true). Use the file's wait
            // helper and mirror how the existing polling-fallback tests assert
            // poller activation. Failing state before implementation: watchdog
            // never fires -> onError never called.
          });

          it("resets on ping activity and does not fire", async () => {
            // inactivityMs 80; open; emit ping every 40ms three times;
            // after ~150ms onError was never called.
          });

          it("resets on changed events and does not fire", async () => {
            // open; emit valid changed events every 40ms inside inactivityMs;
            // no error; refreshDirs is invoked for the changed parents as usual.
          });

          it("stop clears the watchdog so it never fires after stop", async () => {
            // open; stop(); wait past inactivityMs; assert no onError and no new
            // source was created.
          });
        });

    IMPORTANT: implement these four tests concretely with the actual harness API used elsewhere in this file (fake sources, emit, open simulation, wait helpers, poller assertion pattern from the existing polling-fallback describe). Read the existing tests first and mirror them exactly; do not invent new harness APIs. The failing-state expectation for each test stays as written above.

    Also add the setHint poller transition tests (same append, same concrete style):

        it("after setHint, a subsequent SSE error restarts the poller exactly once", async () => {
          // open; first source errors -> poller active; setHint(newHint); next
          // error fires again; assert onFallbackChange(true) was called again and
          // listDir was invoked after the setHint with the new expanded dirs;
          // assert no double poller (listDir calls are serialized, one poller).
        });

        it("setHint closes the old source before opening the new one", async () => {
          // existing setHint semantics: assert the created-source list grows by
          // one and the previous source was closed (mirror the existing
          // reconnect-with-new-hint-on-setHint test in this file).
        });

- [ ] **Step 2: Run the tests and confirm they fail**

    Run: npx tsx --test --test-name-pattern="inactivity watchdog" test/live-coordinator.test.ts
    Expected: FAIL (watchdog not implemented).

- [ ] **Step 3: Implement the watchdog**

    In src/live-refresh.ts:

    Add near LIVE_REFRESH_DEBOUNCE_MS:

        /** Inactivity bound for a live SSE connection (ms); three missed heartbeats. */
        export const LIVE_REFRESH_INACTIVITY_MS = 30000;

    Add to LiveRefreshCoordinatorOptions:

        /** Stalled-connection timeout; defaults to LIVE_REFRESH_INACTIVITY_MS. */
        inactivityMs?: number;

    In createLiveRefreshCoordinator, near the other option defaults:

        const inactivityMs = options.inactivityMs ?? LIVE_REFRESH_INACTIVITY_MS;

    Add locals next to reconnectTimer:

        let watchdogTimer: ReturnType<typeof setTimeout> | null = null;

    Add helpers after scheduleReconnect (they may reference closeSource, scheduleReconnect, startPoller, and options.onError, all declared above them):

        const clearWatchdog = (): void => {
          if (watchdogTimer !== null) {
            clearTimeout(watchdogTimer);
            watchdogTimer = null;
          }
        };

        const resetWatchdog = (): void => {
          if (!started) return;
          clearWatchdog();
          watchdogTimer = setTimeout(() => {
            watchdogTimer = null;
            if (!started) return;
            options.onError?.("live refresh stalled; switching to polling");
            closeSource();
            scheduleReconnect();
            startPoller();
          }, inactivityMs);
        };

    Wire the reset points:

    - openSource: after attaching the listeners, call resetWatchdog() at the end of the function body.
    - the open listener: call resetWatchdog() alongside reconnectAttempt = 0 and stopPoller().
    - the changed listener: after a valid change is pushed to the debouncer, call resetWatchdog().
    - the git-changed listener: after scheduleGitRefresh(), call resetWatchdog().
    - add a ping listener next to git-changed:

        next.addEventListener("ping", () => {
          if (!started || myEpoch !== epoch) return;
          resetWatchdog();
        });

    - the error listener: call clearWatchdog() first (the source is closed; the backoff/poller path owns the next watchdog via the next openSource).

    stop(): call clearWatchdog() alongside the existing timer cleanup. setHint and reconnect() need no extra work: reconnect() ends in openSource, which resets the watchdog.

    Also append the setHint poller transition tests from the spec (setHint with a failing SSE: old source closed, poller restarts exactly once on the next error, listDir called with the new expanded dirs, no double poller) — concrete, mirroring the existing polling-fallback harness style. Add them in the same append as the watchdog tests if not already written in step 1 (fold into Step 1 instead of duplicating instructions; adjust Step 2 pattern accordingly).

- [ ] **Step 4: Run the tests and confirm they pass**

    Run: npx tsx --test --test-name-pattern="inactivity watchdog|setHint" test/live-coordinator.test.ts
    Expected: PASS.

- [ ] **Step 5: Run the full gate**

    Run: npm run typecheck && npm test && npm run build
    Expected: green (295 + new tests).

- [ ] **Step 6: Commit**

    git add src/live-refresh.ts test/live-coordinator.test.ts
    git commit -m "feat: inactivity watchdog for stalled SSE; setHint poller transition coverage"

---

### Task 3: Panel — single coordinator with setHint and hint-ref listDir

**Files:**
- Modify: src/Panel.tsx

**Interfaces:**
- Consumes: Task 2 (LiveRefreshCoordinator.setHint semantics; no new exports).
- Produces: none code-facing (behavioral wiring).

- [ ] **Step 1: Stabilize the coordinator callbacks**

    In src/Panel.tsx, add a hintRef next to the existing previewPathRef pattern:

        const hintRef = useRef(hint);
        useEffect(() => {
          hintRef.current = hint;
        }, [hint]);

    Make refreshRootEntries read the current hint through hintRef so its identity no longer depends on the hint prop: replace the guard and fetch calls that use the closure hint with hintRef.current (function body only; keep the useCallback dependency array limited to what it actually closes over: handleError and pruneRootStale — remove hint from the deps). Its callers (handleRefreshDirs) then stay stable.

    Change handleRefreshDirs to depend only on stable things (it calls refreshRootEntries and treeRef.current.refreshPaths; keep its existing useCallback deps trimmed to what the body closes over after the change — refreshRootEntries is stable now, so no hint dependency remains).

    Add a stable listDir callback reading the ref:

        const listDirStable = useCallback(async (path: string) => {
          const h = hintRef.current;
          if (!h) return [];
          const res = await fetchList(h, path);
          return res.entries;
        }, []);

- [ ] **Step 2: Replace the recreate-per-hint coordinator effect with a single lifecycle + setHint**

    Add a coordinator ref near the other refs:

        const coordinatorRef = useRef<ReturnType<typeof createLiveRefreshCoordinator> | null>(null);

    Replace the existing coordinator effect (deps currently include open, hint, store, handleRefreshDirs, handleFileChanges, handleError) with two effects, DECLARED IN THIS ORDER so the creation effect runs first on any render that changes both:

    Effect A (create/stop with the panel, deps: [open, store, handleRefreshDirs, handleFileChanges, handleError, listDirStable]):

        useEffect(() => {
          if (!open) return;
          const coordinator = createLiveRefreshCoordinator({
            hint: hintRef.current,
            getExpandedPaths: store.getExpandedPaths,
            subscribeExpandedPaths: store.subscribeExpandedPaths,
            refreshDirs: handleRefreshDirs,
            onFileChange: handleFileChanges,
            onError: handleError,
            createEventSource: (url) => createSseEventSource(url),
            listDir: listDirStable,
            onFallbackChange: setLiveFallback,
          });
          coordinatorRef.current = coordinator;
          coordinator.start();
          return () => {
            coordinatorRef.current = null;
            coordinator.stop();
          };
        }, [open, store, handleRefreshDirs, handleFileChanges, handleError, listDirStable]);

    Effect B (route hint changes through setHint, deps: [open, hint]):

        useEffect(() => {
          if (!open || !hint) return;
          coordinatorRef.current?.setHint(hint);
        }, [open, hint]);

    Verify the existing store.setWorkspace effect (deps [hint, store]) and the root-load effect (loadRoot depends on hint) are declared BEFORE Effect B in the file so the store and the root listing are updated for the new workspace before setHint observes the expanded set. Reorder only if needed.

- [ ] **Step 3: Typecheck and review the diff**

    Run: npm run typecheck && npm run build
    Expected: clean. Manually re-read the changed effect section: the coordinator must not be recreated on hint change (Effect A deps exclude hint), the hintRef stays in sync, and Effect B fires setHint on hint changes.

- [ ] **Step 4: Run the full gate**

    Run: npm test
    Expected: 295+ green (no behavior tests regress; Panel wiring has no DOM harness — coordinator-level transitions are covered by Task 2 tests).

- [ ] **Step 5: Commit**

    git add src/Panel.tsx
    git commit -m "refactor: keep one live-refresh coordinator per open panel, route hint via setHint"

---

### Task 4: Documentation status and final gate

**Files:**
- Modify: CHANGELOG.md
- Modify: docs/superpowers/plans/2026-09-02-maturity-roadmap.md

**Interfaces:** Consumes Tasks 1-3 merged. Produces nothing code-facing.

- [ ] **Step 1: Update the roadmap**

    In docs/superpowers/plans/2026-09-02-maturity-roadmap.md mark the phase B row done (Status: done - 2026-09-02, plan docs/superpowers/plans/2026-09-02-live-refresh-watchdog.md).

- [ ] **Step 2: Update the changelog**

    Under CHANGELOG.md Unreleased > Changed add two lines:

        - Live refresh detects a stalled SSE connection (server heartbeat +
          client inactivity watchdog) and degrades to polling with a banner
        - Panel keeps one live-refresh coordinator per open panel and switches
          workspaces via setHint, so polling always targets the current workspace

- [ ] **Step 3: Run the full gate once more**

    Run: npm run typecheck && npm test && npm run build
    Expected: all green.

- [ ] **Step 4: Commit**

    git add CHANGELOG.md docs/superpowers/plans/2026-09-02-maturity-roadmap.md
    git commit -m "docs: mark phase B (live-refresh watchdog) complete"
