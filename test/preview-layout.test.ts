// test/preview-layout.test.ts
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { createStore } from "../src/store.js";

function installLocalStorageMock(): Map<string, string> {
  const map = new Map<string, string>();
  const mock = {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => { map.clear(); },
    length: 0,
    key: () => null,
  };
  (globalThis as any).localStorage = mock;
  return map;
}

describe("store preview layout", () => {
  let ls: Map<string, string>;

  beforeEach(() => {
    ls = installLocalStorageMock();
  });

  it("defaults to null layout", () => {
    const store = createStore();
    assert.strictEqual(store.getState().previewLayout, null);
  });

  it("saves layout for the current workspace and restores it after setWorkspace", () => {
    const store = createStore();
    store.setWorkspace("/ws/alpha");
    const layout = { x: 320, y: 40, width: 640, height: 480 };
    store.setPreviewLayout(layout);
    assert.deepStrictEqual(store.getState().previewLayout, layout);

    // Переключение воркспейса и возврат — layout восстанавливается
    store.setWorkspace("/ws/beta");
    assert.strictEqual(store.getState().previewLayout, null);
    store.setWorkspace("/ws/alpha");
    assert.deepStrictEqual(store.getState().previewLayout, layout);
  });

  it("keeps layouts independent per workspace", () => {
    const store = createStore();
    store.setWorkspace("/ws/a");
    store.setPreviewLayout({ x: 10, y: 10, width: 100, height: 100 });
    store.setWorkspace("/ws/b");
    store.setPreviewLayout({ x: 900, y: 900, width: 300, height: 300 });
    store.setWorkspace("/ws/a");
    assert.deepStrictEqual(store.getState().previewLayout, { x: 10, y: 10, width: 100, height: 100 });
    store.setWorkspace("/ws/b");
    assert.deepStrictEqual(store.getState().previewLayout, { x: 900, y: 900, width: 300, height: 300 });
  });

  it("clears layout when set to null", () => {
    const store = createStore();
    store.setWorkspace("/ws/alpha");
    store.setPreviewLayout({ x: 1, y: 2, width: 3, height: 4 });
    store.setPreviewLayout(null);
    assert.strictEqual(store.getState().previewLayout, null);
    // После перезагрузки store для того же воркспейса layout отсутствует
    const store2 = createStore();
    store2.setWorkspace("/ws/alpha");
    assert.strictEqual(store2.getState().previewLayout, null);
  });

  it("persists layout in localStorage under a hint-keyed key", () => {
    const store = createStore();
    store.setWorkspace("/ws/alpha");
    store.setPreviewLayout({ x: 5, y: 6, width: 7, height: 8 });
    const key = [...ls.keys()].find((k) => k.startsWith("dsh-filemanager-preview:"));
    assert.ok(key, "expected a dsh-filemanager-preview: key");
    const stored = JSON.parse(ls.get(key as string) as string);
    assert.deepStrictEqual(stored, { x: 5, y: 6, width: 7, height: 8 });
  });
});