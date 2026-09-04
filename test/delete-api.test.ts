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
  headers: Record<string, string> = {},
  method = "GET"
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => { await handler(req, res); });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      fetch("http://127.0.0.1:" + addr.port + path, { method, headers })
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

describe("POST /filemanager-fs/delete", () => {
  let dir: string;
  let handler: ReturnType<typeof createHandler>;
  const hdr = { "x-dsh-filemanager": "1" };
  const q = (p: string) => "/filemanager-fs/delete?hint=" + encodeURIComponent(dir) + "&path=" + encodeURIComponent(p);

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "delete-api-test-"));
    handler = createHandler(dir, { gitStatusCache: createGitStatusCache({ ttlMs: 0, collect: (root) => debugCollectStatuses(root) }) });
    await mkdir(join(dir, "sub", "deep"), { recursive: true });
    await writeFile(join(dir, "a.txt"), "a");
    await writeFile(join(dir, "sub", "b.js"), "b");
    await writeFile(join(dir, "sub", "deep", "c.txt"), "c");
    await symlink(join(dir, "a.txt"), join(dir, "link-file"));
    await symlink(join(dir, "sub"), join(dir, "link-dir"));
    await writeFile(join(dir, "outside.txt"), "keep me"); // created before the outside symlink target
  });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it("requires the header and rejects non-POST-less semantics via 403 for GET", async () => {
    // The header gate runs before dispatch, so a headerless request is 403
    // regardless of method; the POST-only check lives inside the case.
    const noHeader = await request(handler, q("a.txt"));
    assert.equal(noHeader.status, 403);
  });

  it("enforces POST: GET with the header returns 405", async () => {
    const res = await request(handler, q("a.txt"), hdr);
    assert.equal(res.status, 405);
  });

  it("deletes a single file", async () => {
    const res = await request(handler, q("a.txt"), hdr, "POST");
    assert.equal(res.status, 200);
    assert.equal(res.body.deleted, true);
    await assert.rejects(import("node:fs/promises").then((fs) => fs.stat(join(dir, "a.txt"))));
  });

  it("deletes a folder recursively", async () => {
    const res = await request(handler, q("sub"), hdr, "POST");
    assert.equal(res.status, 200);
    await assert.rejects(import("node:fs/promises").then((fs) => fs.stat(join(dir, "sub"))));
  });

  it("deletes a symlink but not its target (inside or outside)", async () => {
    const outsideDir = await mkdtemp(join(tmpdir(), "delete-link-target-"));
    await writeFile(join(outsideDir, "target.txt"), "keep");
    const linkOutside = join(dir, "link-outside");
    await symlink(join(outsideDir, "target.txt"), linkOutside);
    const okLink = await request(handler, q("link-file"), hdr, "POST");
    assert.equal(okLink.status, 200);
    const okOut = await request(handler, q("link-outside"), hdr, "POST");
    assert.equal(okOut.status, 200);
    // sanity: outside target still exists (only the link was removed)
    const st = await import("node:fs/promises").then((fs) => fs.stat(join(outsideDir, "target.txt")));
    assert.ok(st.isFile());
    await rm(outsideDir, { recursive: true, force: true });
  });

  it("refuses workspace root, .git and escapes", async () => {
    const rootRes = await request(handler, q(""), hdr, "POST");
    assert.equal(rootRes.status, 403);
    // normalized-root aliases must 403 too: resolve(root, ".") === root and
    // resolve(root, "a.txt/..") === root, which would otherwise reach
    // deleteRecursive(root) and wipe the whole workspace
    const dotRes = await request(handler, q("."), hdr, "POST");
    assert.equal(dotRes.status, 403);
    const dotDotFile = await request(handler, q("a.txt/.."), hdr, "POST");
    assert.equal(dotDotFile.status, 403);
    const dotDotDir = await request(handler, q("sub/.."), hdr, "POST");
    assert.equal(dotDotDir.status, 403);
    const gitRes = await request(handler, q(".git"), hdr, "POST");
    assert.equal(gitRes.status, 403);
    const esc = await request(handler, q("../outside.txt"), hdr, "POST");
    assert.equal(esc.status, 403);
  });

  it("returns 404 for missing paths", async () => {
    const res = await request(handler, q("nope.txt"), hdr, "POST");
    assert.equal(res.status, 404);
  });
});
