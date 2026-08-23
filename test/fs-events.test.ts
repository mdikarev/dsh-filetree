import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert";
import { mkdtemp, rm, mkdir, writeFile, symlink, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  parseWatchedPaths,
  normalizeFsEvent,
  createEventsHandler,
  activeWatchCount,
} from "../src/fs-events.js";

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

async function waitFor(fn: () => boolean, timeoutMs = 3000, intervalMs = 25): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (fn()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

type ChangedEvent = { type: string; path: string; kind: string };

function changedEvents(text: string): ChangedEvent[] {
  const out: ChangedEvent[] = [];
  for (const block of text.split("\n\n")) {
    const lines = block.split("\n");
    if (!lines.some((l) => l.trim() === "event: changed")) continue;
    const dataLine = lines.find((l) => l.startsWith("data:"));
    if (!dataLine) continue;
    try {
      out.push(JSON.parse(dataLine.slice(5).trim()));
    } catch {
      // ignore malformed data lines
    }
  }
  return out;
}

type SseConnection = {
  res: Response;
  abort: () => void;
  buffer: () => string;
  bodyDone: Promise<void>;
  close: () => Promise<void>;
};

async function openSse(
  handler: Handler,
  query: string,
  headers: Record<string, string> = {}
): Promise<SseConnection> {
  const server = createServer(async (req, res) => {
    try {
      await handler(req, res);
    } catch {
      // handler owns its errors
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as { port: number };
  const controller = new AbortController();
  const res = await fetch(
    `http://127.0.0.1:${addr.port}/filemanager-fs/events?${query}`,
    { headers: { "x-dsh-filemanager": "1", ...headers }, signal: controller.signal }
  );
  const chunks: string[] = [];
  const decoder = new TextDecoder();
  let markBodyDone: () => void = () => {};
  const bodyDone = new Promise<void>((resolvePromise) => (markBodyDone = resolvePromise));
  const readLoop = (async () => {
    try {
      const reader = res.body!.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(decoder.decode(value, { stream: true }));
      }
    } catch {
      // aborted reads are expected
    }
    markBodyDone();
  })();
  return {
    res,
    abort: () => controller.abort(),
    buffer: () => chunks.join(""),
    bodyDone,
    close: async () => {
      controller.abort();
      await readLoop.catch(() => {});
      (server as any).closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe("fs events", () => {
  let tempDir: string;
  let outsideDir: string;
  let handler: Handler;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "fs-events-test-"));
    outsideDir = await mkdtemp(join(tmpdir(), "fs-events-outside-"));
    await mkdir(join(tempDir, "subdir"));
    await mkdir(join(tempDir, ".git"));
    await writeFile(join(tempDir, ".git", "HEAD"), "ref: refs/heads/main\n");
    await mkdir(join(tempDir, "subdir", "nested"));
    await writeFile(join(tempDir, "subdir", "existing.txt"), "x");
    handler = createEventsHandler(tempDir);
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  });

  afterEach(async () => {
    // The events handler cleans watchers when connections close; assert no leaks.
    await waitFor(() => activeWatchCount() === 0);
  });

  describe("parseWatchedPaths", () => {
    it("returns [] for null and empty input", () => {
      assert.deepStrictEqual(parseWatchedPaths(null), []);
      assert.deepStrictEqual(parseWatchedPaths(""), []);
      assert.deepStrictEqual(parseWatchedPaths("[]"), []);
    });

    it("returns valid relative paths", () => {
      assert.deepStrictEqual(parseWatchedPaths('["src"]'), ["src"]);
      assert.deepStrictEqual(parseWatchedPaths('["src", "test/unit"]'), ["src", "test/unit"]);
      assert.deepStrictEqual(parseWatchedPaths('[""]'), [""]);
    });

    it("normalizes redundant separators and dot segments", () => {
      assert.deepStrictEqual(parseWatchedPaths('["src//test", "src/./test"]'), ["src/test"]);
      assert.deepStrictEqual(parseWatchedPaths('["./a"]'), ["a"]);
    });

    it("throws a client error for invalid JSON", () => {
      assert.throws(() => parseWatchedPaths("not json"), (err: any) => err?.status === 400);
      assert.throws(() => parseWatchedPaths('{"a":1}'), (err: any) => err?.status === 400);
    });

    it("throws a client error for non-string entries", () => {
      assert.throws(() => parseWatchedPaths("[42]"), (err: any) => err?.status === 400);
      assert.throws(() => parseWatchedPaths("[null]"), (err: any) => err?.status === 400);
    });

    it("throws a client error for absolute paths", () => {
      assert.throws(() => parseWatchedPaths('["/etc"]'), (err: any) => err?.status === 400);
    });

    it("throws a client error for traversal paths", () => {
      assert.throws(() => parseWatchedPaths('["../outside"]'), (err: any) => err?.status === 400);
      assert.throws(() => parseWatchedPaths('["a/../../x"]'), (err: any) => err?.status === 400);
    });

    it("throws a client error for backslash paths", () => {
      assert.throws(() => parseWatchedPaths('["..\\outside"]'), (err: any) => err?.status === 400);
      assert.throws(() => parseWatchedPaths('["a\\\\b"]'), (err: any) => err?.status === 400);
    });
  });

  describe("normalizeFsEvent", () => {
    it("normalizes events inside the root", () => {
      const root = tempDir;
      assert.deepStrictEqual(
        normalizeFsEvent(root, join(root, "subdir"), "file.txt", "change"),
        { type: "changed", path: "subdir/file.txt", kind: "change" }
      );
      assert.deepStrictEqual(
        normalizeFsEvent(root, join(root, "subdir"), "nested.js", "rename"),
        { type: "changed", path: "subdir/nested.js", kind: "rename" }
      );
    });

    it("normalizes root-level and deep-nested events", () => {
      const root = tempDir;
      assert.deepStrictEqual(normalizeFsEvent(root, root, "a.txt", "change"), {
        type: "changed",
        path: "a.txt",
        kind: "change",
      });
      assert.deepStrictEqual(
        normalizeFsEvent(root, join(root, "a", "b"), "c.txt", "rename"),
        { type: "changed", path: "a/b/c.txt", kind: "rename" }
      );
    });

    it("decodes Buffer filenames", () => {
      const root = tempDir;
      assert.deepStrictEqual(
        normalizeFsEvent(root, join(root, "subdir"), Buffer.from("buf.txt"), "change"),
        { type: "changed", path: "subdir/buf.txt", kind: "change" }
      );
    });

    it("rejects empty and missing filenames", () => {
      const root = tempDir;
      assert.strictEqual(normalizeFsEvent(root, root, "", "change"), null);
      assert.strictEqual(normalizeFsEvent(root, root, null as any, "change"), null);
      assert.strictEqual(normalizeFsEvent(root, root, undefined as any, "change"), null);
    });

    it("rejects filenames that escape the root", () => {
      const root = tempDir;
      assert.strictEqual(normalizeFsEvent(root, join(root, "subdir"), "../../etc/passwd", "rename"), null);
      assert.strictEqual(normalizeFsEvent(root, join(root, "subdir"), "../secret.txt", "rename"), null);
    });

    it("rejects events from outside the root and unwatched directories", () => {
      const root = tempDir;
      assert.strictEqual(normalizeFsEvent(root, "/elsewhere", "x.txt", "change"), null);
      assert.strictEqual(normalizeFsEvent(root, join(outsideDir), "x.txt", "change"), null);
    });

    it("rejects events inside .git", () => {
      const root = tempDir;
      assert.strictEqual(normalizeFsEvent(root, join(root, ".git"), "HEAD", "change"), null);
      assert.strictEqual(normalizeFsEvent(root, root, ".git", "rename"), null);
      assert.strictEqual(normalizeFsEvent(root, root, ".git/index", "change"), null);
    });

    it("rejects unknown kinds", () => {
      const root = tempDir;
      assert.strictEqual(normalizeFsEvent(root, root, "a.txt", "unknown" as any), null);
    });
  });

  describe("GET /filemanager-fs/events security", () => {
    it("returns 403 without x-dsh-filemanager header", async () => {
      const server = createServer(handler);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const addr = server.address() as { port: number };
      try {
        const res = await fetch(`http://127.0.0.1:${addr.port}/filemanager-fs/events?paths=%5B%22subdir%22%5D`);
        assert.strictEqual(res.status, 403);
        const body = await res.json();
        assert.ok((body as any).error.includes("header"));
      } finally {
        (server as any).closeAllConnections?.();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it("returns 400 for malformed paths JSON", async () => {
      const conn = await openSse(handler, `hint=${encodeURIComponent(tempDir)}&paths=${encodeURIComponent("not json")}`);
      try {
        assert.strictEqual(conn.res.status, 400);
        await conn.bodyDone;
        const body = JSON.parse(conn.buffer());
        assert.ok((body as any).error.includes("JSON"));
      } finally {
        await conn.close();
      }
    });

    it("returns 400 for absolute and traversal paths", async () => {
      for (const bad of ["/etc", "../outside", "a/../../x", "..\\escape"]) {
        const conn = await openSse(handler, `hint=${encodeURIComponent(tempDir)}&paths=${encodeURIComponent(JSON.stringify([bad]))}`);
        try {
          assert.strictEqual(conn.res.status, 400, `expected 400 for ${bad}`);
        } finally {
          await conn.close();
        }
      }
    });

    it("returns 403 for a symlink that escapes the workspace", async () => {
      await symlink(outsideDir, join(tempDir, "escape-link"), "dir");
      try {
        const conn = await openSse(handler, `hint=${encodeURIComponent(tempDir)}&paths=${encodeURIComponent(JSON.stringify(["escape-link"]))}`);
        try {
          assert.strictEqual(conn.res.status, 403);
          await conn.bodyDone;
          const body = JSON.parse(conn.buffer());
          assert.ok((body as any).error.includes("escape"));
        } finally {
          await conn.close();
        }
      } finally {
        await rm(join(tempDir, "escape-link"), { force: true });
      }
    });

    it("returns 404 for a nonexistent relative path", async () => {
      const conn = await openSse(handler, `hint=${encodeURIComponent(tempDir)}&paths=${encodeURIComponent(JSON.stringify(["nope"]))}`);
      try {
        assert.strictEqual(conn.res.status, 404);
      } finally {
        await conn.close();
      }
    });

    it("returns 400 when a watched path is a file", async () => {
      const conn = await openSse(handler, `hint=${encodeURIComponent(tempDir)}&paths=${encodeURIComponent(JSON.stringify(["subdir/existing.txt"]))}`);
      try {
        assert.strictEqual(conn.res.status, 400);
      } finally {
        await conn.close();
      }
    });

    it("creates no watchers before all paths validate", async () => {
      assert.strictEqual(activeWatchCount(), 0);
      const conn = await openSse(handler, `hint=${encodeURIComponent(tempDir)}&paths=${encodeURIComponent(JSON.stringify(["subdir", "nope"]))}`);
      try {
        assert.strictEqual(conn.res.status, 404);
        assert.strictEqual(activeWatchCount(), 0);
      } finally {
        await conn.close();
      }
    });

    it("rejects an invalid hint without falling back to the default root", async () => {
      const conn = await openSse(handler, `hint=${encodeURIComponent("/nonexistent-hint")}&paths=${encodeURIComponent(JSON.stringify(["subdir"]))}`);
      try {
        assert.strictEqual(conn.res.status, 400);
        assert.strictEqual(activeWatchCount(), 0, "no watchers for a rejected subscription");
        await conn.bodyDone;
        const body = JSON.parse(conn.buffer());
        assert.ok((body as any).error.includes("hint"));
      } finally {
        await conn.close();
      }
    });

    it("requires a hint for the events subscription", async () => {
      const conn = await openSse(handler, `paths=${encodeURIComponent(JSON.stringify(["subdir"]))}`);
      try {
        assert.strictEqual(conn.res.status, 400);
        assert.strictEqual(activeWatchCount(), 0);
        await conn.bodyDone;
        const body = JSON.parse(conn.buffer());
        assert.ok((body as any).error.includes("hint"));
      } finally {
        await conn.close();
      }
    });

    it("rejects a non-directory hint", async () => {
      const conn = await openSse(handler, `hint=${encodeURIComponent(join(tempDir, "subdir", "existing.txt"))}&paths=${encodeURIComponent(JSON.stringify(["subdir"]))}`);
      try {
        assert.strictEqual(conn.res.status, 400);
        assert.strictEqual(activeWatchCount(), 0);
      } finally {
        await conn.close();
      }
    });

    it("accepts a valid directory hint as the workspace root", async () => {
      const conn = await openSse(handler, `hint=${encodeURIComponent(tempDir)}&paths=${encodeURIComponent(JSON.stringify(["subdir"]))}`);
      try {
        assert.strictEqual(conn.res.status, 200);
        await waitFor(() => activeWatchCount() === 1);
      } finally {
        await conn.close();
      }
    });
  });

  describe("GET /filemanager-fs/events SSE", () => {
    it("streams SSE headers for valid relative paths", async () => {
      const conn = await openSse(handler, `hint=${encodeURIComponent(tempDir)}&paths=${encodeURIComponent(JSON.stringify(["subdir"]))}`);
      try {
        assert.strictEqual(conn.res.status, 200);
        assert.strictEqual(conn.res.headers.get("content-type"), "text/event-stream");
        assert.strictEqual(conn.res.headers.get("cache-control"), "no-cache");
        assert.strictEqual(conn.res.headers.get("connection"), "keep-alive");
        await waitFor(() => activeWatchCount() === 1);
      } finally {
        await conn.close();
      }
    });

    it("emits event: changed with JSON data for file changes", async () => {
      const conn = await openSse(handler, `hint=${encodeURIComponent(tempDir)}&paths=${encodeURIComponent(JSON.stringify(["subdir"]))}`);
      try {
        await waitFor(() => activeWatchCount() === 1);
        await writeFile(join(tempDir, "subdir", "new.txt"), "hello");
        await waitFor(() => {
          const events = changedEvents(conn.buffer());
          return events.some((e) => e.type === "changed" && e.path === "subdir/new.txt" && (e.kind === "change" || e.kind === "rename"));
        });
      } finally {
        await conn.close();
      }
    });

    it("emits events for root-level changes when watching the root", async () => {
      const conn = await openSse(handler, `hint=${encodeURIComponent(tempDir)}&paths=${encodeURIComponent(JSON.stringify([""]))}`);
      try {
        await waitFor(() => activeWatchCount() === 1);
        await writeFile(join(tempDir, "root-file.txt"), "x");
        await waitFor(() =>
          changedEvents(conn.buffer()).some((e) => e.type === "changed" && e.path === "root-file.txt")
        );
      } finally {
        await conn.close();
      }
    });

    it("watches only allowed directories and filters .git from paths", async () => {
      const conn = await openSse(handler, `hint=${encodeURIComponent(tempDir)}&paths=${encodeURIComponent(JSON.stringify(["subdir", ".git"]))}`);
      try {
        await waitFor(() => activeWatchCount() === 1);
      } finally {
        await conn.close();
      }
    });

    it("does not deliver events from inside .git", async () => {
      const conn = await openSse(handler, `hint=${encodeURIComponent(tempDir)}&paths=${encodeURIComponent(JSON.stringify([""]))}`);
      try {
        await waitFor(() => activeWatchCount() === 1);
        // Prove the stream is live with a normal event first.
        await writeFile(join(tempDir, "before-git.txt"), "x");
        await waitFor(() =>
          changedEvents(conn.buffer()).some((e) => e.type === "changed" && e.path === "before-git.txt")
        );
        const countBefore = changedEvents(conn.buffer()).length;
        await appendFile(join(tempDir, ".git", "HEAD"), "\nupdated\n");
        await new Promise((r) => setTimeout(r, 300));
        const countAfter = changedEvents(conn.buffer()).length;
        assert.strictEqual(countAfter, countBefore, "no events from .git");
      } finally {
        await conn.close();
      }
    });

    it("cleans up watchers when the client disconnects", async () => {
      const conn = await openSse(handler, `hint=${encodeURIComponent(tempDir)}&paths=${encodeURIComponent(JSON.stringify(["subdir"]))}`);
      await waitFor(() => activeWatchCount() === 1);
      conn.abort();
      await waitFor(() => activeWatchCount() === 0);
      await conn.close();
    });
  });
});