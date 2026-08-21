// src/Tree.tsx
import { useState, useEffect, useCallback } from "react";
import { fetchList, sortEntries, getFileColor, type Entry } from "./api.js";

interface TreeNodeProps {
  entry: Entry;
  hint: string;
  path: string;
  onError: (msg: string) => void;
}

function TreeNode({ entry, hint, path, onError }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<Entry[] | null>(null);
  const [loading, setLoading] = useState(false);

  const isDir = entry.kind === "dir" || entry.kind === "symlink-dir";
  const fullPath = path ? `${path}/${entry.name}` : entry.name;

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
            className="fm-row-icon"
            style={{ backgroundColor: getFileColor(entry.name) }}
          />
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
