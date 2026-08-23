// src/live-refresh.ts
// Pure client-side coordination helpers for live tree refresh: parent/affected
// directory mapping, SSE payload parsing, and change debouncing. No React or
// filesystem dependencies; roots are represented as the empty string and every
// emitted path is a relative posix path.

export type FileChangeKind = "rename" | "change";

export type FileChange = {
  type: "changed";
  path: string;
  kind: FileChangeKind;
};

/**
 * Return the relative parent directory of a posix path. The root itself maps
 * back to the root (empty string), matching how the host reports root-level
 * events and how expanded paths represent the workspace root.
 */
export function parentDirectory(path: string): string {
  const clean = path.replace(/\/+$/, "");
  if (clean === "" || clean === "/") return "";
  const index = clean.lastIndexOf("/");
  if (index < 0) return "";
  return clean.slice(0, index);
}

/**
 * Return the deduplicated expanded directories whose listing can change as a
 * result of the given change event, preserving expanded-path order. Only the
 * parent of the changed path is refreshed: changes inside closed directories
 * must not trigger background requests, and ancestors do not need a new
 * listing because their own entries are unchanged.
 */
export function affectedExpandedDirectories(changedPath: string, expandedPaths: string[]): string[] {
  const parent = parentDirectory(changedPath);
  const seen = new Set<string>();
  const affected: string[] = [];
  for (const dir of expandedPaths) {
    if (dir === parent && !seen.has(dir)) {
      seen.add(dir);
      affected.push(dir);
    }
  }
  return affected;
}

export interface Debouncer {
  push(change: FileChange): void;
  cancel(): void;
}

/**
 * Create a trailing-edge debouncer that groups rapid pushes by path into a
 * single batch emitted after the configured delay. A push for a path already
 * buffered replaces that entry's kind, so repeated events for one file produce
 * exactly one refresh. cancel() drops pending changes and makes the debouncer
 * inert, so a disconnected coordinator never emits stale batches.
 */
export function createDebouncer(delayMs: number, emit: (changes: FileChange[]) => void): Debouncer {
  let buffer: FileChange[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const flush = (): void => {
    timer = null;
    if (cancelled) return;
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    emit(batch);
  };

  return {
    push(change: FileChange): void {
      if (cancelled) return;
      const existing = buffer.find((entry) => entry.path === change.path);
      if (existing) {
        existing.kind = change.kind;
      } else {
        buffer.push({ ...change });
      }
      clearTimer();
      timer = setTimeout(flush, delayMs);
    },
    cancel(): void {
      cancelled = true;
      clearTimer();
      buffer = [];
    },
  };
}

/**
 * Parse one SSE "data:" line (already stripped of the event framing) into a
 * FileChange, or return null for any malformed or unsafe payload. Never
 * throws: the SSE layer treats unparsable events as ignorable noise, while
 * absolute, traversal, backslash and NUL paths are rejected so the host's
 * workspace boundary is never widened by a client-side parser.
 */
export function parseSseChange(data: string): FileChange | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.type !== "changed") return null;
  if (typeof obj.path !== "string" || obj.path === "") return null;
  if (obj.kind !== "rename" && obj.kind !== "change") return null;

  const path = obj.path;
  if (path.includes("\\") || path.includes("\u0000")) return null;
  if (path.startsWith("/")) return null;
  const segments = path.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") return null;
  }

  return { type: "changed", path, kind: obj.kind };
}
