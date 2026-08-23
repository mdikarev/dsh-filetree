import { watch, type FSWatcher } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { resolve, sep, join, relative } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

export type FsEventKind = "rename" | "change";

export type FsChangeEvent = {
  type: "changed";
  path: string;
  kind: FsEventKind;
};

const HIDDEN_SYSTEM = new Set([".git"]);

/**
 * Registry of live FSWatcher instances owned by event streams. Exported for
 * tests and diagnostics; the SSE handler registers every watcher it creates
 * and removes it when the connection closes or errors.
 */
const activeWatchers = new Set<FSWatcher>();
const activeGitWatchers = new Set<FSWatcher>();

export function activeWatchCount(): number {
  return activeWatchers.size;
}

export function activeGitWatchCount(): number {
  return activeGitWatchers.size;
}

/**
 * Client error carrying an HTTP status, mirroring how fs-api reports bad
 * requests without relying on raw error codes.
 */
function clientError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function isInside(root: string, target: string): boolean {
  return target === root || target.startsWith(root + sep);
}

/**
 * Strict hint resolution for the events endpoint: the hint is the workspace
 * identity of the subscription, so an absent or invalid hint rejects the
 * request instead of silently falling back to the default root (which would
 * watch and stream the wrong workspace). root/list/read keep their own
 * fallback semantics; this strictness applies to events only.
 */
async function resolveStrictHint(hint: string | null): Promise<string> {
  if (hint === null || hint.trim() === "") {
    throw clientError(400, "hint is required");
  }
  let real: string;
  try {
    real = await realpath(hint);
  } catch {
    throw clientError(400, "invalid hint: " + hint);
  }
  const st = await stat(real);
  if (!st.isDirectory()) {
    throw clientError(400, "invalid hint (not a directory): " + hint);
  }
  return real;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(text);
}

function isGitInternalPath(relativePath: string): boolean {
  if (relativePath === "") return false;
  return relativePath.split("/").some((segment) => HIDDEN_SYSTEM.has(segment));
}

/**
 * Parse and validate the URL-encoded JSON array of relative watched paths.
 * Returns only safe relative paths (posix separators, no empty or dot
 * segments, no "..", no absolute or backslash paths) or throws a 400 client
 * error. An absent or empty value means "watch nothing".
 */
export function parseWatchedPaths(raw: string | null): string[] {
  if (raw === null || raw.trim() === "") return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw clientError(400, "paths must be a JSON array");
  }
  if (!Array.isArray(parsed)) {
    throw clientError(400, "paths must be a JSON array");
  }

  const seen = new Set<string>();
  const paths: string[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "string") {
      throw clientError(400, "paths entries must be strings");
    }
    if (entry.includes("\\")) {
      throw clientError(400, "backslash path is not allowed: " + entry);
    }
    if (entry.includes("\u0000")) {
      throw clientError(400, "path contains a NUL byte");
    }
    if (entry.startsWith("/")) {
      throw clientError(400, "absolute path is not allowed: " + entry);
    }
    const segments = entry.split("/");
    const clean: string[] = [];
    for (const segment of segments) {
      if (segment === "..") {
        throw clientError(400, "traversal path is not allowed: " + entry);
      }
      if (segment === "" || segment === ".") continue;
      clean.push(segment);
    }
    const normalized = clean.join("/");
    if (!seen.has(normalized)) {
      seen.add(normalized);
      paths.push(normalized);
    }
  }
  return paths;
}

/**
 * Normalize a raw fs.watch event into a workspace-relative change event.
 * Returns null when the event cannot be safely attributed: missing filename,
 * non-child filenames containing separators, paths outside the root, or any
 * path inside .git.
 */
export function normalizeFsEvent(
  root: string,
  watchedDir: string,
  filename: string | Buffer,
  kind: FsEventKind
): FsChangeEvent | null {
  if (kind !== "rename" && kind !== "change") return null;
  if (filename === null || filename === undefined) return null;
  const name = Buffer.isBuffer(filename) ? filename.toString("utf8") : String(filename);
  if (name === "" || name === "." || name === "..") return null;
  // fs.watch reports direct children; any separator means the event cannot be
  // attributed to a single child, so drop it rather than guess.
  if (name.includes("/") || name.includes("\\")) return null;
  if (!isInside(root, watchedDir)) return null;

  const full = join(watchedDir, name);
  if (!isInside(root, full)) return null;

  const rel = relative(root, full).split(sep).join("/");
  if (rel === "" || isGitInternalPath(rel)) return null;
  return { type: "changed", path: rel, kind };
}

/**
 * Create the SSE events endpoint handler: validates the security header and
 * every requested path (realpath + isInside) before creating any watcher,
 * streams normalized "event: changed" blocks, and releases all watchers on
 * response close or error.
 */
