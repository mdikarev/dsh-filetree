// src/Tree.tsx
import { useState, useEffect, useCallback } from "react";
import { fetchList, sortEntries, getGitStatusBadge, getDirectoryGitStatus, getEntryGitTone, type Entry } from "./api.js";
import type { FileManagerStore } from "./store.js";

interface TreeNodeProps {
  entry: Entry;
  hint: string;
  path: string;
  onError: (msg: string) => void;
  store: FileManagerStore;
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

function TreeNode({ entry, hint, path, onError, store }: TreeNodeProps) {
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
          setChildren(sortEntries(res.entries));
        })
        .catch((err: any) => {
          onError(`Failed to load ${fullPath}: ${err.message}`);
          setChildren([]);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [isDir, expanded, children, hint, fullPath, entry.kind, onError]);

  const handleToggle = useCallback(async () => {
    if (!isDir) return;

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
        setChildren(sortEntries(res.entries));
      } catch (err: any) {
        onError(`Failed to load ${fullPath}: ${err.message}`);
        setChildren([]);
      } finally {
        setLoading(false);
      }
    }
    store.togglePath(fullPath);
  }, [isDir, expanded, children, hint, fullPath, entry.kind, onError, store]);

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
              store={store}
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
  store: FileManagerStore;
}

export function Tree({ hint, entries, onError, store }: TreeProps) {
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
          store={store}
        />
      ))}
    </div>
  );
}