// test/notices.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { createNoticeStore, type Notice } from "../src/notices.js";

const notice = (key: string, message: string, kind: "error" | "warning" = "error"): Notice => ({ key, kind, message });

describe("createNoticeStore", () => {
  it("starts empty", () => {
    const store = createNoticeStore();
    assert.deepStrictEqual(store.getNotices(), []);
  });

  it("push adds a notice and notifies subscribers", () => {
    const store = createNoticeStore();
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.push(notice("a", "boom"));
    assert.strictEqual(store.getNotices().length, 1);
    assert.strictEqual(store.getNotices()[0].message, "boom");
    assert.strictEqual(calls, 1);
    off();
  });

  it("newest notices come first", () => {
    const store = createNoticeStore();
    store.push(notice("a", "first"));
    store.push(notice("b", "second"));
    assert.deepStrictEqual(store.getNotices().map((n) => n.key), ["b", "a"]);
  });

  it("push with an existing key replaces the notice in place (no duplicate, one notify)", () => {
    const store = createNoticeStore();
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.push(notice("a", "v1"));
    store.push(notice("b", "other"));
    store.push(notice("a", "v2"));
    const notices = store.getNotices();
    assert.strictEqual(notices.length, 2);
    assert.strictEqual(notices.filter((n) => n.key === "a").length, 1);
    assert.strictEqual(notices.find((n) => n.key === "a")?.message, "v2");
    assert.strictEqual(calls, 3);
    off();
  });

  it("replacing does not reorder older notices ahead of newer ones", () => {
    const store = createNoticeStore();
    store.push(notice("a", "v1"));
    store.push(notice("b", "other"));
    store.push(notice("a", "v2"));
    assert.deepStrictEqual(store.getNotices().map((n) => n.key), ["b", "a"]);
  });

  it("dismiss removes only the matching key and notifies once", () => {
    const store = createNoticeStore();
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.push(notice("a", "x"));
    store.push(notice("b", "y"));
    calls = 0;
    store.dismiss("a");
    assert.deepStrictEqual(store.getNotices().map((n) => n.key), ["b"]);
    assert.strictEqual(calls, 1);
    // dismissing a missing key is a no-op
    store.dismiss("nope");
    assert.strictEqual(calls, 1);
    off();
  });

  it("unsubscribe stops notifications", () => {
    const store = createNoticeStore();
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.push(notice("a", "x"));
    off();
    store.push(notice("b", "y"));
    assert.strictEqual(calls, 1);
  });

  it("replace takes the new notice's retry callback", () => {
    const store = createNoticeStore();
    let ran = false;
    const retry = () => { ran = true; };
    store.push(notice("a", "x"));
    store.push({ key: "a", kind: "error", message: "y", retry });
    assert.strictEqual(store.getNotices()[0].retry, retry);
    store.getNotices()[0].retry?.();
    assert.strictEqual(ran, true);
  });

  it("replace drops a previous retry callback when the new notice has none", () => {
    const store = createNoticeStore();
    const retry = () => {};
    store.push({ key: "a", kind: "error", message: "x", retry });
    store.push(notice("a", "y"));
    assert.strictEqual(store.getNotices()[0].retry, undefined);
  });
});