export function createEventsHandler(defaultRoot: string) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const watchers = new Set<FSWatcher>();
    const gitWatchers = new Set<FSWatcher>();
    let disposed = false;

    const dispose = (): void => {
      if (disposed) return;
      disposed = true;
      for (const watcher of watchers) {
        try {
          watcher.close();
        } catch {
          // already closed
        }
        activeWatchers.delete(watcher);
      }
      watchers.clear();
      for (const watcher of gitWatchers) {
        try {
          watcher.close();
        } catch {
          // already closed
        }
        activeGitWatchers.delete(watcher);
      }
      gitWatchers.clear();
    };

    const cleanupAndEnd = (): void => {
      dispose();
      if (!res.destroyed && !res.writableEnded) {
        try {
          res.end();
        } catch {
          // response already gone
        }
      }
    };

    /**
     * Watch git metadata so git operations (commit/stage/checkout) notify the
     * client: the workspace fs.watch intentionally ignores .git content, so
     * badges would otherwise stay stale until a manual refresh. Watches the
     * .git directory (index/HEAD/packed-refs and friends) and .git/refs/heads
     * (branch ref updates), when they exist. Git metadata can be restructured
     * by git itself (gc, pack-refs): a lost watcher is tolerated, not fatal.
     */
    const watchGitMetadata = async (root: string): Promise<void> => {
      const gitDir = join(root, ".git");
      let gitStat;
      try {
        gitStat = await stat(gitDir);
      } catch {
        return; // not a git repository
      }
      if (!gitStat.isDirectory()) return; // linked worktree / submodule: .git is a file
      if (disposed) return; // connection closed while we probed .git

      const emitGitChanged = (): void => {
        if (disposed) return;
        try {
          res.write('event: git-changed\ndata: ' + JSON.stringify({ type: "git-changed" }) + '\n\n');
        } catch {
          // connection closing; close/error handlers own cleanup
        }
      };

      for (const rel of [".", join("refs", "heads")]) {
        const target = join(gitDir, rel);
        let st;
        try {
          st = await stat(target);
        } catch {
          continue;
        }
        if (!st.isDirectory()) continue;
        if (disposed) return; // connection closed while we probed this target
        let watcher: FSWatcher;
        try {
          watcher = watch(target, () => emitGitChanged());
        } catch {
          continue;
        }
        watcher.on("error", () => {
          gitWatchers.delete(watcher);
          activeGitWatchers.delete(watcher);
          try {
            watcher.close();
          } catch {
            // already closed
          }
        });
        gitWatchers.add(watcher);
        activeGitWatchers.add(watcher);
      }
    };

    try {
      if (req.headers["x-dsh-filemanager"] !== "1") {
        return sendJson(res, 403, { error: "missing x-dsh-filemanager header" });
      }

      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] !== "filemanager-fs" || parts[1] !== "events") {
        return sendJson(res, 404, { error: "not found" });
      }

      const hint = url.searchParams.get("hint");
      const root = await resolveStrictHint(hint);
      const paths = parseWatchedPaths(url.searchParams.get("paths"));

      // Validate every path before creating any watcher.
      const watchTargets: string[] = [];
      for (const p of paths) {
        if (isGitInternalPath(p)) continue;

        const target = resolve(root, p);
        if (!isInside(root, target)) {
          throw clientError(403, "path escapes workspace: " + p);
        }

        let real: string;
        try {
          real = await realpath(target);
        } catch (err: any) {
          if (err?.code === "ENOENT") {
            throw clientError(404, "path does not exist: " + p);
          }
          throw err;
        }
        if (!isInside(root, real)) {
          throw clientError(403, "path escapes workspace: " + p);
        }

        const st = await stat(real);
        if (!st.isDirectory()) {
          throw clientError(400, "not a directory: " + p);
        }
        watchTargets.push(real);
      }

      const uniqueTargets = [...new Set(watchTargets)];

      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.flushHeaders();

      // Register cleanup before creating any watcher: the client can abort the
      // connection at any point (even between two awaits), and the close event
      // fires only once, so the listener must already be attached when the
      // first watcher exists. cleanupAndEnd is idempotent (dispose guards on a
      // disposed flag), so early registration is safe.
      res.on("close", cleanupAndEnd);
      res.on("error", cleanupAndEnd);

      for (const target of uniqueTargets) {
        let watcher: FSWatcher;
        try {
          watcher = watch(target, (eventType, filename) => {
            if (disposed) return;
            const norm = normalizeFsEvent(root, target, filename as string | Buffer, eventType as FsEventKind);
            if (!norm) return;
            try {
              res.write("event: changed\ndata: " + JSON.stringify(norm) + "\n\n");
            } catch {
              // connection closing; close/error handlers own cleanup
            }
          });
        } catch {
          dispose();
          if (!res.destroyed && !res.writableEnded) res.end();
          return;
        }
        watcher.on("error", cleanupAndEnd);
        watchers.add(watcher);
        activeWatchers.add(watcher);
      }

      await watchGitMetadata(root);
    } catch (err: any) {
      dispose();
      if (!res.headersSent) {
        const status = typeof err?.status === "number" ? err.status : 500;
        return sendJson(res, status, { error: err?.message ?? String(err) });
      }
      if (!res.destroyed && !res.writableEnded) res.end();
    }
  };
}
