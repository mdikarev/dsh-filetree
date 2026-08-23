// src/Tree.tsx
import { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from "react";
import { fetchList, sortEntries, getGitStatusBadge, getDirectoryGitStatus, getEntryGitTone, type Entry, type ListResponse } from "./api.js";
import { staleExpandedPathsUnder } from "./live-refresh.js";
import type { FileManagerStore } from "./store.js";

interface TreeNodeProps {
  entry: Entry;
  hint: string;
  path: string;
  onError: (msg: string) => void;
  onOpenFile: (fullPath: string, entry: Entry) => void;
  store: FileManagerStore;
  registerReload: (path: string, reload: (() => void) | null) => void;
}

type FileIconVariant = "code" | "data" | "doc" | "image" | "special" | "default";

export function getFileIconVariant(name: string): FileIconVariant {
  if (name === "Dockerfile") return "special";
  if (name === ".env") return "data";

  const ext = name.includes(".") ? name.split(".").pop()?.toLowerCase() ?? "" : "";

  if (["ts", "tsx", "js", "jsx", "mjs", "cjs", "go", "cs", "py", "java", "kt", "kts", "rs", "php", "rb", "sh", "bash", "zsh", "swift", "cpp", "cc", "c", "h", "hpp", "sql", "html", "css", "xml", "proto", "graphql"].includes(ext)) return "code";
  if (["json", "yml", "yaml", "toml", "ini"].includes(ext)) return "data";
  if (["md", "txt", "rst"].includes(ext)) return "doc";
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "avif"].includes(ext)) return "image";

  return "default";
}

