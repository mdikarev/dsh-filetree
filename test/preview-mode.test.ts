import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/store.js";

function installLocalStorageMock(): Map<string, string> {
  const values = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  return values;
}

describe("store preview mode", () => {
  let storage: Map<string, string>;
  beforeEach(() => { storage = installLocalStorageMock(); });

  it("defaults to source", () => {
    const store = createStore();
    assert.equal(store.getState().previewMode, "source");
  });

  it("keeps modes independent per workspace and resets an unset workspace to source", () => {
    const store = createStore();
    store.setWorkspace("/ws/a");
    store.setPreviewMode("rendered");
    store.setWorkspace("/ws/b");
    assert.equal(store.getState().previewMode, "source");
    store.setPreviewMode("rendered");
    store.setWorkspace("/ws/a");
    assert.equal(store.getState().previewMode, "rendered");
  });

  it("restores a persisted mode after recreating the store", () => {
    const first = createStore();
    first.setWorkspace("/ws/a");
    first.setPreviewMode("rendered");
    const second = createStore();
    second.setWorkspace("/ws/a");
    assert.equal(second.getState().previewMode, "rendered");
  });

  it("treats invalid stored modes as source", () => {
    storage.set("dsh-filemanager-preview-mode:%2Fws%2Fa", "invalid");
    const store = createStore();
    store.setWorkspace("/ws/a");
    assert.equal(store.getState().previewMode, "source");
  });
});
