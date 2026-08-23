// test/live-polling.test.ts
// Task 4 pure tests: polling fallback for live tree refresh. Snapshot helpers
// are pure (stable ordering, change detection across create/delete/rename/
// size/mtime and stable empty dirs); the directory poller runs on real timers
// with injectable listing/interval so it can run in Node without a DOM.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createDirectorySnapshot,
  hasSnapshotChanged,
  createDirectoryPoller,
  POLL_INTERVAL_MS,
  type DirectorySnapshot,
  type PolledEntry,
} from "../src/live-polling.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn: () => boolean, timeoutMs = 2000, intervalMs = 5): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (fn()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await delay(intervalMs);
  }
}

function snapshotOf(entries: PolledEntry[]): DirectorySnapshot {
  return createDirectorySnapshot(entries);
}

describe("live polling fallback", () => {
  describe("createDirectorySnapshot", () => {
    it("builds a stable snapshot sorted by name regardless of input order", () => {
      const a = snapshotOf([
        { name: "b.ts", kind: "file", size: 2 },
        { name: "a.ts", kind: "file", size: 1 },
        { name: "c", kind: "dir" },
      ]);
      const b = snapshotOf([
        { name: "c", kind: "dir" },
        { name: "a.ts", kind: "file", size: 1 },
        { name: "b.ts", kind: "file", size: 2 },
      ]);
      assert.deepStrictEqual(a, b);
      assert.deepStrictEqual(a.entries.map((e) => e.name), ["a.ts", "b.ts", "c"]);
    });

    it("captures name, kind, size and mtime from available fields", () => {
      const snapshot = snapshotOf([{ name: "a.ts", kind: "file", size: 42, mtime: 1234567890 }]);
      assert.deepStrictEqual(snapshot.entries, [
        { name: "a.ts", kind: "file", size: 42, mtime: 1234567890 },
      ]);
    });

    it("normalizes missing size and mtime to null", () => {
      const snapshot = snapshotOf([{ name: "a.ts", kind: "file" }, { name: "dir1", kind: "dir" }]);
      assert.deepStrictEqual(snapshot.entries, [
        { name: "a.ts", kind: "file", size: null, mtime: null },
        { name: "dir1", kind: "dir", size: null, mtime: null },
      ]);
    });

    it("ignores extra fields such as git status", () => {
      const plain = snapshotOf([{ name: "a.ts", kind: "file", size: 1 }]);
      const withGit = snapshotOf([
        { name: "a.ts", kind: "file", size: 1, gitStatus: "modified" } as PolledEntry,
      ]);
      assert.deepStrictEqual(withGit, plain);
    });

    it("drops entries without a usable name", () => {
      const snapshot = snapshotOf([
        { name: "", kind: "file" } as PolledEntry,
        { name: "a.ts", kind: "file" },
      ]);
      assert.deepStrictEqual(snapshot.entries, [{ name: "a.ts", kind: "file", size: null, mtime: null }]);
    });
  });

  describe("hasSnapshotChanged", () => {
    it("returns false for identical snapshots built from different input order", () => {
      const a = snapshotOf([{ name: "a", kind: "file", size: 1 }, { name: "b", kind: "file", size: 2 }]);
      const b = snapshotOf([{ name: "b", kind: "file", size: 2 }, { name: "a", kind: "file", size: 1 }]);
      assert.equal(hasSnapshotChanged(a, b), false);
    });

    it("returns false for two empty snapshots (stable empty directories)", () => {
      assert.equal(hasSnapshotChanged(snapshotOf([]), snapshotOf([])), false);
    });

    it("detects a created entry", () => {
      const before = snapshotOf([{ name: "a", kind: "file" }]);
      const after = snapshotOf([{ name: "a", kind: "file" }, { name: "b", kind: "file" }]);
      assert.equal(hasSnapshotChanged(before, after), true);
    });

    it("detects a deleted entry", () => {
      const before = snapshotOf([{ name: "a", kind: "file" }, { name: "b", kind: "file" }]);
      const after = snapshotOf([{ name: "a", kind: "file" }]);
      assert.equal(hasSnapshotChanged(before, after), true);
    });

    it("detects a rename (same kind/size/mtime, different name)", () => {
      const before = snapshotOf([{ name: "old.txt", kind: "file", size: 10 }]);
      const after = snapshotOf([{ name: "new.txt", kind: "file", size: 10 }]);
      assert.equal(hasSnapshotChanged(before, after), true);
    });

    it("detects a size change", () => {
      const before = snapshotOf([{ name: "a.ts", kind: "file", size: 10 }]);
      const after = snapshotOf([{ name: "a.ts", kind: "file", size: 20 }]);
      assert.equal(hasSnapshotChanged(before, after), true);
    });

    it("detects an mtime change", () => {
      const before = snapshotOf([{ name: "a.ts", kind: "file", size: 10, mtime: 100 }]);
      const after = snapshotOf([{ name: "a.ts", kind: "file", size: 10, mtime: 200 }]);
      assert.equal(hasSnapshotChanged(before, after), true);
    });

    it("detects a kind change (dir became a file)", () => {
      const before = snapshotOf([{ name: "a", kind: "dir" }]);
      const after = snapshotOf([{ name: "a", kind: "file" }]);
      assert.equal(hasSnapshotChanged(before, after), true);
    });

    it("ignores snapshot-irrelevant field changes (git status not in the snapshot)", () => {
      const before = snapshotOf([{ name: "a.ts", kind: "file", size: 1 }]);
      const after = snapshotOf([
        { name: "a.ts", kind: "file", size: 1, gitStatus: "deleted" } as PolledEntry,
      ]);
      assert.equal(hasSnapshotChanged(before, after), false);
    });
  });

  describe("polling cadence constant", () => {
    it("polls expanded directories every 5000ms in production", () => {
      assert.equal(POLL_INTERVAL_MS, 5000);
    });
  });

  describe("createDirectoryPoller", () => {
    interface PollerHarness {
      expanded: string[];
      intervalMs: number;
      listDirCalls: string[];
      results: Map<string, PolledEntry[][]>;
      lastResults: Map<string, PolledEntry[]>;
      onChangedCalls: string[][];
      deferred: { promise: Promise<PolledEntry[]>; resolve: (v: PolledEntry[]) => void } | null;
      failNext: boolean;
    }

    function makePoller(overrides: Partial<{ expanded: string[]; intervalMs: number }> = {}) {
      const harness: PollerHarness = {
        expanded: overrides.expanded ?? ["src"],
        intervalMs: overrides.intervalMs ?? 30,
        listDirCalls: [],
        results: new Map(),
        lastResults: new Map(),
        onChangedCalls: [],
        deferred: null,
        failNext: false,
      };
      const poller = createDirectoryPoller({
        getExpandedPaths: () => [...harness.expanded],
        pollIntervalMs: harness.intervalMs,
        listDir: async (path: string) => {
          harness.listDirCalls.push(path);
          if (harness.deferred) {
            const d = harness.deferred;
            harness.deferred = null;
            return d.promise;
          }
          if (harness.failNext) {
            harness.failNext = false;
            throw new Error("list failed");
          }
          const queue = harness.results.get(path) ?? [];
          if (queue.length > 0) {
            const next = queue.shift()!;
            harness.lastResults.set(path, next);
            return next;
          }
          return harness.lastResults.get(path) ?? [];
        },
        onChanged: (paths) => harness.onChangedCalls.push(paths),
      });
      return { harness, poller };
    }

    function setResult(harness: PollerHarness, path: string, entries: PolledEntry[]): void {
      harness.results.set(path, [entries]);
    }

    function deferredListing(harness: PollerHarness): (v: PolledEntry[]) => void {
      let resolveDeferred: (v: PolledEntry[]) => void = () => {};
      harness.deferred = {
        promise: new Promise<PolledEntry[]>((resolve) => { resolveDeferred = resolve; }),
        resolve: (v) => resolveDeferred(v),
      };
      return resolveDeferred;
    }

    it("polls only the current expanded paths and never closed directories", async () => {
      const { harness, poller } = makePoller({ expanded: ["src", "test"], intervalMs: 20 });
      setResult(harness, "src", [{ name: "s.ts", kind: "file" }]);
      setResult(harness, "test", [{ name: "t.ts", kind: "file" }]);
      poller.start();
      await waitFor(() => harness.listDirCalls.includes("src") && harness.listDirCalls.includes("test"));
      const srcCalls = harness.listDirCalls.filter((p) => p === "src").length;

      // Close "test": it must not be polled again.
      harness.expanded = ["src"];
      await delay(70);
      assert.equal(harness.listDirCalls.filter((p) => p === "test").length, 1, "closed dir must not be polled");
      assert.ok(harness.listDirCalls.filter((p) => p === "src").length > srcCalls, "open dir keeps polling");
      poller.stop();
    });

    it("the first poll establishes a baseline without invalidating", async () => {
      const { harness, poller } = makePoller({ intervalMs: 20 });
      setResult(harness, "src", [{ name: "a.ts", kind: "file" }]);
      poller.start();
      await waitFor(() => harness.listDirCalls.includes("src"));
      await delay(30);
      assert.deepStrictEqual(harness.onChangedCalls, []);
      poller.stop();
    });

    it("invalidates a directory only when its snapshot changed since the baseline", async () => {
      const { harness, poller } = makePoller({ intervalMs: 20 });
      setResult(harness, "src", [{ name: "a.ts", kind: "file" }]);
      poller.start();
      await waitFor(() => harness.listDirCalls.includes("src"));
      await delay(25);
      assert.deepStrictEqual(harness.onChangedCalls, [], "baseline must not invalidate");

      setResult(harness, "src", [{ name: "a.ts", kind: "file" }, { name: "b.ts", kind: "file" }]);
      await waitFor(() => harness.onChangedCalls.length === 1);
      assert.deepStrictEqual(harness.onChangedCalls[0], ["src"]);

      // Unchanged listing must not invalidate again.
      const calls = harness.onChangedCalls.length;
      await delay(60);
      assert.equal(harness.onChangedCalls.length, calls);
      poller.stop();
    });

    it("detects deletion and size changes across ticks", async () => {
      const { harness, poller } = makePoller({ intervalMs: 20 });
      setResult(harness, "src", [
        { name: "a.ts", kind: "file", size: 10 },
        { name: "b.ts", kind: "file", size: 5 },
      ]);
      poller.start();
      await waitFor(() => harness.listDirCalls.includes("src"));
      await delay(25);

      setResult(harness, "src", [{ name: "a.ts", kind: "file", size: 10 }]);
      await waitFor(() => harness.onChangedCalls.length === 1, 1500, 5);
      assert.deepStrictEqual(harness.onChangedCalls[0], ["src"]);

      setResult(harness, "src", [{ name: "a.ts", kind: "file", size: 99 }]);
      await waitFor(() => harness.onChangedCalls.length === 2, 1500, 5);
      assert.deepStrictEqual(harness.onChangedCalls[1], ["src"]);
      poller.stop();
    });

    it("start is idempotent: no duplicate timers or parallel polls", async () => {
      const { harness, poller } = makePoller({ intervalMs: 20 });
      setResult(harness, "src", [{ name: "a.ts", kind: "file" }]);
      poller.start();
      poller.start();
      poller.start();
      await waitFor(() => harness.listDirCalls.includes("src"));
      await delay(50);
      // One fetch per interval: with a 20ms interval over ~50ms, 2-3 cycles
      // max, but never doubled by repeated start() calls.
      const calls = harness.listDirCalls.filter((p) => p === "src").length;
      assert.ok(calls >= 2, "expected steady cadence, got " + calls);
      assert.ok(calls <= 5, "start() must not duplicate timers, got " + calls);
      poller.stop();
    });

    it("does not overlap in-flight polls (single timer, no stacked cycles)", async () => {
      const { harness, poller } = makePoller({ intervalMs: 20 });
      const resolveDeferred = deferredListing(harness);
      poller.start();
      await waitFor(() => harness.listDirCalls.length === 1);
      await delay(60);
      assert.equal(harness.listDirCalls.length, 1, "in-flight poll must not overlap");
      resolveDeferred([{ name: "a.ts", kind: "file" }]);
      await waitFor(() => harness.listDirCalls.length === 2, 1500, 5);
      poller.stop();
    });

    it("stop() cancels the timer and future polls", async () => {
      const { harness, poller } = makePoller({ intervalMs: 20 });
      setResult(harness, "src", [{ name: "a.ts", kind: "file" }]);
      poller.start();
      await waitFor(() => harness.listDirCalls.includes("src"));
      poller.stop();
      const calls = harness.listDirCalls.length;
      await delay(80);
      assert.equal(harness.listDirCalls.length, calls);
      assert.deepStrictEqual(harness.onChangedCalls, []);
    });

    it("stop() during an in-flight poll never invalidates and schedules nothing", async () => {
      const { harness, poller } = makePoller({ intervalMs: 20 });
      const resolveDeferred = deferredListing(harness);
      poller.start();
      await waitFor(() => harness.listDirCalls.length === 1);
      poller.stop();
      resolveDeferred([{ name: "a.ts", kind: "file" }]);
      await delay(80);
      assert.deepStrictEqual(harness.onChangedCalls, [], "stop() must suppress in-flight invalidation");
      assert.equal(harness.listDirCalls.length, 1, "no polls after stop()");
    });

    it("prunes snapshots of closed dirs and re-baselines when they reopen", async () => {
      const { harness, poller } = makePoller({ expanded: ["src", "test"], intervalMs: 20 });
      setResult(harness, "src", [{ name: "s.ts", kind: "file" }]);
      setResult(harness, "test", [{ name: "t1.ts", kind: "file" }]);
      poller.start();
      await waitFor(() => harness.listDirCalls.includes("src") && harness.listDirCalls.includes("test"));
      await delay(25);
      assert.deepStrictEqual(harness.onChangedCalls, []);

      // Close "test" while its content changes on disk; the next tick prunes
      // its snapshot and polls only "src".
      harness.expanded = ["src"];
      const testCallsAtClose = harness.listDirCalls.filter((p) => p === "test").length;
      const srcBefore = harness.listDirCalls.filter((p) => p === "src").length;
      await waitFor(() => harness.listDirCalls.filter((p) => p === "src").length > srcBefore);
      assert.equal(
        harness.listDirCalls.filter((p) => p === "test").length,
        testCallsAtClose,
        "closed dir must never be polled"
      );

      // Reopen "test" with different content: the first observation after the
      // prune is a fresh baseline, so the change is NOT reported.
      const testCallsBeforeReopen = harness.listDirCalls.filter((p) => p === "test").length;
      harness.expanded = ["src", "test"];
      setResult(harness, "test", [{ name: "t2.ts", kind: "file" }]);
      await waitFor(
        () => harness.listDirCalls.filter((p) => p === "test").length > testCallsBeforeReopen
      );
      await delay(30);
      assert.deepStrictEqual(harness.onChangedCalls, []);
      poller.stop();
    });

    it("keeps the previous snapshot when a listing fetch fails", async () => {
      const { harness, poller } = makePoller({ intervalMs: 20 });
      setResult(harness, "src", [{ name: "a.ts", kind: "file" }]);
      poller.start();
      await waitFor(() => harness.listDirCalls.includes("src"));
      await delay(25);
      assert.deepStrictEqual(harness.onChangedCalls, [], "baseline must not invalidate");

      // A failed fetch must not wipe the snapshot (no spurious deletion report).
      harness.failNext = true;
      await waitFor(() => harness.listDirCalls.length >= 2);
      await delay(25);
      assert.deepStrictEqual(harness.onChangedCalls, [], "failed fetch must not report deletions");

      // Same content again after recovery: still unchanged.
      await waitFor(() => harness.listDirCalls.length >= 3);
      await delay(25);
      assert.deepStrictEqual(harness.onChangedCalls, []);
      poller.stop();
    });
  });
});
