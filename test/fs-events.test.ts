import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert";
import { mkdtemp, rm, mkdir, writeFile, symlink, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { execFileSync } from "node:child_process";
import {
  parseWatchedPaths,
  normalizeFsEvent,
  createEventsHandler,
  activeWatchCount,
  activeGitWatchCount,
} from "../src/fs-events.js";
import { createHandler } from "../src/fs-api.js";

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

type WaitOptions = {
  timeoutMs?: number;
  intervalMs?: number;
  message?: string;
};

// Condition-based wait with a generous bounded timeout: the full suite runs
// test files in parallel processes, so fs.watch event delivery (writeFile ->
// FSEvents/kqueue -> watcher callback -> SSE write -> fetch reader) can stall
// well beyond a few hundred ms under CPU contention. A tight fixed bound turns
// that contention into false failures (observed: 3056ms once under load).
async function waitFor(
  fn: () => boolean,
  { timeoutMs = 10000, intervalMs = 10, message = "condition not met" }: WaitOptions = {}
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (fn()) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor timed out after ${timeoutMs}ms: ${message}`);
    }
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

function gitChangedCount(text: string): number {
  let count = 0;
  for (const block of text.split("\n\n")) {
    if (block.split("\n").some((l) => l.trim() === "event: git-changed")) count += 1;
  }
  return count;
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

// macOS FSEvents can drop a single watch notification under parallel load
// (verified empirically: the dropped event never arrives, but the next fresh
// write is delivered promptly). fs.watch therefore cannot guarantee delivery
// of any one event within a bounded time, so assert the end-to-end pipeline
// with bounded retries: write a fresh file per attempt and require at least
// one normalized event to be delivered.
async function expectChangeEvent(
  conn: SseConnection,
  write: (attempt: number) => Promise<string>,
  message: string
): Promise<void> {
  const MAX_ATTEMPTS = 5;
  const ATTEMPT_TIMEOUT_MS = 5000;
  const failures: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const relPath = await write(attempt);
    try {
      await waitFor(
        () =>
          changedEvents(conn.buffer()).some(
            (e) => e.type === "changed" && e.path === relPath && (e.kind === "change" || e.kind === "rename")
          ),
        { timeoutMs: ATTEMPT_TIMEOUT_MS, message: `${message} (${relPath})` }
      );
      return;
    } catch (err) {
      failures.push(String((err as Error).message));
    }
  }
  throw new Error(`${message}: no change event delivered after ${MAX_ATTEMPTS} attempts: ${failures.join(" | ")}`);
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
    await waitFor(() => activeWatchCount() === 0, { message: "active watchers drained after test" });
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
        await waitFor(() => activeWatchCount() === 1, { message: "subdir watcher created" });
        await expectChangeEvent(
          conn,
          async (attempt) => {
            const name = attempt === 1 ? "new.txt" : `new-${attempt}.txt`;
            await writeFile(join(tempDir, "subdir", name), "hello");
            return `subdir/${name}`;
          },
          "subdir file change event"
        );
      } finally {
        await conn.close();
      }
    });

    it("emits events for root-level changes when watching the root", async () => {
      const conn = await openSse(handler, `hint=${encodeURIComponent(tempDir)}&paths=${encodeURIComponent(JSON.stringify([""]))}`);
      try {
        await waitFor(() => activeWatchCount() === 1, { message: "root watcher created" });
        await expectChangeEvent(
          conn,
          async (attempt) => {
            const name = attempt === 1 ? "root-file.txt" : `root-file-${attempt}.txt`;
            await writeFile(join(tempDir, name), "x");
            return name;
          },
          "root-level change event"
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
        await waitFor(() => activeWatchCount() === 1, { message: "root watcher created" });
        // Prove the stream is live with a normal event first (retrying fresh
        // writes because macOS FSEvents can drop a single notification).
        await expectChangeEvent(
          conn,
          async (attempt) => {
            const name = attempt === 1 ? "before-git.txt" : `before-git-${attempt}.txt`;
            await writeFile(join(tempDir, name), "x");
            return name;
          },
          "before-git.txt change event"
        );
        const countBefore = changedEvents(conn.buffer()).length;
        await appendFile(join(tempDir, ".git", "HEAD"), "\nupdated\n");
        // Bounded grace window instead of a fixed sleep: a fixed wall-clock wait
        // can miss late-arriving .git events under parallel load. Any event with
        // a .git path inside the window fails the test.
        const graceStart = Date.now();
        let gitEvent: ChangedEvent | undefined;
        while (Date.now() - graceStart < 1000) {
          gitEvent = changedEvents(conn.buffer()).find((e) => e.path.split("/").includes(".git"));
          if (gitEvent) break;
          await new Promise((r) => setTimeout(r, 25));
        }
        const countAfter = changedEvents(conn.buffer()).length;
        assert.strictEqual(gitEvent, undefined, "no events from .git");
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

  describe("git-changed events", () => {
    it("emits git-changed when .git/index changes", async () => {
      const conn = await openSse(handler, `hint=${encodeURIComponent(tempDir)}&paths=${encodeURIComponent(JSON.stringify([""]))}`);
      try {
        await waitFor(() => activeGitWatchCount() >= 1, { message: "git metadata watcher created" });
        await writeFile(join(tempDir, ".git", "index"), "staged");
        await waitFor(() => gitChangedCount(conn.buffer()) >= 1, { message: "git-changed after index write" });
      } finally {
        await conn.close();
      }
    });

    it("emits git-changed when a branch ref changes", async () => {
      await mkdir(join(tempDir, ".git", "refs", "heads"), { recursive: true });
      const conn = await openSse(handler, `hint=${encodeURIComponent(tempDir)}&paths=${encodeURIComponent(JSON.stringify([""]))}`);
      try {
        await waitFor(() => activeGitWatchCount() >= 2, { message: "git metadata watchers created" });
        await writeFile(join(tempDir, ".git", "refs", "heads", "main"), "abc123\n");
        await waitFor(() => gitChangedCount(conn.buffer()) >= 1, { message: "git-changed after ref write" });
      } finally {
        await conn.close();
      }
    });

    it("does not emit git-changed for workspace content changes", async () => {
      const conn = await openSse(handler, `hint=${encodeURIComponent(tempDir)}&paths=${encodeURIComponent(JSON.stringify(["", "subdir"]))}`);
      try {
        await waitFor(() => activeWatchCount() === 2, { message: "workspace watchers created" });
        await expectChangeEvent(
          conn,
          async (attempt) => {
            const name = attempt === 1 ? "plain.txt" : `plain-${attempt}.txt`;
            await writeFile(join(tempDir, "subdir", name), "hello");
            return `subdir/${name}`;
          },
          "workspace change event"
        );
        assert.ok(gitChangedCount(conn.buffer()) === 0, "no git-changed for workspace content");
      } finally {
        await conn.close();
      }
    });

    it("emits no git-changed and creates no git watchers without a .git directory", async () => {
      const plain = await mkdtemp(join(tmpdir(), "fs-events-plain-"));
      const plainHandler = createEventsHandler(plain);
      const conn = await openSse(plainHandler, `hint=${encodeURIComponent(plain)}&paths=${encodeURIComponent(JSON.stringify([""]))}`);
      try {
        await waitFor(() => activeWatchCount() === 1, { message: "root watcher created" });
        assert.strictEqual(activeGitWatchCount(), 0, "no git watchers without .git");
        await expectChangeEvent(
          conn,
          async (attempt) => {
            const name = attempt === 1 ? "a.txt" : `a-${attempt}.txt`;
            await writeFile(join(plain, name), "x");
            return name;
          },
          "workspace change without git"
        );
        assert.ok(gitChangedCount(conn.buffer()) === 0, "no git-changed without .git");
      } finally {
        await conn.close();
        await rm(plain, { recursive: true, force: true });
      }
    });

    it("cleans up git metadata watchers on disconnect", async () => {
      const conn = await openSse(handler, `hint=${encodeURIComponent(tempDir)}&paths=${encodeURIComponent(JSON.stringify([""]))}`);
      await waitFor(() => activeGitWatchCount() >= 1, { message: "git watchers created" });
      conn.abort();
      await waitFor(() => activeGitWatchCount() === 0, { message: "git watchers drained" });
      await conn.close();
    });
  });


  describe("no feedback loop between list and git-changed", () => {
    it("listing a git workspace does not emit git-changed", async () => {
      const repo = await mkdtemp(join(tmpdir(), "fs-events-git-"));
      try {
        const git = (args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" }).toString();
        git(["init", "-q"]);
        git(["config", "user.email", "t@t.dev"]);
        git(["config", "user.name", "T"]);
        await writeFile(join(repo, "a.txt"), "v1");
        git(["add", "a.txt"]);
        git(["commit", "-q", "-m", "init"]);

        const handler = createHandler(repo);
        const server = createServer(async (req, res) => {
          try {
            await handler(req, res);
          } catch {
            // handler owns its errors
          }
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const addr = server.address() as { port: number };
        const base = `http://127.0.0.1:${addr.port}`;
        const controller = new AbortController();
        const chunks: string[] = [];
        const decoder = new TextDecoder();
        try {
          const sseRes = await fetch(
            `${base}/filemanager-fs/events?hint=${encodeURIComponent(repo)}&paths=${encodeURIComponent(JSON.stringify([""]))}`,
            { headers: { "x-dsh-filemanager": "1" }, signal: controller.signal }
          );
          assert.strictEqual(sseRes.status, 200);
          const reader = sseRes.body!.getReader();
          const readLoop = (async () => {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(decoder.decode(value, { stream: true }));
            }
          })();
          await waitFor(() => activeWatchCount() === 1, { message: "root watcher created" });

          // Simulate the client refresh cycle: every list runs git status.
          for (let i = 0; i < 8; i += 1) {
            const listRes = await fetch(`${base}/filemanager-fs/list?hint=${encodeURIComponent(repo)}&path=`, {
              headers: { "x-dsh-filemanager": "1" },
            });
            await listRes.json();
            await new Promise((r3) => setTimeout(r3, 150));
          }

          const gitChanged = chunks
            .join("")
            .split("\n\n")
            .filter((b) => b.includes("event: git-changed")).length;
          assert.strictEqual(
            gitChanged,
            0,
            "git status run by list must not trigger git-changed (feedback loop)"
          );
          controller.abort();
          await readLoop.catch(() => {});
        } finally {
          controller.abort();
          (server as any).closeAllConnections?.();
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    });
  });

});

