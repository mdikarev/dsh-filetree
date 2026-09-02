import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdtemp, rm, mkdir, writeFile, symlink, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createGitStatusCache } from "../src/git-status-cache.js";
import { createHandler, debugCollectStatuses } from "../src/fs-api.js";

const execFileAsync = promisify(execFile);

function request(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  path: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      await handler(req, res);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      const url = `http://127.0.0.1:${addr.port}${path}`;
      fetch(url, { headers })
        .then(async (res) => {
          const body = await res.json();
          server.close();
          resolve({ status: res.status, body });
        })
        .catch((err) => {
          server.close();
          reject(err);
        });
    });
  });
}

describe("fs-api", () => {
  let tempDir: string;
  let handler: ReturnType<typeof createHandler>;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "fs-api-test-"));
    // Always-fresh cache (ttlMs 0) keeps this suite's base uncached-fresh
    // semantics deterministic: its shared fixture mutates between requests,
    // which the production 2s-TTL default cache would otherwise staleness-
    // mask within the TTL window. Caching behavior itself is covered by the
    // "git-status cache integration" describe below.
    handler = createHandler(tempDir, {
      gitStatusCache: createGitStatusCache({
        ttlMs: 0,
        collect: (root) => debugCollectStatuses(root),
      }),
    });
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("GET /filemanager-fs/root", () => {
    it("returns canonical root and basename", async () => {
      const { status, body } = await request(
        handler,
        "/filemanager-fs/root",
        { "x-dsh-filemanager": "1" }
      );
      assert.strictEqual(status, 200);
      assert.strictEqual((body as any).name, basename(tempDir));
      assert.ok((body as any).root.length > 0);
    });

    it("returns 403 without x-dsh-filemanager header", async () => {
      const { status, body } = await request(handler, "/filemanager-fs/root");
      assert.strictEqual(status, 403);
      assert.ok((body as any).error.includes("header"));
    });
  });

  describe("GET /filemanager-fs/list", () => {
    before(async () => {
      // Create test structure
      await mkdir(join(tempDir, "subdir"));
      await mkdir(join(tempDir, "node_modules"));
      await mkdir(join(tempDir, ".git")); // should be filtered
      await mkdir(join(tempDir, ".hidden")); // dotfile dir, should appear
      await writeFile(join(tempDir, "file.txt"), "hello");
      await writeFile(join(tempDir, ".dotfile"), "secret");
      await writeFile(join(tempDir, "subdir", "nested.js"), "code");
      await writeFile(join(tempDir, ".gitignore"), `node_modules/\nignored-dir/\nignored-file.log\n`);
      await mkdir(join(tempDir, "ignored-dir"));
      await writeFile(join(tempDir, "ignored-file.log"), "skip me");

      await execFileAsync("git", ["init"], { cwd: tempDir });
      await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: tempDir });
      await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: tempDir });
      await execFileAsync("git", ["add", ".gitignore", "file.txt", ".dotfile", "subdir/nested.js"], { cwd: tempDir });
      await execFileAsync("git", ["commit", "-m", "init"], { cwd: tempDir });
      await writeFile(join(tempDir, "subdir", "nested.js"), "changed after commit");

    });

    it("lists root directory entries", async () => {
      const { status, body } = await request(
        handler,
        `/filemanager-fs/list?hint=${encodeURIComponent(tempDir)}&path=`,
        { "x-dsh-filemanager": "1" }
      );
      assert.strictEqual(status, 200);
      const entries = (body as any).entries as Array<{ name: string; kind: string }>;
      const names = entries.map((e) => e.name);

      // Check filtering
      assert.ok(names.includes("node_modules"), "ignored node_modules should be visible");
      assert.ok(!names.includes(".git"), ".git should be filtered");

      // Check dotfiles present
      assert.ok(names.includes(".hidden"), ".hidden dir should appear");
      assert.ok(names.includes(".dotfile"), ".dotfile should appear");

      // Check regular entries
      assert.ok(names.includes("subdir"));
      assert.ok(names.includes("file.txt"));
    });

    it("returns kind for each entry", async () => {
      const { status, body } = await request(
        handler,
        `/filemanager-fs/list?hint=${encodeURIComponent(tempDir)}&path=`,
        { "x-dsh-filemanager": "1" }
      );
      const entries = (body as any).entries as Array<{ name: string; kind: string; gitStatus?: string; gitStatusSummary?: string[] }>;
      const subdir = entries.find((e) => e.name === "subdir");
      const file = entries.find((e) => e.name === "file.txt");
      assert.strictEqual(subdir?.kind, "dir");
      assert.strictEqual(subdir?.gitStatus, "modified");
      assert.deepStrictEqual(subdir?.gitStatusSummary, ["modified"]);
      assert.strictEqual(file?.kind, "file");
    });

    it("includes ignored file and directory git markers", async () => {
      const { status, body } = await request(
        handler,
        `/filemanager-fs/list?hint=${encodeURIComponent(tempDir)}&path=`,
        { "x-dsh-filemanager": "1" }
      );

      assert.strictEqual(status, 200);
      const entries = (body as any).entries as Array<{ name: string; kind: string; gitStatus?: string; gitStatusSummary?: string[] }>;
      const ignoredDir = entries.find((entry) => entry.name === "ignored-dir");
      const ignoredFile = entries.find((entry) => entry.name === "ignored-file.log");
      const subdir = entries.find((entry) => entry.name === "subdir");
      assert.strictEqual(ignoredDir?.gitStatus, undefined);
      assert.deepStrictEqual(ignoredDir?.gitStatusSummary, undefined);
      assert.strictEqual(ignoredFile?.gitStatus, "ignored");
      assert.strictEqual(subdir?.gitStatus, "modified");
      assert.deepStrictEqual(subdir?.gitStatusSummary, ["modified"]);
    });

    it("marks contents of ignored directories as ignored", async () => {
      await mkdir(join(tempDir, "ignored-dir", "inner"));
      await writeFile(join(tempDir, "ignored-dir", "inner", "secret.txt"), "x");

      const { status, body } = await request(
        handler,
        `/filemanager-fs/list?hint=${encodeURIComponent(tempDir)}&path=ignored-dir/inner`,
        { "x-dsh-filemanager": "1" }
      );
      assert.strictEqual(status, 200);
      const entries = (body as any).entries as Array<{ name: string; kind: string; gitStatus?: string; gitStatusSummary?: string[] }>;
      assert.strictEqual(entries.find((e) => e.name === "secret.txt")?.gitStatus, "ignored");
      assert.deepStrictEqual(entries.find((e) => e.name === "secret.txt")?.gitStatusSummary, ["ignored"]);
    });

    it("lists nested directory", async () => {
      const { status, body } = await request(
        handler,
        `/filemanager-fs/list?hint=${encodeURIComponent(tempDir)}&path=subdir`,
        { "x-dsh-filemanager": "1" }
      );
      assert.strictEqual(status, 200);
      const entries = (body as any).entries as Array<{ name: string }>;
      const names = entries.map((e) => e.name);
      assert.ok(names.includes("nested.js"));
    });

    it("returns 403 for path traversal attempt", async () => {
      const { status, body } = await request(
        handler,
        `/filemanager-fs/list?hint=${encodeURIComponent(tempDir)}&path=../../../etc`,
        { "x-dsh-filemanager": "1" }
      );
      assert.strictEqual(status, 403);
      assert.ok((body as any).error.includes("escape"));
    });

    it("returns 404 for non-existent path", async () => {
      const { status } = await request(
        handler,
        `/filemanager-fs/list?hint=${encodeURIComponent(tempDir)}&path=nonexistent`,
        { "x-dsh-filemanager": "1" }
      );
      assert.strictEqual(status, 404);
    });

    it("returns 400 when path is a file", async () => {
      const { status, body } = await request(
        handler,
        `/filemanager-fs/list?hint=${encodeURIComponent(tempDir)}&path=file.txt`,
        { "x-dsh-filemanager": "1" }
      );
      assert.strictEqual(status, 400);
      assert.ok((body as any).error.includes("directory"));
    });

    it("returns 403 when listing a symlink that escapes the root", async () => {
      const outsideDir = await mkdtemp(join(tmpdir(), "fs-api-outside-"));
      try {
        await symlink(outsideDir, join(tempDir, "escape-link"), "dir");
        const { status, body } = await request(
          handler,
          `/filemanager-fs/list?hint=${encodeURIComponent(tempDir)}&path=escape-link`,
          { "x-dsh-filemanager": "1" }
        );
        assert.strictEqual(status, 403);
        assert.ok((body as any).error.includes("escape"));
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });
  });
});

