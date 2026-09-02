# Live-Refresh Watchdog (B1) + Poller/Hint Fix (B2) — Design

**Status:** draft (phase B of the maturity roadmap, 2026-09-02).
**Scope:** (B1) client inactivity watchdog + server SSE heartbeat so a stalled connection is detected instead of silently freezing the tree; (B2) Panel adopts coordinator.setHint with a hint-ref-backed listDir so the polling fallback can never fetch the previous workspace after a workspace switch.
**Spec for:** docs/superpowers/plans/2026-09-02-maturity-roadmap.md phase B.

## Problem

- The events connection is a raw fetch stream (src/sse-client.ts): fetch has no connect timeout and a stalled reader never resolves. When a request hangs (server busy, network black-hole, host restart without a close), the coordinator sees neither open nor error: the polling fallback never activates (it starts only on error), no banner shows, and the tree silently stops refreshing. The native EventSource these code paths replaced has browser-managed timeouts; the fetch client has none.
- Coordinator.setHint changes only the SSE URL. The polling fallback's listDir is a closure over the hint captured when the coordinator was created (Panel passes listDir: (path) => fetchList(hint, path)). After setHint with SSE still down, the poller keeps listing the OLD workspace while getExpandedPaths already returns the NEW workspace's directories — wrong listings would be applied to the new tree. Today Panel never calls setHint (it recreates the coordinator per hint), so the bug is latent, but the API is a landmine for the intended setHint-based lifecycle.

## Decisions (agreed)

- **D1 (scope):** B1 + B2 with tests and a spec. Out of scope (parked): stale-response guards on Panel/Tree data loads (B3), backoff jitter, the macOS fs-events .git test flake.
- **D2 (heartbeat channel):** server sends explicit event: ping blocks; client listens for them. Chosen over comment lines so the coordinator gets a typed signal it can reset the watchdog on.

## Design

### 1. Server heartbeat (src/fs-events.ts)

Signature gains an options parameter:

    export function createEventsHandler(
      defaultRoot: string,
      gitCache?: { invalidate(root: string): void },
      opts?: { heartbeatMs?: number }
    )

- Heartbeat interval: opts.heartbeatMs ?? SSE_HEARTBEAT_MS (new exported const = 10_000). fs-api keeps calling createEventsHandler(defaultRoot, gitCache) — default heartbeat applies in production; tests inject a short interval.
- After the SSE response is flushed and watchers are created, start one setInterval that writes an SSE block: event: ping + data: {}. The callback no-ops when disposed; interval is cleared in dispose(). An already-closed response never gets a write (disposed guard runs first).
- Behavior/compat: ping blocks are invisible to the existing client parsing until the coordinator listens for them (below); no other server behavior changes.

### 2. Client inactivity watchdog (src/live-refresh.ts)

- New option: inactivityMs?: number (default LIVE_REFRESH_INACTIVITY_MS, new exported const = 30_000; 3 missed heartbeats).
- One watchdog timer per coordinator, managed like the reconnect timer: cleared and re-scheduled on stop; reset on activity.
- Activity resets the watchdog: the open event, every changed event, every git-changed event, and every new ping event. The watchdog is started when a source is opened (covers a fetch that hangs before open) and reset by openSource itself.
- Fire (inactivityMs with no activity while started): call onError('live refresh stalled; switching to polling'), closeSource(), scheduleReconnect(), startPoller() — exactly the existing error path, so backoff and fallback semantics stay uniform.
- stop() and the unmount cleanup clear the watchdog timer. No effect on the debouncer or git-refresh timer.

### 3. Poller/hint correctness (B2)

src/Panel.tsx changes:

- Keep one coordinator for the lifetime of an open panel instead of recreating it per hint: create it in the open-effect (deps: open, plus the stable callbacks/store), store it in a ref, and stop/null it when the panel closes or unmounts.
- Update hint via the API: a separate effect (deps: hint, open) calls coordinatorRef.current?.setHint(hint). Effect declaration order guarantees the store-workspace effect (store.setWorkspace on hint change) and the coordinator-creation effect run before this one, so setHint always observes the new workspace's expanded set.
- listDir becomes hint-agnostic through a ref (the previewPathRef pattern already in the file): hintRef mirrors the current hint; listDir: (path) => fetchList(hintRef.current, path). Then even if setHint lands while the poller is active, every poll lists the CURRENT workspace.
- Root refresh on hint change keeps working via the existing loadRoot effect (loadRoot depends on hint).

src/live-refresh.ts already owns epoch-based stale-event dropping, one-source-at-a-time, reconnect backoff and poller lifecycle; B2 does not change those. The setHint path must restart the poller cleanly (stop on setHint, start on the next error) — existing transitions plus new tests below cover it.

### 4. Behavior and compatibility

- SSE framing and client parser are unchanged; ping is a new, ignorable event type for old clients and adds no user-visible output.
- Watchdog only promotes a stalled connection to the existing degraded path (polling + banner); it never touches security/containment invariants or the fs-api response shapes.
- Timers are per-connection / per-coordinator and cleared in dispose()/stop(); no leaks on close, workspace switch, or panel close.
- Constants: SSE_HEARTBEAT_MS = 10000 (fs-events), LIVE_REFRESH_INACTIVITY_MS = 30000 (live-refresh). Both injectable in tests.

### 5. Testing

fs-events (extend test/fs-events.test.ts):

- heartbeat emits event: ping blocks at a short injected interval (e.g. heartbeatMs 40) while connected; closing the connection stops emission and leaves no timer crash (waitFor-based, existing tolerant helpers).

live-refresh coordinator (extend test/live-coordinator.test.ts, fake-source harness exists):

- watchdog fires with no activity: source opens, emits nothing; after inactivityMs (injected, e.g. 60ms) onError is called, the source is closed, a reconnect is scheduled, and the poller starts.
- activity resets the watchdog: a ping (and a changed event) arriving inside inactivityMs keeps the coordinator alive — no error after repeated pings across the threshold.
- stop() clears the watchdog (no fire after stop).
- setHint + failing SSE: after setHint the old source closes; on the next error the poller (re)starts exactly once — listDir is invoked with the new workspace dirs and there is no double poller.

Panel wiring (B2) has no DOM test harness in this repo (existing Panel behavior is covered by pure-logic tests only): the coordinator-level transition tests above plus a manual browser pass (switch workspace with SSE down; confirm tree shows the new workspace and the fallback banner appears) close the loop.

Gate: npm run typecheck && npm test && npm run build.

## Non-goals (parked)

- B3 stale-response guards for Panel/Tree loads; backoff jitter; macOS fs-events .git flake hardening.

## Rollout

Single commit set on main after spec review: fs-events heartbeat (+tests), live-refresh watchdog (+tests and setHint transition tests), Panel setHint wiring, then docs (roadmap/CHANGELOG). No contract or schema change; degraded mode is strictly better than silent freeze.