function TreeNode({ entry, hint, path, onError, onOpenFile, store, registerReload }: TreeNodeProps) {
  const [children, setChildren] = useState<Entry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [, forceUpdate] = useState({});

  const isDir = entry.kind === "dir" || entry.kind === "symlink-dir";
  const fullPath = path ? `${path}/${entry.name}` : entry.name;
  const expanded = store.isExpanded(fullPath);
  const fileIconVariant = getFileIconVariant(entry.name);
  const entryTone = getEntryGitTone(entry);
  const gitStatus = isDir ? getDirectoryGitStatus(entry) : entry.gitStatus ?? null;
  const gitBadge = getGitStatusBadge(gitStatus ?? undefined);
  const showFolderIndicator = isDir && gitStatus !== "ignored" && gitBadge !== null;
  const showFileIndicator = !isDir && gitBadge !== null;

  // Подписываемся на изменения store
  useEffect(() => {
    const unsubscribe = store.subscribe(() => {
      forceUpdate({});
    });
    return unsubscribe;
  }, [store]);

  // Сбрасываем children при изменении hint (смена воркспейса)
  useEffect(() => {
    setChildren(null);
  }, [hint]);

  // Apply a fresh listing: update children and, unless the listing was
  // truncated (a >MAX_ENTRIES directory cannot prove absence), prune expanded
  // paths whose directory disappeared from this listing so the live
  // subscription stops watching missing directories.
  const applyListing = useCallback((res: ListResponse, nodePath: string) => {
    setChildren(sortEntries(res.entries));
    if (!res.truncated) {
      const stale = staleExpandedPathsUnder(
        nodePath,
        res.entries.map((entry) => entry.name),
        store.getExpandedPaths()
      );
      if (stale.length > 0) store.pruneExpandedPaths(stale);
    }
  }, [store]);

  // Re-fetch this directory's listing in place, keeping the last known
  // children on failure (used by live refresh invalidation).
  const reload = useCallback(() => {
    setLoading(true);
    fetchList(hint, fullPath)
      .then((res) => {
        applyListing(res, fullPath);
      })
      .catch((err: any) => {
        onError(`Failed to refresh ${fullPath}: ${err.message}`);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [hint, fullPath, onError, applyListing]);

  // Register this expanded directory so the coordinator can invalidate it.
  useEffect(() => {
    if (isDir && expanded) {
      registerReload(fullPath, reload);
      return () => registerReload(fullPath, null);
    }
  }, [isDir, expanded, fullPath, reload, registerReload]);

  // Автоматически загружаем детей для раскрытых папок при монтировании
  useEffect(() => {
    if (isDir && expanded && children === null) {
      // Symlink dirs that escape root cannot be expanded
      if (entry.kind === "symlink-dir") {
        setChildren([]); // Empty, can't traverse
        return;
      }

      setLoading(true);
      fetchList(hint, fullPath)
        .then((res) => {
          applyListing(res, fullPath);
        })
        .catch((err: any) => {
          onError(`Failed to load ${fullPath}: ${err.message}`);
          setChildren([]);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [isDir, expanded, children, hint, fullPath, entry.kind, onError, applyListing]);

  const handleToggle = useCallback(async () => {
    if (!isDir) {
      onOpenFile(fullPath, entry);
      return;
    }

    if (expanded) {
      store.togglePath(fullPath);
      return;
    }

    // Symlink dirs that escape root cannot be expanded
    if (entry.kind === "symlink-dir" && children === null) {
      store.togglePath(fullPath);
      setChildren([]); // Empty, can't traverse
      return;
    }

    if (children === null) {
      setLoading(true);
      try {
        const res = await fetchList(hint, fullPath);
        applyListing(res, fullPath);
      } catch (err: any) {
        onError(`Failed to load ${fullPath}: ${err.message}`);
        setChildren([]);
      } finally {
        setLoading(false);
      }
    }
    store.togglePath(fullPath);
  }, [isDir, expanded, children, hint, fullPath, entry.kind, onError, store, applyListing]);

  return (
    <div>
      <div
        className={`fm-row${isDir ? " fm-row--dir" : ""}${entryTone ? ` fm-row--${entryTone}` : ""}`}
        onClick={handleToggle}
      >
        <span className="fm-row-chevron">
          {isDir ? (expanded ? "▾" : "▸") : ""}
        </span>
        {isDir ? (
          <span style={{ fontSize: 14 }}>{expanded ? "📂" : "📁"}</span>
        ) : (
          <span
            className={`fm-file-icon fm-file-icon--${fileIconVariant}`}
            aria-hidden="true"
          >
            <span className="fm-file-icon-fold" />
          </span>
        )}
        <span className="fm-row-name">{entry.name}</span>
        {(showFolderIndicator || showFileIndicator) && (
          <span
            className={`fm-git-badge fm-git-badge--${entryTone ?? "changed"}${isDir ? " fm-git-badge--dir" : ""}`}
            aria-label={`Git status: ${gitStatus}`}
            title={`Git status: ${gitStatus}`}
          >
            {isDir ? "•" : gitBadge}
          </span>
        )}
        {loading && <span className="fm-spinner" />}
      </div>
      {expanded && children && children.length > 0 && (
        <div className="fm-row-children">
          {children.map((child) => (
            <TreeNode
              key={child.name}
              entry={child}
              hint={hint}
              path={fullPath}
              onError={onError}
              store={store} onOpenFile={onOpenFile}
              registerReload={registerReload}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface TreeProps {
  hint: string;
  entries: Entry[];
  onError: (msg: string) => void;
  onOpenFile: (fullPath: string, entry: Entry) => void;
  store: FileManagerStore;
}

/**
 * Imperative handle used by the Panel's live-refresh coordinator to
 * invalidate specific expanded directories in place.
 */
export interface TreeHandle {
  refreshPaths(paths: string[]): void;
}

export const Tree = forwardRef<TreeHandle, TreeProps>(function Tree({ hint, entries, onError, onOpenFile, store }, ref) {
  const reloadersRef = useRef<Map<string, () => void>>(new Map());

  const registerReload = useCallback((path: string, reload: (() => void) | null) => {
    if (reload === null) {
      reloadersRef.current.delete(path);
    } else {
      reloadersRef.current.set(path, reload);
    }
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      refreshPaths(paths: string[]): void {
        for (const path of paths) {
          const reload = reloadersRef.current.get(path);
          if (reload) reload();
        }
      },
    }),
    []
  );

  const sorted = sortEntries(entries);

  if (sorted.length === 0) {
    return <div className="fm-empty">Пустая папка</div>;
  }

  return (
    <div className="fm-tree">
      {sorted.map((entry) => (
        <TreeNode
          key={entry.name}
          entry={entry}
          hint={hint}
          path=""
          onError={onError}
          store={store} onOpenFile={onOpenFile}
          registerReload={registerReload}
        />
      ))}
    </div>
  );
});