describe("git-status cache integration", () => {
  let tempDir: string;
  let canonical: string; // realpath of tempDir: cache keys are realpath'd
  let handler: ReturnType<typeof createHandler>;
  let collectCount: number;
  let invalidateRoot: (root: string) => void;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "fs-api-cache-"));
    canonical = await realpath(tempDir); // macOS: /var -> /private/var etc.
    await writeFile(join(tempDir, "tracked.txt"), "one");
    await execFileAsync("git", ["init"], { cwd: tempDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: tempDir });
    await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: tempDir });
    await execFileAsync("git", ["add", "tracked.txt"], { cwd: tempDir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: tempDir });

    collectCount = 0;
    // fullCache keeps the real SnapshotCache<GitEntry> type for the
    // handler option; invalidateRoot is a narrow alias for assertions.
    const fullCache = createGitStatusCache({
      ttlMs: 60_000, // isolate TTL: only invalidation may trigger a rerun
      collect: async (root: string) => {
        collectCount += 1;
        return debugCollectStatuses(root);
      },
    });
    invalidateRoot = (root: string) => fullCache.invalidate(root);
    handler = createHandler(tempDir, { gitStatusCache: fullCache });
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("shares one git run across a burst of listings", async () => {
    for (let i = 0; i < 3; i += 1) {
      const { status } = await request(
        handler,
        "/filemanager-fs/list?hint=" + encodeURIComponent(tempDir) + "&path=",
        { "x-dsh-filemanager": "1" }
      );
      assert.strictEqual(status, 200);
    }
    assert.strictEqual(collectCount, 1);
  });

  it("recomputes after invalidate and reflects a new untracked file", async () => {
    await writeFile(join(tempDir, "fresh.txt"), "new");
    invalidateRoot(canonical);
    const { status, body } = await request(
      handler,
      "/filemanager-fs/list?hint=" + encodeURIComponent(tempDir) + "&path=",
      { "x-dsh-filemanager": "1" }
    );
    assert.strictEqual(status, 200);
    assert.strictEqual(collectCount, 2);
    const names = ((body as any).entries as Array<{ name: string }>).map((e) => e.name);
    assert.ok(names.includes("fresh.txt"), "new file must appear after invalidation");
    const fresh = ((body as any).entries as Array<{ name: string; gitStatus?: string }>).find(
      (e) => e.name === "fresh.txt"
    );
    assert.strictEqual(fresh?.gitStatus, "untracked");
  });
});
