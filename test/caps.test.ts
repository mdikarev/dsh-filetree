import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCapCache } from "../src/caps.js";
import { buildRawFileUrl } from "../src/raw-url.js";

describe("capCache", () => {
  it("fetches once per hint and reuses the resolved value", async () => {
    let calls = 0;
    const cache = createCapCache(async () => { calls += 1; return "cap-" + calls; });
    const a = await cache.getCap("/ws");
    const b = await cache.getCap("/ws");
    assert.equal(a, "cap-1");
    assert.equal(b, "cap-1");
    assert.equal(calls, 1);
  });
  it("keeps per-hint entries separate", async () => {
    let n = 0;
    const cache = createCapCache(async () => { n += 1; return "t" + n; });
    const a = await cache.getCap("/a");
    const b = await cache.getCap("/b");
    assert.equal(a, "t1");
    assert.equal(b, "t2");
  });
  it("invalidate forces a refetch", async () => {
    let n = 0;
    const cache = createCapCache(async () => { n += 1; return "t" + n; });
    assert.equal(await cache.getCap("/ws"), "t1");
    cache.invalidate("/ws");
    assert.equal(await cache.getCap("/ws"), "t2");
  });
  it("clears the rejected promise so a retry can succeed", async () => {
    let fail = true;
    const cache = createCapCache(async () => {
      if (fail) throw new Error("boom");
      return "ok";
    });
    await assert.rejects(() => cache.getCap("/ws"), /boom/);
    fail = false;
    assert.equal(await cache.getCap("/ws"), "ok");
  });
});

describe("buildRawFileUrl", () => {
  it("encodes hint, path and cap", () => {
    const url = buildRawFileUrl("/ws a", "dir/pic x.png", "tok/+=");
    assert.equal(url, "/filemanager-fs/raw?hint=%2Fws%20a&path=dir%2Fpic%20x.png&cap=tok%2F%2B%3D");
  });
  it("appends a version query when given", () => {
    const url = buildRawFileUrl("/ws", "pic.png", "cap", 3);
    assert.ok(url.endsWith("&v=3"));
  });
});
