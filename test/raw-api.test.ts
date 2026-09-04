import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createGitStatusCache } from "../src/git-status-cache.js";
import { createHandler } from "../src/fs-api.js";
import { createCapabilityIssuer } from "../src/capabilities.js";

function request(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  path: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => { await handler(req, res); });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      fetch("http://127.0.0.1:" + addr.port + path, { headers })
        .then(async (res) => {
          const body = Buffer.from(await res.arrayBuffer());
          // WHATWG Headers has no bracket access; convert for header asserts.
          const headers = Object.fromEntries(res.headers.entries());
          server.close();
          resolve({ status: res.status, headers, body });
        })
        .catch((err) => { server.close(); reject(err); });
    });
  });
}

const PNG_HEADER = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
const hdr = { "x-dsh-filemanager": "1" };

describe("GET /filemanager-fs/cap", () => {
  let dir: string; let handler: ReturnType<typeof createHandler>;
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "raw-api-test-"));
    handler = createHandler(dir, { gitStatusCache: createGitStatusCache({ ttlMs: 0, collect: async () => new Map() }) });
  });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it("mints a cap only with the header", async () => {
    const ok = await request(handler, "/filemanager-fs/cap?hint=" + encodeURIComponent(dir), hdr);
    assert.equal(ok.status, 200);
    const cap = JSON.parse(ok.body.toString()) as { cap: string };
    assert.ok(typeof cap.cap === "string" && cap.cap.length >= 32);
    const denied = await request(handler, "/filemanager-fs/cap?hint=" + encodeURIComponent(dir));
    assert.equal(denied.status, 403);
  });
});

describe("GET /filemanager-fs/raw", () => {
  let dir: string; let handler: ReturnType<typeof createHandler>;
  let cap: string;
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "raw-api-test-"));
    handler = createHandler(dir, { gitStatusCache: createGitStatusCache({ ttlMs: 0, collect: async () => new Map() }) });
    const r = await request(handler, "/filemanager-fs/cap?hint=" + encodeURIComponent(dir), hdr);
    cap = (JSON.parse(r.body.toString()) as { cap: string }).cap;
    await writeFile(join(dir, "pic.png"), Buffer.concat([PNG_HEADER, Buffer.alloc(64)]));
    await writeFile(join(dir, "pic.svg"), SVG);
    await writeFile(join(dir, "note.txt"), "hello");
  });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it("serves raster bytes without the header when cap is valid", async () => {
    const res = await request(handler, "/filemanager-fs/raw?hint=" + encodeURIComponent(dir) + "&path=pic.png&cap=" + encodeURIComponent(cap));
    assert.equal(res.status, 200);
    assert.equal(res.headers["content-type"], "image/png");
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.equal(res.headers["cache-control"], "no-store");
    assert.deepEqual(res.body, Buffer.concat([PNG_HEADER, Buffer.alloc(64)]));
  });

  it("serves svg with a sandbox CSP header", async () => {
    const res = await request(handler, "/filemanager-fs/raw?hint=" + encodeURIComponent(dir) + "&path=pic.svg&cap=" + encodeURIComponent(cap));
    assert.equal(res.status, 200);
    assert.equal(res.headers["content-type"], "image/svg+xml");
    assert.equal(res.headers["content-security-policy"], "sandbox");
  });

  it("rejects a missing or wrong cap with 403 even with the header", async () => {
    const missing = await request(handler, "/filemanager-fs/raw?hint=" + encodeURIComponent(dir) + "&path=pic.png", hdr);
    assert.equal(missing.status, 403);
    const wrong = await request(handler, "/filemanager-fs/raw?hint=" + encodeURIComponent(dir) + "&path=pic.png&cap=deadbeef");
    assert.equal(wrong.status, 403);
  });

  it("rejects an expired cap (injected issuer)", async () => {
    let now = 1_000;
    const injectable = createHandler(dir, {
      capabilities: createCapabilityIssuer({ now: () => now, ttlMs: 50, randomToken: () => "tok" }),
      gitStatusCache: createGitStatusCache({ ttlMs: 0, collect: async () => new Map() }),
    });
    const minted = await request(injectable, "/filemanager-fs/cap?hint=" + encodeURIComponent(dir), hdr);
    const c = (JSON.parse(minted.body.toString()) as { cap: string }).cap;
    now += 51;
    const res = await request(injectable, "/filemanager-fs/raw?hint=" + encodeURIComponent(dir) + "&path=pic.png&cap=" + encodeURIComponent(c));
    assert.equal(res.status, 403);
  });

  it("rejects traversal (403) and missing files (404)", async () => {
    const trav = await request(handler, "/filemanager-fs/raw?hint=" + encodeURIComponent(dir) + "&path=../secret&cap=" + encodeURIComponent(cap));
    assert.equal(trav.status, 403);
    const miss = await request(handler, "/filemanager-fs/raw?hint=" + encodeURIComponent(dir) + "&path=nope.png&cap=" + encodeURIComponent(cap));
    assert.equal(miss.status, 404);
  });

  it("returns 415 for non-image files", async () => {
    const res = await request(handler, "/filemanager-fs/raw?hint=" + encodeURIComponent(dir) + "&path=note.txt&cap=" + encodeURIComponent(cap));
    assert.equal(res.status, 415);
  });

  it("returns 413 for an svg over the 2MB cap", async () => {
    await writeFile(join(dir, "big.svg"), "<svg>" + "x".repeat(2 * 1024 * 1024));
    const res = await request(handler, "/filemanager-fs/raw?hint=" + encodeURIComponent(dir) + "&path=big.svg&cap=" + encodeURIComponent(cap));
    assert.equal(res.status, 413);
  });
});
