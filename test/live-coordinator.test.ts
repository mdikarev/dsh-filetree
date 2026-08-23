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
  LIVE_REFRESH_DEBOUNCE_MS,
  type FileChange,
  type LiveEventSource,
} from "../src/live-refresh.js";
import { buildEventsUrl } from "../src/api.js";

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
  expanded: string[];
  subscribeCalls: number;
  unsubscribed: number;
  storeListener: (() => void) | null;
}

function makeHarness(
  overrides: Partial<{
    hint: string;
    expanded: string[];
    debounceMs: number;
    reconnectBaseMs: number;
    reconnectMaxMs: number;
    onError: (message: string) => void;
  }> = {}
): { harness: Harness; coordinator: ReturnType<typeof createLiveRefreshCoordinator> } {
  const harness: Harness = {
    created: [],
    urls: [],
    refreshed: [],
    expanded: overrides.expanded ?? ["src"],
    subscribeCalls: 0,
    unsubscribed: 0,
    storeListener: null,
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
    onError: overrides.onError ?? (() => {}),
    createEventSource: (url) => {
      const source = new FakeEventSource();
      harness.created.push(source);
      harness.urls.push(url);
      return source;
    },
    ...(overrides.debounceMs !== undefined ? { debounceMs: overrides.debounceMs } : {}),
    ...(overrides.reconnectBaseMs !== undefined ? { reconnectBaseMs: overrides.reconnectBaseMs } : {}),
    ...(overrides.reconnectMaxMs !== undefined ? { reconnectMaxMs: overrides.reconnectMaxMs } : {}),
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

  describe("EventSource lifecycle", () => {
    it("opens one source keyed by the encoded hint and expanded paths", () => {
      const { harness, coordinator } = makeHarness({ hint: "/work space", expanded: ["src/a b", "test"] });
      coordinator.start();
      assert.equal(harness.urls.length, 1);
      assert.equal(harness.urls[0], buildEventsUrl("/work space", ["src/a b", "test"]));
      assert.ok(!harness.urls[0].includes("+"), "spaces must be %20, not +");
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
