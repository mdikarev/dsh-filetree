import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createGitStatusCache } from "../src/git-status-cache.js";
import { createHandler, debugCollectStatuses } from "../src/fs-api.js";

const execFileAsync = promisify(execFile);

function request(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  path: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => { await handler(req, res); });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      fetch("http://127.0.0.1:" + addr.port + path, { headers })
        .then(async (res) => { const body = await res.json(); server.close(); resolve({ status: res.status, body }); })
        .catch((err) => { server.close(); reject(err); });
    });
  });
}

describe("GET /filemanager-fs/delete-info", () => {
  let dir: string;
  let handler: ReturnType<typeof createHandler>;
  const hdr = { "x-dsh-filemanager": "1" };

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "delete-api-test-"));
    handler = createHandler(dir, { gitStatusCache: createGitStatusCache({ ttlMs: 0, collect: (root) => debugCollectStatuses(root) }) });
    await mkdir(join(dir, "sub"));
    await writeFile(join(dir, "tracked.txt"), "t");
    await writeFile(join(dir, "untracked.txt"), "u");
    await writeFile(join(dir, "sub", "nested.js"), "n");
    await execFileAsync("git", ["init"], { cwd: dir });
    await execFileAsync("git", ["config", "user.email", "t@e.c"], { cwd: dir });
    await execFileAsync("git", ["config", "user.name", "T"], { cwd: dir });
    await execFileAsync("git", ["add", "tracked.txt", "sub/nested.js"], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: dir });
    await writeFile(join(dir, "tracked.txt"), "changed"); // modified
  });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it("reports kinds and isRoot=false for files and dirs", async () => {
    const file = await request(handler, "/filemanager-fs/delete-info?hint=" + encodeURIComponent(dir) + "&path=tracked.txt", hdr);
    assert.equal(file.status, 200);
    assert.equal(file.body.kind, "file");
    assert.equal(file.body.isRoot, false);
    assert.equal(file.body.uncommitted, true); // modified
    const dirRes = await request(handler, "/filemanager-fs/delete-info?hint=" + encodeURIComponent(dir) + "&path=sub", hdr);
    assert.equal(dirRes.body.kind, "dir");
    assert.equal(dirRes.body.uncommitted, false);
  });

  it("counts untracked files as uncommitted but never ignored", async () => {
    const u = await request(handler, "/filemanager-fs/delete-info?hint=" + encodeURIComponent(dir) + "&path=untracked.txt", hdr);
    assert.equal(u.body.uncommitted, true);
    const sub = await request(handler, "/filemanager-fs/delete-info?hint=" + encodeURIComponent(dir) + "&path=sub", hdr);
    assert.equal(sub.body.uncommitted, false); // nested.js committed
  });

  it("reports isRoot=true for an empty path and errors for escapes/missing", async () => {
    const root = await request(handler, "/filemanager-fs/delete-info?hint=" + encodeURIComponent(dir) + "&path=", hdr);
    assert.equal(root.status, 200);
    assert.equal(root.body.isRoot, true);
    const esc = await request(handler, "/filemanager-fs/delete-info?hint=" + encodeURIComponent(dir) + "&path=../x", hdr);
    assert.equal(esc.status, 403);
    const miss = await request(handler, "/filemanager-fs/delete-info?hint=" + encodeURIComponent(dir) + "&path=nope.txt", hdr);
    assert.equal(miss.status, 404);
  });

  it("requires the header", async () => {
    const res = await request(handler, "/filemanager-fs/delete-info?hint=" + encodeURIComponent(dir) + "&path=tracked.txt");
    assert.equal(res.status, 403);
  });

  it("reports uncommitted=true for a wholly-untracked dir via its collapsed row", async () => {
    await mkdir(join(dir, "newdir"));
    await writeFile(join(dir, "newdir", "fresh.txt"), "f"); // never git-added
    const res = await request(handler, "/filemanager-fs/delete-info?hint=" + encodeURIComponent(dir) + "&path=newdir", hdr);
    assert.equal(res.status, 200);
    assert.equal(res.body.kind, "dir");
    assert.equal(res.body.uncommitted, true);
    // a clean tracked dir stays uncommitted false
    const clean = await request(handler, "/filemanager-fs/delete-info?hint=" + encodeURIComponent(dir) + "&path=sub", hdr);
    assert.equal(clean.body.uncommitted, false);
  });

  it("preflights a dangling symlink as symlink-file", async () => {
    await symlink(join(dir, "does-not-exist"), join(dir, "dangling-link"));
    const res = await request(handler, "/filemanager-fs/delete-info?hint=" + encodeURIComponent(dir) + "&path=dangling-link", hdr);
    assert.equal(res.status, 200);
    assert.equal(res.body.kind, "symlink-file");
  });
});
