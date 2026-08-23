// test/live-coordinator.test.ts
// Task 3 pure tests: SSE lifecycle coordinator, targeted invalidation,
// workspace identity, subscription cleanup, reconnect/backoff and the
// 250ms debounce wiring. The coordinator is dependency-injected (EventSource
// factory, store subscription, refresh callback) so it runs in Node without
// a DOM or React harness.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createLiveRefreshCoordinator,
  affectedDirsForChanges,
  backoffDelay,
  samePathSet,
  watchPathsWithRoot,
  staleExpandedPathsUnder,
  LIVE_REFRESH_DEBOUNCE_MS,
  type FileChange,
  type LiveEventSource,
} from "../src/live-refresh.js";
import { buildEventsUrl } from "../src/api.js";
import { createStore } from "../src/store.js";
import type { PolledEntry } from "../src/live-polling.js";

class FakeEventSource implements LiveEventSource {
  handlers = new Map<string, Array<(event: any) => void>>();
  closed = false;
  addEventListener(type: string, handler: (event: any) => void): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }
  close(): void {
    this.closed = true;
  }
  emit(type: string, event: any = {}): void {
    for (const handler of this.handlers.get(type) ?? []) handler(event);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn: () => boolean, timeoutMs = 1500, intervalMs = 5): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (fn()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await delay(intervalMs);
  }
}

interface Harness {
  created: FakeEventSource[];
  urls: string[];
  refreshed: string[][];
  fileChanges: FileChange[][];
  expanded: string[];
  subscribeCalls: number;
  unsubscribed: number;
  storeListener: (() => void) | null;
  listDirCalls: string[];
  listings: Map<string, PolledEntry[]>;
  fallback: boolean[];
}

function makeHarness(
  overrides: Partial<{
    hint: string;
    expanded: string[];
    debounceMs: number;
    reconnectBaseMs: number;
    reconnectMaxMs: number;
    pollIntervalMs: number;
    onError: (message: string) => void;
  }> = {}
): { harness: Harness; coordinator: ReturnType<typeof createLiveRefreshCoordinator> } {
  const harness: Harness = {
    created: [],
    urls: [],
    refreshed: [],
    fileChanges: [],
    expanded: overrides.expanded ?? ["src"],
    subscribeCalls: 0,
    unsubscribed: 0,
    storeListener: null,
    listDirCalls: [],
    listings: new Map(),
    fallback: [],
  };
  const coordinator = createLiveRefreshCoordinator({
    hint: overrides.hint ?? "/workspace",
    getExpandedPaths: () => [...harness.expanded],
    subscribeExpandedPaths: (listener) => {
      harness.subscribeCalls += 1;
      harness.storeListener = listener;
      return () => {
        harness.unsubscribed += 1;
        harness.storeListener = null;
      };
    },
    refreshDirs: (paths) => harness.refreshed.push(paths),
    onFileChange: (changes) => harness.fileChanges.push(changes),
    onError: overrides.onError ?? (() => {}),
    listDir: async (path: string) => {
      harness.listDirCalls.push(path);
      return [...(harness.listings.get(path) ?? [])];
    },
    onFallbackChange: (active: boolean) => harness.fallback.push(active),
    createEventSource: (url) => {
      const source = new FakeEventSource();
      harness.created.push(source);
      harness.urls.push(url);
      return source;
    },
    ...(overrides.debounceMs !== undefined ? { debounceMs: overrides.debounceMs } : {}),
    ...(overrides.reconnectBaseMs !== undefined ? { reconnectBaseMs: overrides.reconnectBaseMs } : {}),
    ...(overrides.reconnectMaxMs !== undefined ? { reconnectMaxMs: overrides.reconnectMaxMs } : {}),
    ...(overrides.pollIntervalMs !== undefined ? { pollIntervalMs: overrides.pollIntervalMs } : {}),
  });
  return { harness, coordinator };
}

function change(path: string, kind: "rename" | "change" = "change"): string {
  return JSON.stringify({ type: "changed", path, kind });
}

