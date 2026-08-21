// test/client-logic.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { sortEntries, getFileColor, type Entry } from "../src/api.js";
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
