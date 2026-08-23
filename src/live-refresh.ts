// src/live-refresh.ts
import { buildEventsUrl } from "./api.js";
import { createDirectoryPoller, POLL_INTERVAL_MS, type DirectoryPoller, type PolledEntry } from "./live-polling.js";

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

/**
 * Debounce window used by the live refresh coordinator, in the spec's
 * 200-300ms range. Exported so tests can pin the production wiring.
 */
export const LIVE_REFRESH_DEBOUNCE_MS = 250;

/**
 * Return the deduplicated union of directories that must be re-fetched for a
 * batch of changes: the expanded parent of each nested change plus the root
 * (empty string) for root-level changes, because the root listing is always
 * visible. Changes inside closed directories never produce a directory.
 */
export function affectedDirsForChanges(changes: FileChange[], expandedPaths: string[]): string[] {
  const affected: string[] = [];
  const seen = new Set<string>();
  for (const change of changes) {
    const parent = parentDirectory(change.path);
    if (parent === "") {
      if (!seen.has("")) {
        seen.add("");
        affected.push("");
      }
      continue;
    }
    for (const dir of affectedExpandedDirectories(change.path, expandedPaths)) {
      if (!seen.has(dir)) {
        seen.add(dir);
        affected.push(dir);
      }
    }
  }
  return affected;
}

/**
 * Compare two path lists as unordered sets.
 */
export function samePathSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  for (let i = 0; i < sortedA.length; i += 1) {
    if (sortedA[i] !== sortedB[i]) return false;
  }
  return true;
}

/**
 * Exponential backoff for EventSource reconnects: attempt is the number of
 * previous failed attempts (0 = first retry), capped at maxMs.
 */
export function backoffDelay(attempt: number, baseMs: number, maxMs: number): number {
  if (baseMs <= 0) return 0;
  const exponent = Math.min(attempt, 30);
  return Math.min(baseMs * 2 ** exponent, maxMs);
}

/**
 * Minimal EventSource surface used by the coordinator so tests can inject a
 * fake and the browser's native EventSource is structurally compatible.
 */
export interface LiveEventSource {
  addEventListener(type: string, handler: (event: any) => void): void;
  close(): void;
}

export interface LiveRefreshCoordinatorOptions {
  /** Current workspace hint; changes restart the subscription. */
  hint: string;
  /** Snapshot of the currently expanded relative directories. */
  getExpandedPaths(): string[];
  /** Subscribe to expanded-path changes; returns an unsubscribe function. */
  subscribeExpandedPaths(listener: () => void): () => void;
  /** Invoked with the affected directories after a debounced change batch. */
  refreshDirs(paths: string[]): void;
  /**
   * Invoked with the debounced, per-path deduplicated change batch, so the
   * panel can match change events against its current preview identity.
   * Delivered alongside refreshDirs for the same batch.
   */
  onFileChange?(changes: FileChange[]): void;
  onError?(message: string): void;
  /** Injectable EventSource factory (browser EventSource in production). */
  createEventSource(url: string): LiveEventSource;
  /**
   * Fetch one relative expanded directory's raw entries; when provided the
   * coordinator can activate the polling fallback when SSE fails.
   */
  listDir?(path: string): Promise<PolledEntry[]>;
  /** Polling cadence for the fallback; defaults to POLL_INTERVAL_MS (5000). */
  pollIntervalMs?: number;
  /** Invoked when the polling fallback activates (true) or SSE recovers (false). */
  onFallbackChange?(active: boolean): void;
  debounceMs?: number;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
}

export interface LiveRefreshCoordinator {
  start(): void;
  stop(): void;
  setHint(hint: string): void;
}

/**
 * Client-side SSE lifecycle coordinator. Owns exactly one EventSource at a
 * time, keyed by the current hint and expanded-path set; closes the old
 * source before opening a replacement; parses SSE payloads defensively and
 * drops events from stale (old workspace / restarted) sources; debounces
 * batches with a trailing window; invalidates only affected expanded
 * directories via refreshDirs; and reconnects with exponential backoff after
 * an error. When listDir is provided, an EventSource error (initial failure
 * or repeated reconnect failure) activates the polling fallback over the
 * current expanded directories; a successful reconnect stops it, so SSE keeps
 * priority whenever it is healthy.
 */
