import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdtemp, rm, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { createHandler } from "../src/fs-api.js";

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
    handler = createHandler(tempDir);
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
      await mkdir(join(tempDir, "node_modules")); // should be filtered
      await mkdir(join(tempDir, ".git")); // should be filtered
      await mkdir(join(tempDir, ".hidden")); // dotfile dir, should appear
      await writeFile(join(tempDir, "file.txt"), "hello");
      await writeFile(join(tempDir, ".dotfile"), "secret");
      await writeFile(join(tempDir, "subdir", "nested.js"), "code");
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
      assert.ok(!names.includes("node_modules"), "node_modules should be filtered");
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
      const entries = (body as any).entries as Array<{ name: string; kind: string }>;
      const subdir = entries.find((e) => e.name === "subdir");
      const file = entries.find((e) => e.name === "file.txt");
      assert.strictEqual(subdir?.kind, "dir");
      assert.strictEqual(file?.kind, "file");
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