describe("git-status cache invalidation", () => {
  let tempDir: string;
  let invalidated: string[];
  let handler: Handler;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "fs-events-cache-"));
    await writeFile(join(tempDir, "tracked.txt"), "one");
    execFileSync("git", ["init"], { cwd: tempDir });
    execFileSync("git", ["config", "user.email", "t@e.c"], { cwd: tempDir });
    execFileSync("git", ["config", "user.name", "T"], { cwd: tempDir });
    execFileSync("git", ["add", "tracked.txt"], { cwd: tempDir });
    execFileSync("git", ["commit", "-m", "init"], { cwd: tempDir });

    invalidated = [];
    // The events handler only needs the invalidate half of the cache;
    // use the handler directly (openSse already targets the events URL).
    handler = createEventsHandler(tempDir, {
      invalidate: (root: string) => {
        invalidated.push(root);
      },
    });
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("invalidates on a git metadata change (commit)", async () => {
    const conn = await openSse(handler, "hint=" + encodeURIComponent(tempDir) + "&paths=%5B%5D");
    try {
      // The git metadata watchers start after the SSE headers are flushed, so
      // wait for them before mutating the repo (same pattern as the
      // git-changed tests): a commit racing watcher registration would be
      // missed entirely and invalidated would stay empty.
      await waitFor(() => activeGitWatchCount() >= 1, { message: "git metadata watcher created" });
      await writeFile(join(tempDir, "tracked.txt"), "two");
      execFileSync("git", ["add", "tracked.txt"], { cwd: tempDir });
      execFileSync("git", ["commit", "-m", "second"], { cwd: tempDir });
      await waitFor(() => invalidated.length >= 1, { message: "git change did not invalidate" });
    } finally {
      await conn.close();
    }
  });

  it("invalidates on a workspace fs change", async () => {
    // Watch the workspace root: paths=[""] — an empty paths array (paths=[])
    // creates NO workspace watcher (parseWatchedPaths returns []), so a file
    // write could never reach the invalidate call below.
    const conn = await openSse(
      handler,
      "hint=" + encodeURIComponent(tempDir) + "&paths=" + encodeURIComponent(JSON.stringify([""]))
    );
    try {
      await waitFor(() => activeWatchCount() === 1, { message: "root watcher created" });
      const before = invalidated.length;
      // macOS FSEvents can drop a single watch notification under parallel
      // load (see expectChangeEvent), so write a fresh file per attempt.
      const MAX_ATTEMPTS = 5;
      const failures: string[] = [];
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        const name = attempt === 1 ? "note.txt" : "note-" + attempt + ".txt";
        await writeFile(join(tempDir, name), "hello");
        try {
          await waitFor(() => invalidated.length > before, {
            timeoutMs: 5000,
            message: "fs change did not invalidate",
          });
          return;
        } catch (err) {
          failures.push(String((err as Error).message));
        }
      }
      throw new Error(
        "fs change did not invalidate after " + MAX_ATTEMPTS + " attempts: " + failures.join(" | ")
      );
    } finally {
      await conn.close();
    }
  });
});

describe("heartbeat", () => {
  it("emits event: ping blocks at the injected interval while connected", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "fs-events-hb-"));
    try {
      const handler = createEventsHandler(tempDir, undefined, { heartbeatMs: 40 });
      const conn = await openSse(handler, "hint=" + encodeURIComponent(tempDir) + "&paths=%5B%5D");
      try {
        await waitFor(() => conn.buffer().includes("event: ping"), {
          message: "no heartbeat ping received",
        });
      } finally {
        await conn.close();
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