export function createLiveRefreshCoordinator(
  options: LiveRefreshCoordinatorOptions
): LiveRefreshCoordinator {
  const debounceMs = options.debounceMs ?? LIVE_REFRESH_DEBOUNCE_MS;
  const reconnectBaseMs = options.reconnectBaseMs ?? 500;
  const reconnectMaxMs = options.reconnectMaxMs ?? 10000;

  let started = false;
  let hint = options.hint;
  let expandedPaths: string[] = [...options.getExpandedPaths()];
  let source: LiveEventSource | null = null;
  let epoch = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  let unsubscribe: (() => void) | null = null;
  let poller: DirectoryPoller | null = null;

  const startPoller = (): void => {
    if (!started || !options.listDir || poller !== null) return;
    poller = createDirectoryPoller({
      getExpandedPaths: () => [...expandedPaths],
      listDir: options.listDir,
      onChanged: (paths) => {
        if (started) options.refreshDirs(paths);
      },
      pollIntervalMs: options.pollIntervalMs ?? POLL_INTERVAL_MS,
    });
    poller.start();
    options.onFallbackChange?.(true);
  };

  const stopPoller = (): void => {
    if (poller === null) return;
    poller.stop();
    poller = null;
    options.onFallbackChange?.(false);
  };

  const debouncer = createDebouncer(debounceMs, (changes) => {
    if (!started) return;
    options.onFileChange?.(changes);
    const dirs = affectedDirsForChanges(changes, options.getExpandedPaths());
    if (dirs.length > 0) options.refreshDirs(dirs);
  });

  const closeSource = (): void => {
    const current = source;
    source = null;
    if (current) {
      try {
        current.close();
      } catch {
        // already closed
      }
    }
  };

  const clearReconnectTimer = (): void => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const scheduleReconnect = (): void => {
    if (!started || reconnectTimer !== null) return;
    const delayMs = backoffDelay(reconnectAttempt, reconnectBaseMs, reconnectMaxMs);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!started) return;
      openSource();
    }, delayMs);
  };

  const openSource = (): void => {
    if (!started) return;
    epoch += 1;
    const myEpoch = epoch;
    const url = buildEventsUrl(hint, expandedPaths);
    let next: LiveEventSource;
    try {
      next = options.createEventSource(url);
    } catch (err) {
      options.onError?.(`live refresh: ${err instanceof Error ? err.message : String(err)}`);
      scheduleReconnect();
      startPoller();
      return;
    }
    source = next;

    next.addEventListener("changed", (event) => {
      if (!started || myEpoch !== epoch) return;
      const change = parseSseChange(String(event?.data ?? ""));
      if (!change) return;
      debouncer.push(change);
    });

    next.addEventListener("open", () => {
      if (!started || myEpoch !== epoch) return;
      reconnectAttempt = 0;
      stopPoller();
    });

    next.addEventListener("error", () => {
      if (!started || myEpoch !== epoch) return;
      options.onError?.("live refresh connection lost; will retry");
      closeSource();
      scheduleReconnect();
      startPoller();
    });
  };

  const reconnect = (): void => {
    clearReconnectTimer();
    reconnectAttempt = 0;
    epoch += 1;
    closeSource();
    openSource();
  };

  const handleExpandedChange = (): void => {
    const next = [...options.getExpandedPaths()];
    if (samePathSet(next, expandedPaths)) return;
    expandedPaths = next;
    reconnect();
  };

  return {
    start(): void {
      if (started) return;
      started = true;
      expandedPaths = [...options.getExpandedPaths()];
      unsubscribe = options.subscribeExpandedPaths(handleExpandedChange);
      openSource();
    },
    stop(): void {
      if (!started) return;
      started = false;
      epoch += 1;
      clearReconnectTimer();
      closeSource();
      debouncer.cancel();
      stopPoller();
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    },
    setHint(nextHint: string): void {
      if (nextHint === hint) return;
      hint = nextHint;
      stopPoller();
      reconnect();
    },
  };
}
