// test/client-logic.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { sortEntries, getFileColor, buildEventsUrl, type Entry } from "../src/api.js";
import { createStore, toggle, close } from "../src/store.js";

describe("sortEntries", () => {
  it("sorts directories before files", () => {
    const entries: Entry[] = [
      { name: "zebra.txt", kind: "file" },
      { name: "alpha", kind: "dir" },
      { name: "beta.js", kind: "file" },
    ];
    const sorted = sortEntries(entries);
    assert.strictEqual(sorted[0].name, "alpha");
    assert.strictEqual(sorted[1].name, "beta.js");
    assert.strictEqual(sorted[2].name, "zebra.txt");
  });

  it("sorts alphabetically case-insensitive", () => {
    const entries: Entry[] = [
      { name: "Zebra", kind: "dir" },
      { name: "alpha", kind: "dir" },
      { name: "Beta", kind: "dir" },
    ];
    const sorted = sortEntries(entries);
    assert.strictEqual(sorted[0].name, "alpha");
    assert.strictEqual(sorted[1].name, "Beta");
    assert.strictEqual(sorted[2].name, "Zebra");
  });

  it("treats symlink-dir as directory", () => {
    const entries: Entry[] = [
      { name: "file.txt", kind: "file" },
      { name: "link", kind: "symlink-dir" },
    ];
    const sorted = sortEntries(entries);
    assert.strictEqual(sorted[0].name, "link");
  });
});

describe("getFileColor", () => {
  it("returns blue for .ts files", () => {
    assert.strictEqual(getFileColor("index.ts"), "#3178c6");
  });

  it("returns gray for unknown extension", () => {
    assert.strictEqual(getFileColor("file.xyz"), "#9ca3af");
  });

  it("returns gray for no extension", () => {
    assert.strictEqual(getFileColor("Makefile"), "#9ca3af");
  });
});

describe("store", () => {
  it("toggle flips open state", () => {
    const store = createStore();
    const initial = store.getState().open;
    toggle(store);
    assert.strictEqual(store.getState().open, !initial);
    toggle(store);
    assert.strictEqual(store.getState().open, initial);
  });

  it("close sets open to false", () => {
    const store = createStore();
    store.setState({ open: true });
    close(store);
    assert.strictEqual(store.getState().open, false);
  });

  it("notifies subscribers on change", () => {
    const store = createStore();
    let called = 0;
    store.subscribe(() => called++);
    toggle(store);
    assert.strictEqual(called, 1);
  });
});

describe("buildEventsUrl", () => {
  it("URL-encodes hint and the JSON paths array", () => {
    const url = buildEventsUrl("/work space", ["src/a b", "test"]);
    assert.ok(url.startsWith("/filemanager-fs/events?"));
    const query = url.split("?")[1];
    assert.ok(!query.includes("+"), "spaces must be encoded as %20, not +");
    const params = new URLSearchParams(query);
    assert.strictEqual(params.get("hint"), "/work space");
    assert.deepStrictEqual(JSON.parse(params.get("paths") ?? ""), ["src/a b", "test"]);
  });

  it("handles an empty paths array", () => {
    const url = buildEventsUrl("/ws", []);
    const params = new URLSearchParams(url.split("?")[1]);
    assert.deepStrictEqual(JSON.parse(params.get("paths") ?? ""), []);
  });

  it("encodes plus signs so they are not decoded as spaces", () => {
    const url = buildEventsUrl("/ws", ["a+b"]);
    assert.ok(url.includes("a%2Bb"));
    const params = new URLSearchParams(url.split("?")[1]);
    assert.deepStrictEqual(JSON.parse(params.get("paths") ?? ""), ["a+b"]);
  });
});

describe("store expanded paths", () => {
  it("exposes expanded paths as a snapshot", () => {
    const store = createStore();
    store.setWorkspace("/ws");
    store.togglePath("src");
    store.togglePath("src");
    store.togglePath("test");
    assert.deepStrictEqual(store.getExpandedPaths(), ["test"]);
  });

  it("notifies expanded-path subscribers only when the set changes", () => {
    const store = createStore();
    store.setWorkspace("/ws");
    let notifications = 0;
    const unsubscribe = store.subscribeExpandedPaths(() => notifications++);
    store.togglePath("src");
    assert.strictEqual(notifications, 1);
    store.togglePath("src");
    assert.strictEqual(notifications, 2);
    store.setPreviewMode("rendered");
    assert.strictEqual(notifications, 2);
    unsubscribe();
    store.togglePath("test");
    assert.strictEqual(notifications, 2);
  });

  it("persists expanded paths through the existing store persistence", () => {
    const values = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    const store = createStore();
    store.setWorkspace("/ws");
    store.togglePath("src");
    assert.deepStrictEqual(JSON.parse(values.get("dsh-filemanager-expanded:/ws") ?? "[]"), ["src"]);
  });
});