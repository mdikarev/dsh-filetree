import { describe, it } from "node:test";
import assert from "node:assert";
import { createGitStatusCache } from "../src/git-status-cache.js";

type Entry = { status: string; isDir: boolean };

function makeCache(overrides?: {
  ttlMs?: number;
  maxRoots?: number;
  delayMs?: number;
  fail?: boolean;
}) {
  const roots: string[] = [];
  let runs = 0;
  let time = 0;
  const cache = createGitStatusCache<Entry>({
    collect: async (root: string) => {
      roots.push(root);
      runs += 1;
      if (overrides?.delayMs) {
        await new Promise((r) => setTimeout(r, overrides.delayMs as number));
      }
      if (overrides?.fail) throw new Error("boom");
      const map = new Map<string, Entry>();
      map.set(root, { status: "modified", isDir: false });
      return map;
    },
    ttlMs: overrides?.ttlMs ?? 100,
    maxRoots: overrides?.maxRoots ?? 8,
    now: () => time,
  });
  return {
    cache,
    runs: () => runs,
    roots: () => roots,
    tick: (ms: number) => { time += ms; },
  };
}

describe("createGitStatusCache", () => {
  it("reuses a fresh, clean snapshot without recollecting", async () => {
    const c = makeCache();
    const first = await c.cache.get("r1");
    const second = await c.cache.get("r1");
    assert.strictEqual(c.runs(), 1);
    assert.strictEqual(first, second);
  });

  it("recollects once after invalidate, then stays clean", async () => {
    const c = makeCache();
    await c.cache.get("r1");
    c.cache.invalidate("r1");
    await c.cache.get("r1");
    assert.strictEqual(c.runs(), 2);
    await c.cache.get("r1");
    assert.strictEqual(c.runs(), 2);
  });

  it("recollects after the TTL expires", async () => {
    const c = makeCache();
    await c.cache.get("r1");
    c.tick(101);
    await c.cache.get("r1");
    assert.strictEqual(c.runs(), 2);
  });

  it("recollects when the snapshot is dirty (even inside TTL)", async () => {
    const c = makeCache({ ttlMs: 1000 });
    await c.cache.get("r1");
    c.cache.invalidate("r1");
    await c.cache.get("r1");
    assert.strictEqual(c.runs(), 2);
  });

  it("shares one in-flight run between concurrent getters", async () => {
    const c = makeCache({ delayMs: 30 });
    const [a, b] = await Promise.all([c.cache.get("r1"), c.cache.get("r1")]);
    assert.strictEqual(c.runs(), 1);
    assert.deepStrictEqual([...a.keys()], [...b.keys()]);
  });

  it("leaves the result dirty when invalidate arrives during a run", async () => {
    const c = makeCache({ delayMs: 30 });
    const pending = c.cache.get("r1");
    c.cache.invalidate("r1");
    await pending;
    assert.strictEqual(c.runs(), 1); // in-flight run completed
    await c.cache.get("r1");
    assert.strictEqual(c.runs(), 2); // result was dirty, so next get recollects
  });

  it("isolates roots and evicts least-recently-used past maxRoots", async () => {
    const c = makeCache({ ttlMs: 1000, maxRoots: 2 });
    await c.cache.get("a");
    c.tick(1);
    await c.cache.get("b");
    c.tick(1);
    await c.cache.get("a"); // refresh a's recency
    c.tick(1);
    await c.cache.get("c"); // evicts b (least recently used)
    assert.strictEqual(c.cache.stats().roots, 2);
    c.tick(1);
    const bSnap = await c.cache.get("b");
    assert.ok(bSnap.size > 0); // recollects the evicted root
    assert.strictEqual(c.runs(), 4);
  });

  it("falls back to an empty snapshot when the collector throws", async () => {
    const c = makeCache({ fail: true });
    const snap = await c.cache.get("r1");
    assert.strictEqual(snap.size, 0);
    assert.strictEqual(c.cache.stats().dirtyRoots, 1); // retried on next get
  });
});