describe("live refresh coordinator", () => {
  describe("affectedDirsForChanges", () => {
    it("refreshes the root for root-level changes", () => {
      const changes: FileChange[] = [
        { type: "changed", path: "README.md", kind: "change" },
        { type: "changed", path: "package.json", kind: "change" },
      ];
      assert.deepStrictEqual(affectedDirsForChanges(changes, ["src", "test"]), [""]);
    });

    it("refreshes only the expanded parent of a nested change", () => {
      const changes: FileChange[] = [{ type: "changed", path: "src/a.ts", kind: "change" }];
      assert.deepStrictEqual(affectedDirsForChanges(changes, ["src", "test"]), ["src"]);
    });

    it("returns no dirs when the parent is closed", () => {
      const changes: FileChange[] = [{ type: "changed", path: "lib/b.ts", kind: "change" }];
      assert.deepStrictEqual(affectedDirsForChanges(changes, ["src", "test"]), []);
    });

    it("treats a directory rename as a change of its parent listing", () => {
      const changes: FileChange[] = [{ type: "changed", path: "src/old-name", kind: "rename" }];
      assert.deepStrictEqual(affectedDirsForChanges(changes, ["", "src", "src/old-name"]), ["src"]);
    });

    it("deduplicates the union across a batch", () => {
      const changes: FileChange[] = [
        { type: "changed", path: "src/a.ts", kind: "change" },
        { type: "changed", path: "src/b.ts", kind: "rename" },
        { type: "changed", path: "test/c.ts", kind: "change" },
        { type: "changed", path: "README.md", kind: "change" },
      ];
      assert.deepStrictEqual(affectedDirsForChanges(changes, ["src", "test"]), ["src", "test", ""]);
    });
  });

  describe("backoffDelay", () => {
    it("returns the base delay for the first attempt", () => {
      assert.equal(backoffDelay(0, 500, 10000), 500);
    });

    it("grows exponentially", () => {
      assert.equal(backoffDelay(1, 500, 10000), 1000);
      assert.equal(backoffDelay(2, 500, 10000), 2000);
      assert.equal(backoffDelay(3, 500, 10000), 4000);
    });

    it("caps at the maximum delay", () => {
      assert.equal(backoffDelay(10, 500, 10000), 10000);
      assert.equal(backoffDelay(100, 500, 10000), 10000);
    });

    it("handles a zero base delay", () => {
      assert.equal(backoffDelay(0, 0, 1000), 0);
    });
  });

  describe("samePathSet", () => {
    it("treats equal sets in different order as equal", () => {
      assert.equal(samePathSet(["a", "b"], ["b", "a"]), true);
      assert.equal(samePathSet(["a", "b", "c"], ["c", "a", "b"]), true);
    });

    it("distinguishes different sets", () => {
      assert.equal(samePathSet(["a"], ["a", "b"]), false);
      assert.equal(samePathSet(["a", "b"], ["a", "c"]), false);
      assert.equal(samePathSet([], ["a"]), false);
    });

    it("treats two empty sets as equal", () => {
      assert.equal(samePathSet([], []), true);
    });
  });

  describe("watchPathsWithRoot", () => {
    it("includes the root for an empty expanded set", () => {
      assert.deepStrictEqual(watchPathsWithRoot([]), [""]);
    });

    it("prepends the root to the expanded paths", () => {
      assert.deepStrictEqual(watchPathsWithRoot(["src", "test"]), ["", "src", "test"]);
    });

    it("deduplicates an expanded root", () => {
      assert.deepStrictEqual(watchPathsWithRoot(["", "src"]), ["", "src"]);
    });
  });

  describe("staleExpandedPathsUnder", () => {
    it("returns expanded children missing from the parent listing", () => {
      assert.deepStrictEqual(
        staleExpandedPathsUnder("src", ["a.ts", "components"], ["src", "src/components", "src/gone"]),
        ["src/gone"]
      );
    });

    it("prunes the whole subtree of a removed directory", () => {
      assert.deepStrictEqual(
        staleExpandedPathsUnder("src", ["a.ts"], ["src", "src/components", "src/components/deep", "src/keep"]),
        ["src/components", "src/components/deep", "src/keep"]
      );
    });

    it("ignores unrelated paths and the parent itself", () => {
      assert.deepStrictEqual(
        staleExpandedPathsUnder("src", ["a.ts"], ["src", "test", "lib/x", "src/x"]),
        ["src/x"]
      );
    });

    it("handles the root as the parent", () => {
      // Only the first segment is checked, so a subtree under a present
      // top-level dir is not pruned by the root listing alone.
      assert.deepStrictEqual(
        staleExpandedPathsUnder("", ["README.md", "src"], ["src", "src/components", "test"]),
        ["test"]
      );
      // When the top-level dir itself is gone, its whole subtree is stale.
      assert.deepStrictEqual(
        staleExpandedPathsUnder("", ["README.md"], ["src", "src/components", "test"]),
        ["src", "src/components", "test"]
      );
    });

    it("returns nothing when every expanded child is present", () => {
      assert.deepStrictEqual(
        staleExpandedPathsUnder("src", ["a.ts", "components"], ["src", "src/components"]),
        []
      );
    });
  });

  describe("EventSource lifecycle", () => {
    it("opens one source keyed by the encoded hint, the root and expanded paths", () => {
      const { harness, coordinator } = makeHarness({ hint: "/work space", expanded: ["src/a b", "test"] });
      coordinator.start();
      assert.equal(harness.urls.length, 1);
      assert.equal(harness.urls[0], buildEventsUrl("/work space", ["", "src/a b", "test"]));
      assert.ok(!harness.urls[0].includes("+"), "spaces must be %20, not +");
    });

    it("always watches the root (empty path) alongside the expanded directories", () => {
      const first = makeHarness({ expanded: [] });
      first.coordinator.start();
      assert.equal(first.harness.created.length, 1);
      const params = new URLSearchParams(first.harness.urls[0].split("?")[1]);
      assert.deepStrictEqual(JSON.parse(params.get("paths") ?? ""), [""]);

      const second = makeHarness({ expanded: ["src", "test"] });
      second.coordinator.start();
      const params2 = new URLSearchParams(second.harness.urls[0].split("?")[1]);
      assert.deepStrictEqual(JSON.parse(params2.get("paths") ?? ""), ["", "src", "test"]);
      first.coordinator.stop();
      second.coordinator.stop();
    });

    it("reconnects when the expanded-path set changes and closes the old source first", () => {
      const { harness, coordinator } = makeHarness({ expanded: ["src"] });
      coordinator.start();
      assert.equal(harness.created.length, 1);

      harness.expanded = ["src", "test"];
      harness.storeListener!();
      assert.equal(harness.created.length, 2);
      assert.equal(harness.created[0].closed, true, "old source closed before replacement");
      assert.equal(harness.created[1].closed, false);

      // Same content in different order must not reconnect.
      harness.expanded = ["test", "src"];
      harness.storeListener!();
      assert.equal(harness.created.length, 2);
    });

    it("reconnects with the new hint on setHint and ignores old-workspace events", async () => {
      const { harness, coordinator } = makeHarness({ hint: "/ws/a" });
      coordinator.start();
      coordinator.setHint("/ws/b");
      assert.equal(harness.created.length, 2);
      assert.equal(harness.created[0].closed, true);
      assert.ok(harness.urls[1].includes("hint=%2Fws%2Fb"));

      // An event that slipped out of the old source must be ignored.
      harness.created[0].emit("changed", { data: change("src/old.ts") });
      await delay(60);
      assert.deepStrictEqual(harness.refreshed, []);

      harness.created[1].emit("changed", { data: change("src/new.ts") });
      await waitFor(() => harness.refreshed.length === 1);
      assert.deepStrictEqual(harness.refreshed[0], ["src"]);
    });

    it("start is idempotent: no duplicate subscriptions or sources", () => {
      const { harness, coordinator } = makeHarness();
      coordinator.start();
      coordinator.start();
      assert.equal(harness.created.length, 1);
      assert.equal(harness.subscribeCalls, 1);
    });

    it("stop closes the source, unsubscribes and cancels pending refresh", async () => {
      const { harness, coordinator } = makeHarness({ debounceMs: 20 });
      coordinator.start();
      coordinator.stop();
      assert.equal(harness.created[0].closed, true);
      assert.equal(harness.unsubscribed, 1);
      harness.created[0].emit("changed", { data: change("src/a.ts") });
      await delay(60);
      assert.deepStrictEqual(harness.refreshed, []);
      // No reconnect can happen after stop.
      harness.storeListener?.();
      assert.equal(harness.created.length, 1);
    });
  });

  describe("targeted invalidation", () => {
    it("refreshes only affected expanded directories and the root when affected", async () => {
      const { harness, coordinator } = makeHarness({ expanded: ["src", "test"], debounceMs: 20 });
      coordinator.start();

      harness.created[0].emit("changed", { data: change("src/a.ts") });
      await waitFor(() => harness.refreshed.length === 1);
      assert.deepStrictEqual(harness.refreshed[0], ["src"]);

      harness.created[0].emit("changed", { data: change("README.md") });
      await waitFor(() => harness.refreshed.length === 2);
      assert.deepStrictEqual(harness.refreshed[1], [""]);

      // Change inside a closed directory must not trigger a request.
      harness.created[0].emit("changed", { data: change("lib/b.ts") });
      await delay(60);
      assert.equal(harness.refreshed.length, 2);
    });

    it("drops malformed SSE payloads without refreshing", async () => {
      const { harness, coordinator } = makeHarness({ debounceMs: 20 });
      coordinator.start();
      harness.created[0].emit("changed", { data: "not json" });
      harness.created[0].emit("changed", { data: "{}" });
      harness.created[0].emit("changed", { data: change("/etc/passwd") });
      await delay(60);
      assert.deepStrictEqual(harness.refreshed, []);
    });
  });

  describe("reconnect and backoff", () => {
    it("closes the errored source and reconnects with backoff, one source at a time", async () => {
      const { harness, coordinator } = makeHarness({
        expanded: [],
        reconnectBaseMs: 10,
        reconnectMaxMs: 40,
      });
      coordinator.start();

      harness.created[0].emit("error");
      assert.equal(harness.created.length, 1, "no immediate reconnect");
      await waitFor(() => harness.created.length === 2);
      assert.equal(harness.created[0].closed, true);

      harness.created[1].emit("error");
      await waitFor(() => harness.created.length === 3);

      harness.created[2].emit("error");
      await waitFor(() => harness.created.length === 4);

      // At most one source alive at a time.
      const open = harness.created.filter((s) => !s.closed);
      assert.equal(open.length, 1);
      coordinator.stop();
    });

    it("does not stack reconnect timers when the error fires again", async () => {
      const { harness, coordinator } = makeHarness({
        expanded: [],
        reconnectBaseMs: 10,
        reconnectMaxMs: 40,
      });
      coordinator.start();

      harness.created[0].emit("error");
      harness.created[0].emit("error");
      harness.created[0].emit("error");
      await waitFor(() => harness.created.length === 2);
      await delay(60);
      assert.equal(harness.created.length, 2);
      coordinator.stop();
    });
  });

  describe("polling fallback", () => {
    it("starts polling on the initial EventSource error and stops on successful reconnect", async () => {
      const { harness, coordinator } = makeHarness({
        expanded: ["src"],
        pollIntervalMs: 20,
        reconnectBaseMs: 10,
        reconnectMaxMs: 40,
      });
      coordinator.start();
      assert.deepStrictEqual(harness.fallback, []);
      assert.deepStrictEqual(harness.listDirCalls, [], "no polling while SSE is healthy");

      harness.created[0].emit("error");
      await waitFor(() => harness.listDirCalls.length >= 1);
      assert.deepStrictEqual(harness.fallback, [true], "fallback status on initial error");

      // Successful reconnect stops the fallback and clears the status.
      await waitFor(() => harness.created.length === 2);
      harness.created[1].emit("open");
      assert.deepStrictEqual(harness.fallback, [true, false]);
      const calls = harness.listDirCalls.length;
      await delay(80);
      assert.equal(harness.listDirCalls.length, calls, "polling must stop after SSE recovery");
      coordinator.stop();
    });

    it("invalidates changed expanded dirs via the same refreshDirs callback", async () => {
      const { harness, coordinator } = makeHarness({
        expanded: ["src"],
        pollIntervalMs: 20,
        reconnectBaseMs: 10,
        reconnectMaxMs: 40,
      });
      harness.listings.set("src", [{ name: "a.ts", kind: "file" }]);
      coordinator.start();
      harness.created[0].emit("error");
      await waitFor(() => harness.listDirCalls.includes("src"));
      await delay(25);
      assert.deepStrictEqual(harness.refreshed, [], "baseline poll must not invalidate");

      harness.listings.set("src", [{ name: "a.ts", kind: "file" }, { name: "b.ts", kind: "file" }]);
      await waitFor(() => harness.refreshed.length === 1);
      assert.deepStrictEqual(harness.refreshed[0], ["src"], "poll uses the targeted invalidation callback");
      coordinator.stop();
    });

    it("polls the root (empty path) alongside the expanded directories", async () => {
      const { harness, coordinator } = makeHarness({
        expanded: ["src"],
        pollIntervalMs: 20,
        reconnectBaseMs: 10,
        reconnectMaxMs: 40,
      });
      coordinator.start();
      harness.created[0].emit("error");
      await waitFor(() => harness.listDirCalls.includes("src"));
      assert.ok(harness.listDirCalls.includes(""), "root is polled so top-level changes are detected");

      // A change in the root listing invalidates the root.
      harness.listings.set("", [{ name: "README.md", kind: "file" }]);
      await waitFor(() => harness.refreshed.some((paths) => paths.includes("")));
      assert.ok(harness.refreshed.some((paths) => paths.includes("")), "root change routes to refreshDirs");
      coordinator.stop();
    });

    it("keeps polling through repeated reconnect failures", async () => {
      const { harness, coordinator } = makeHarness({
        expanded: ["src"],
        pollIntervalMs: 20,
        reconnectBaseMs: 10,
        reconnectMaxMs: 40,
      });
      coordinator.start();
      harness.created[0].emit("error");
      await waitFor(() => harness.listDirCalls.length >= 1);
      await waitFor(() => harness.created.length === 2);
      harness.created[1].emit("error");
      await waitFor(() => harness.created.length === 3);
      const calls = harness.listDirCalls.length;
      await waitFor(() => harness.listDirCalls.length > calls, 1500, 5);
      assert.deepStrictEqual(harness.fallback, [true], "fallback stays active through failures");
      coordinator.stop();
    });

    it("does not poll while SSE is healthy and resumes when it drops", async () => {
      const { harness, coordinator } = makeHarness({ expanded: ["src"], pollIntervalMs: 20 });
      coordinator.start();
      harness.created[0].emit("open");
      await delay(80);
      assert.deepStrictEqual(harness.listDirCalls, []);
      assert.deepStrictEqual(harness.fallback, []);

      harness.created[0].emit("error");
      await waitFor(() => harness.listDirCalls.length >= 1);
      assert.deepStrictEqual(harness.fallback, [true]);
      coordinator.stop();
    });

    it("stop() cancels polling (panel close / unmount)", async () => {
      const { harness, coordinator } = makeHarness({
        expanded: ["src"],
        pollIntervalMs: 20,
        reconnectBaseMs: 10,
        reconnectMaxMs: 40,
      });
      coordinator.start();
      harness.created[0].emit("error");
      await waitFor(() => harness.listDirCalls.length >= 1);
      coordinator.stop();
      const calls = harness.listDirCalls.length;
      await delay(80);
      assert.equal(harness.listDirCalls.length, calls, "no polls after stop");
      // Nothing can restart polling after stop.
      harness.created[0].emit("error");
      harness.storeListener?.();
      await delay(40);
      assert.equal(harness.listDirCalls.length, calls);
    });

    it("setHint stops polling for the old workspace and resumes only after the new source errors", async () => {
      const { harness, coordinator } = makeHarness({
        expanded: ["src"],
        pollIntervalMs: 20,
        reconnectBaseMs: 10,
        reconnectMaxMs: 40,
      });
      coordinator.start();
      harness.created[0].emit("error");
      await waitFor(() => harness.listDirCalls.length >= 1);

      const before = harness.created.length;
      coordinator.setHint("/ws/b");
      assert.equal(harness.created.length, before + 1, "workspace switch opens exactly one new source");
      assert.ok(
        harness.urls[harness.urls.length - 1].includes("hint=%2Fws%2Fb"),
        "new source is keyed by the new workspace"
      );

      const calls = harness.listDirCalls.length;
      await delay(80);
      assert.equal(harness.listDirCalls.length, calls, "no polling for the old workspace during the switch");
      assert.equal(harness.fallback[harness.fallback.length - 1], false, "fallback cleared on workspace switch");

      harness.created[harness.created.length - 1].emit("error");
      await waitFor(() => harness.listDirCalls.length > calls, 1500, 5);
      assert.equal(harness.fallback[harness.fallback.length - 1], true, "fallback resumes for the new workspace");
      coordinator.stop();
    });

    it("expanded-path changes while polling adapt the polled set without stopping the fallback", async () => {
      const { harness, coordinator } = makeHarness({
        expanded: ["src"],
        pollIntervalMs: 20,
        reconnectBaseMs: 10,
        reconnectMaxMs: 40,
      });
      coordinator.start();
      harness.created[0].emit("error");
      await waitFor(() => harness.listDirCalls.includes("src"));

      const before = harness.created.length;
      harness.expanded = ["src", "test"];
      harness.storeListener!();
      assert.equal(harness.created.length, before + 1, "reconnect on expanded-path change");
      assert.ok(harness.created[before - 1].closed, "old source closed before replacement");

      harness.created[before].emit("error");
      await waitFor(() => harness.listDirCalls.includes("test"), 1500, 5);
      assert.equal(harness.fallback[harness.fallback.length - 1], true, "fallback stays active while adapting");
      coordinator.stop();
    });
  });

  describe("stale expanded-path pruning", () => {
    it("prunes the store and reconnects the subscription without the missing path", async () => {
      const values = new Map<string, string>();
      (globalThis as any).localStorage = {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); },
      };
      const store = createStore();
      store.setWorkspace("/ws");
      store.togglePath("src");
      store.togglePath("src/gone");

      const urls: string[] = [];
      const coordinator = createLiveRefreshCoordinator({
        hint: "/ws",
        getExpandedPaths: store.getExpandedPaths,
        subscribeExpandedPaths: store.subscribeExpandedPaths,
        refreshDirs: () => {},
        createEventSource: (url) => { urls.push(url); return new FakeEventSource(); },
      });
      coordinator.start();
      assert.equal(urls.length, 1);
      const before = new URLSearchParams(urls[0].split("?")[1]);
      assert.deepStrictEqual(JSON.parse(before.get("paths") ?? ""), ["", "src", "src/gone"]);

      // The deleted directory is revealed missing and pruned from the store;
      // the subscription reconnects without it so the host no longer 404s.
      store.pruneExpandedPaths(["src/gone"]);
      assert.equal(urls.length, 2, "pruning reconnects the subscription");
      const after = new URLSearchParams(urls[1].split("?")[1]);
      assert.deepStrictEqual(JSON.parse(after.get("paths") ?? ""), ["", "src"]);
      coordinator.stop();
    });
  });

  describe("file change callback", () => {
    it("delivers the debounced change batch alongside refreshDirs", async () => {
      const { harness, coordinator } = makeHarness({ expanded: ["src"], debounceMs: 20 });
      coordinator.start();
      harness.created[0].emit("changed", { data: change("src/a.ts") });
      await waitFor(() => harness.fileChanges.length === 1);
      assert.deepStrictEqual(harness.fileChanges[0], [
        { type: "changed", path: "src/a.ts", kind: "change" },
      ]);
      assert.deepStrictEqual(harness.refreshed[0], ["src"]);
      coordinator.stop();
    });

    it("deduplicates repeated events per path and keeps the latest kind", async () => {
      const { harness, coordinator } = makeHarness({ expanded: ["src"], debounceMs: 20 });
      coordinator.start();
      harness.created[0].emit("changed", { data: change("src/a.ts") });
      harness.created[0].emit("changed", { data: change("src/a.ts", "rename") });
      harness.created[0].emit("changed", { data: change("src/b.ts") });
      await waitFor(() => harness.fileChanges.length === 1);
      assert.deepStrictEqual(harness.fileChanges[0], [
        { type: "changed", path: "src/a.ts", kind: "rename" },
        { type: "changed", path: "src/b.ts", kind: "change" },
      ]);
      coordinator.stop();
    });

    it("does not deliver malformed or unsafe payloads", async () => {
      const { harness, coordinator } = makeHarness({ debounceMs: 20 });
      coordinator.start();
      harness.created[0].emit("changed", { data: "not json" });
      harness.created[0].emit("changed", { data: "{}" });
      harness.created[0].emit("changed", { data: change("/etc/passwd") });
      await delay(60);
      assert.deepStrictEqual(harness.fileChanges, []);
      coordinator.stop();
    });

    it("drops old-workspace changes from a stale source", async () => {
      const { harness, coordinator } = makeHarness({ hint: "/ws/a", debounceMs: 20 });
      coordinator.start();
      coordinator.setHint("/ws/b");
      harness.created[0].emit("changed", { data: change("src/old.ts") });
      await delay(60);
      assert.deepStrictEqual(harness.fileChanges, []);
      coordinator.stop();
    });

    it("stop cancels pending change delivery", async () => {
      const { harness, coordinator } = makeHarness({ debounceMs: 20 });
      coordinator.start();
      coordinator.stop();
      harness.created[0].emit("changed", { data: change("src/a.ts") });
      await delay(60);
      assert.deepStrictEqual(harness.fileChanges, []);
    });
  });

  describe("debounce wiring", () => {
    it("uses the default 250ms debounce for live refresh", async () => {
      assert.equal(LIVE_REFRESH_DEBOUNCE_MS, 250);
      const { harness, coordinator } = makeHarness({ expanded: ["src"] });
      coordinator.start();
      const startedAt = Date.now();
      harness.created[0].emit("changed", { data: change("src/a.ts") });
      await waitFor(() => harness.refreshed.length === 1);
      const elapsed = Date.now() - startedAt;
            assert.ok(elapsed >= 230, "expected ~250ms debounce, got " + elapsed + "ms");
      coordinator.stop();
    });
  });
});
