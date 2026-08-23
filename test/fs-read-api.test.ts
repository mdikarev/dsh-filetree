import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { createHandler } from "../src/fs-api.js";

function request(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  path: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
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

describe("fs-api read", () => {
  let tempDir: string;
  let handler: ReturnType<typeof createHandler>;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "fs-read-test-"));
    handler = createHandler(tempDir);
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns 403 without x-dsh-filemanager header", async () => {
    const { status } = await request(handler, "/filemanager-fs/read?hint=&path=");
    assert.strictEqual(status, 403);
  });

  it("returns 404 for non-existent file", async () => {
    const { status } = await request(
      handler,
      `/filemanager-fs/read?hint=${encodeURIComponent(tempDir)}&path=missing.txt`,
      { "x-dsh-filemanager": "1" }
    );
    assert.strictEqual(status, 404);
  });

  it("returns 400 when path is a directory", async () => {
    await mkdir(join(tempDir, "docs"));
    const { status, body } = await request(
      handler,
      `/filemanager-fs/read?hint=${encodeURIComponent(tempDir)}&path=docs`,
      { "x-dsh-filemanager": "1" }
    );
    assert.strictEqual(status, 400);
    assert.match(body.error, /not a file/i);
  });

  it("reads a small text file", async () => {
    await writeFile(join(tempDir, "hello.txt"), "Привет, мир!\n");
    const { status, body } = await request(
      handler,
      `/filemanager-fs/read?hint=${encodeURIComponent(tempDir)}&path=hello.txt`,
      { "x-dsh-filemanager": "1" }
    );
    assert.strictEqual(status, 200);
    assert.strictEqual(body.name, "hello.txt");
    assert.strictEqual(body.path, "hello.txt");
    assert.ok(typeof body.content === "string");
    assert.strictEqual(body.truncated ?? false, false);
  });

  it("truncates large text files beyond 5 MB", async () => {
    const bigPath = join(tempDir, "big.txt");
    const chunk = "A".repeat(1024 * 512); // 0.5 MB
    let data = "";
    for (let i = 0; i < 12; i++) data += chunk; // 6 MB
    await writeFile(bigPath, data);

    const { status, body } = await request(
      handler,
      `/filemanager-fs/read?hint=${encodeURIComponent(tempDir)}&path=big.txt`,
      { "x-dsh-filemanager": "1" }
    );
    assert.strictEqual(status, 200);
    assert.strictEqual(body.name, "big.txt");
    assert.strictEqual(body.path, "big.txt");
    assert.ok(typeof body.content === "string");
    assert.strictEqual(body.truncated, true);
    assert.ok(body.content.length <= 5 * 1024 * 1024);
  });

  it("rejects non-text files by extension", async () => {
    const imgPath = join(tempDir, "image.png");
    // PNG signature + IHDR length/data: a realistic binary whose NUL bytes the
    // content probe detects as well (a bare signature has no NUL and would be
    // probed as text).
    await writeFile(
      imgPath,
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])
    );

    const { status, body } = await request(
      handler,
      `/filemanager-fs/read?hint=${encodeURIComponent(tempDir)}&path=image.png`,
      { "x-dsh-filemanager": "1" }
    );
    assert.strictEqual(status, 400);
    assert.match(body.error, /unsupported content type/i);
  });

  it("reads an extensionless dotfile like .gitignore", async () => {
    const gitignorePath = join(tempDir, ".gitignore");
    await writeFile(gitignorePath, "node_modules/\nlib/\n");

    const { status, body } = await request(
      handler,
      `/filemanager-fs/read?hint=${encodeURIComponent(tempDir)}&path=.gitignore`,
      { "x-dsh-filemanager": "1" }
    );
    assert.strictEqual(status, 200);
    assert.strictEqual(body.name, ".gitignore");
    assert.strictEqual(body.content, "node_modules/\nlib/\n");
  });

  it("reads an extensionless text file like Makefile", async () => {
    const makePath = join(tempDir, "Makefile");
    await writeFile(makePath, "build:\n\tnpm run build\n");

    const { status, body } = await request(
      handler,
      `/filemanager-fs/read?hint=${encodeURIComponent(tempDir)}&path=Makefile`,
      { "x-dsh-filemanager": "1" }
    );
    assert.strictEqual(status, 200);
    assert.strictEqual(body.content, "build:\n\tnpm run build\n");
  });

  it("reads text with an unknown extension via content probe", async () => {
    const notesPath = join(tempDir, "notes.abc");
    await writeFile(notesPath, "some freeform text\n");

    const { status } = await request(
      handler,
      `/filemanager-fs/read?hint=${encodeURIComponent(tempDir)}&path=notes.abc`,
      { "x-dsh-filemanager": "1" }
    );
    assert.strictEqual(status, 200);
  });

  it("rejects a binary extensionless dotfile", async () => {
    const dsStorePath = join(tempDir, ".DS_Store");
    // Binary dotfile: NUL bytes inside the probe window.
    await writeFile(dsStorePath, Buffer.from([0x00, 0x00, 0x00, 0x01, 0x42, 0x75, 0x64, 0x31]));

    const { status, body } = await request(
      handler,
      `/filemanager-fs/read?hint=${encodeURIComponent(tempDir)}&path=.DS_Store`,
      { "x-dsh-filemanager": "1" }
    );
    assert.strictEqual(status, 400);
    assert.match(body.error, /unsupported content type/i);
  });

  it("returns 403 for path traversal attempt", async () => {
    const { status, body } = await request(
      handler,
      `/filemanager-fs/read?hint=${encodeURIComponent(tempDir)}&path=../../../etc/passwd`,
      { "x-dsh-filemanager": "1" }
    );
    assert.strictEqual(status, 403);
    assert.match(body.error, /escape/i);
  });
});