// src/live-polling.ts
// Polling fallback for live tree refresh: pure snapshot helpers plus a
// directory poller that reuses the coordinator's targeted invalidation
// callback. No React or filesystem dependencies; entries are structural
// (name/kind/size/mtime) so the browser's fetchList payload satisfies them
// without importing the API module.

export type PolledEntryKind = "dir" | "file" | "symlink-dir" | "symlink-file";

/** Minimal structural entry accepted by snapshot building. */
export interface PolledEntry {
  name: string;
  kind: PolledEntryKind;
  size?: number;
  mtime?: number;
}

/** One normalized entry inside a directory snapshot. */
export interface SnapshotEntry {
  name: string;
  kind: string;
  size: number | null;
  mtime: number | null;
}

/** A stable, order-independent snapshot of one directory listing. */
export interface DirectorySnapshot {
  entries: SnapshotEntry[];
}

/** Production polling cadence for the fallback, per the approved spec. */
export const POLL_INTERVAL_MS = 5000;

function entryKey(entry: SnapshotEntry): string {
  return [entry.name, entry.kind, String(entry.size ?? ""), String(entry.mtime ?? "")].join("\u0000");
}

/**
 * Build a stable snapshot from the actually available typed entry fields
 * (name, kind, size, mtime). Missing size/mtime normalize to null, extra
 * fields (e.g. git status) are ignored, and entries are sorted by a total
 * order so two listings of the same directory always produce an identical
 * snapshot regardless of fetch order. Entries without a usable name are
 * dropped because they cannot be compared across polls.
 */
export function createDirectorySnapshot(entries: PolledEntry[]): DirectorySnapshot {
  const mapped: SnapshotEntry[] = [];
  for (const entry of entries) {
    const name = String(entry?.name ?? "");
    if (name === "") continue;
    mapped.push({
      name,
      kind: String(entry?.kind ?? "file"),
      size: typeof entry?.size === "number" && Number.isFinite(entry.size) ? entry.size : null,
      mtime: typeof entry?.mtime === "number" && Number.isFinite(entry.mtime) ? entry.mtime : null,
    });
  }
  mapped.sort((a, b) => {
    const ka = entryKey(a);
    const kb = entryKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return { entries: mapped };
}

/**
 * Report whether two snapshots differ in any snapshot-relevant field. Because
 * snapshots are sorted, index i corresponds to the same entry in both when the
 * name sets are equal, so a simple field comparison detects create/delete/
 * rename (name-set differences) as well as kind, size and mtime changes. Two
 * empty snapshots compare equal, so stable empty directories never trigger a
 * refresh loop.
 */
export function hasSnapshotChanged(previous: DirectorySnapshot, next: DirectorySnapshot): boolean {
  if (previous.entries.length !== next.entries.length) return true;
  for (let i = 0; i < previous.entries.length; i += 1) {
    const a = previous.entries[i];
    const b = next.entries[i];
    if (a.name !== b.name || a.kind !== b.kind || a.size !== b.size || a.mtime !== b.mtime) {
      return true;
    }
  }
  return false;
}

export interface DirectoryPollerOptions {
  /** Snapshot of the currently expanded relative directories. */
  getExpandedPaths(): string[];
  /** Fetch one relative directory's raw entries for snapshot comparison. */
  listDir(path: string): Promise<PolledEntry[]>;
  /** Targeted invalidation callback, shared with the SSE coordinator. */
  onChanged(paths: string[]): void;
  /** Polling cadence; defaults to POLL_INTERVAL_MS (5000). */
  pollIntervalMs?: number;
}

export interface DirectoryPoller {
  start(): void;
  stop(): void;
}

/**
 * Periodically list the current expanded directories, compare snapshots and
 * invalidate only directories whose listing actually changed. The first
 * observation of a directory is a baseline (never an invalidation); a failed
 * listing keeps the previous snapshot so a transient error is not reported as
 * a mass deletion. Only the currently expanded paths are polled: snapshots of
 * closed directories are pruned and re-baselined when they reopen. A single
 * timer and an in-flight guard prevent duplicate timers and overlapping
 * cycles; stop() cancels the timer, suppresses any in-flight invalidation and
 * clears all snapshots.
 */
export function createDirectoryPoller(options: DirectoryPollerOptions): DirectoryPoller {
  const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  let started = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let epoch = 0;
  const snapshots = new Map<string, DirectorySnapshot>();

  const schedule = (): void => {
    if (!started || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      void tick();
    }, pollIntervalMs);
  };

  const tick = async (): Promise<void> => {
    if (!started || inFlight) {
      schedule();
      return;
    }
    const myEpoch = epoch;
    inFlight = true;
    try {
      const dirs = options.getExpandedPaths();
      const open = new Set(dirs);
      for (const dir of [...snapshots.keys()]) {
        if (!open.has(dir)) snapshots.delete(dir);
      }

      const changed: string[] = [];
      for (const dir of dirs) {
        let entries: PolledEntry[];
        try {
          entries = await options.listDir(dir);
        } catch {
          // Keep the last known snapshot on fetch failure; the spec preserves
          // the node's last state when fetchList fails.
          continue;
        }
        if (myEpoch !== epoch) return;
        const snapshot = createDirectorySnapshot(entries);
        const previous = snapshots.get(dir);
        snapshots.set(dir, snapshot);
        if (previous !== undefined && hasSnapshotChanged(previous, snapshot)) {
          changed.push(dir);
        }
      }
      if (myEpoch !== epoch) return;
      if (changed.length > 0) options.onChanged(changed);
    } finally {
      if (myEpoch === epoch) inFlight = false;
    }
    if (started) schedule();
  };

  return {
    start(): void {
      if (started) return;
      epoch += 1;
      started = true;
      snapshots.clear();
      schedule();
    },
    stop(): void {
      if (!started) return;
      started = false;
      epoch += 1;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      snapshots.clear();
    },
  };
}
