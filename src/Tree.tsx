// src/Tree.tsx
import { useState, useEffect, useCallback } from "react";
import { fetchList, sortEntries, type Entry } from "./api.js";

interface TreeNodeProps {
  entry: Entry;
  hint: string;
  path: string;
  onError: (msg: string) => void;
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

function TreeNode({ entry, hint, path, onError }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<Entry[] | null>(null);
  const [loading, setLoading] = useState(false);

  const isDir = entry.kind === "dir" || entry.kind === "symlink-dir";
  const fullPath = path ? `${path}/${entry.name}` : entry.name;
  const fileIconVariant = getFileIconVariant(entry.name);

  const handleToggle = useCallback(async () => {
    if (!isDir) return;

    if (expanded) {
      setExpanded(false);
      return;
    }

    // Symlink dirs that escape root cannot be expanded
    if (entry.kind === "symlink-dir" && children === null) {
      setExpanded(true);
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
    setExpanded(true);
  }, [isDir, expanded, children, hint, fullPath, entry.kind, onError]);

  return (
    <div>
      <div
        className={`fm-row${isDir ? " fm-row--dir" : ""}`}
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
}

export function Tree({ hint, entries, onError }: TreeProps) {
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
        />
      ))}
    </div>
  );
}
