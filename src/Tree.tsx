// src/Tree.tsx
import { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle, type MouseEvent as ReactMouseEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { fetchList, sortEntries, getGitStatusBadge, getDirectoryGitStatus, getEntryGitTone, type Entry, type ListResponse } from "./api.js";
import { staleExpandedPathsUnder } from "./live-refresh.js";
import { DRAG_MIME, encodeDragPayload, buildDragMention } from "./drag-drop.js";
import { showNameTooltip, hideNameTooltip, repositionNameTooltip, type TooltipToken } from "./tooltip.js";
import type { FileManagerStore } from "./store.js";
import { useL10n } from "./use-l10n.js";
import { treeNavStep, type TreeNavKey } from "./tree-nav.js";

interface TreeNodeProps {
  level: number;
  entry: Entry;
  hint: string;
  path: string;
  /** Folder load/refresh failures; retry target = failing directory path. */
  onError: (msg: string, path?: string) => void;
  onOpenFile: (fullPath: string, entry: Entry) => void;
  onRowContextMenu?: (path: string, name: string, kind: string, point: { x: number; y: number }, anchor: HTMLElement) => void;
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

function TreeNode({ level, entry, hint, path, onError, onOpenFile, onRowContextMenu, store, registerReload }: TreeNodeProps) {
  const [children, setChildren] = useState<Entry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [, forceUpdate] = useState({});

  // Полное имя при обрезке: замер делаем в момент наведения по DOM (не по
  // состоянию), чтобы не зависеть от перерендеров строки.
  const nameRef = useRef<HTMLSpanElement | null>(null);
  const tooltipToken = useRef<TooltipToken>({});
  const hoverTimerRef = useRef<number | null>(null);
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const tipActiveRef = useRef(false);
  const [tipActive, setTipActive] = useState(false);

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
        onError(`Failed to refresh ${fullPath}: ${err.message}`, fullPath);
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
          onError(`Failed to load ${fullPath}: ${err.message}`, fullPath);
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
      // Collapsing drops the cached listing so the next expand always fetches
      // a fresh one: while collapsed the directory is not watched (the reload
      // registration is removed), so a cached children list could go stale
      // (files added on disk would not appear until a manual refresh).
      setChildren(null);
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
        onError(`Failed to load ${fullPath}: ${err.message}`, fullPath);
        setChildren([]);
      } finally {
        setLoading(false);
      }
    }
    store.togglePath(fullPath);
  }, [isDir, expanded, children, hint, fullPath, entry.kind, onError, store, applyListing]);

  const handleRowKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const key = e.key;
    if (key === "ContextMenu" || (e.shiftKey && key === "F10")) {
      e.preventDefault();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      onRowContextMenu?.(fullPath, entry.name, entry.kind, { x: rect.left, y: rect.bottom }, e.currentTarget as HTMLElement);
      return;
    }
    if (key === "Enter" || key === " ") {
      e.preventDefault();
      handleToggle();
      return;
    }
    if (isDir && (key === "ArrowRight" || key === "ArrowLeft")) {
      const wantsExpand = key === "ArrowRight";
      if ((wantsExpand && !expanded) || (!wantsExpand && expanded)) {
        e.preventDefault();
        handleToggle();
      }
    }
  };

  // --- Tooltip с полным именем для обрезанных названий -------------------

  const cancelPendingTip = useCallback(() => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  const hideFullNameTip = useCallback(() => {
    cancelPendingTip();
    tipActiveRef.current = false;
    setTipActive(false);
    hideNameTooltip(tooltipToken.current);
  }, [cancelPendingTip]);

  // Название обрезано? Читаем геометрию прямо в момент наведения: ellipsis
  // активен, когда текст шире видимой области (scrollWidth > clientWidth).
  const isNameClipped = useCallback((): boolean => {
    const el = nameRef.current;
    return el !== null && el.scrollWidth > el.clientWidth + 1;
  }, []);

  const scheduleFullNameTip = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      cancelPendingTip();
      // Показываем подсказку только если имя действительно не влезает.
      if (!isNameClipped()) return;
      cursorRef.current = { x: e.clientX, y: e.clientY };
      // Небольшая задержка, чтобы тултип не мигал при движении мыши по дереву.
      hoverTimerRef.current = window.setTimeout(() => {
        hoverTimerRef.current = null;
        const cursor = cursorRef.current ?? { x: e.clientX, y: e.clientY };
        tipActiveRef.current = true;
        setTipActive(true);
        showNameTooltip(tooltipToken.current, entry.name, cursor);
      }, 400);
    },
    [cancelPendingTip, entry.name, isNameClipped]
  );

  const trackCursor = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    cursorRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  // Снять наш таймер/тултип при размонтировании строки (сворачивание папки,
  // смена воркспейса и т.п.), чтобы не осталось «осиротевшего» тултипа.
  useEffect(() => {
    const token = tooltipToken.current;
    return () => {
      if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
      hideNameTooltip(token);
    };
  }, []);

  // Пока тултип виден: прячем при прокрутке/колесе (контент под курсором
  // уезжает) и перепозиционируем при ресайзе окна.
  useEffect(() => {
    if (!tipActive) return;
    const onResize = () => {
      if (tipActiveRef.current && cursorRef.current) {
        repositionNameTooltip(tooltipToken.current, cursorRef.current);
      }
    };
    const hide = () => {
      if (tipActiveRef.current) hideFullNameTip();
    };
    window.addEventListener("scroll", hide, { capture: true, passive: true });
    window.addEventListener("wheel", hide, { capture: true, passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", hide, { capture: true });
      window.removeEventListener("wheel", hide, { capture: true });
      window.removeEventListener("resize", onResize);
    };
  }, [tipActive, hideFullNameTip]);

  return (
    <div>
      <div
        className={`fm-row${isDir ? " fm-row--dir" : ""}${entryTone ? ` fm-row--${entryTone}` : ""}`}
        role="treeitem"
        aria-level={level}
        tabIndex={0}
        {...(isDir ? { "aria-expanded": expanded } : {})}
        onClick={handleToggle}
        onKeyDown={handleRowKeyDown}
        onContextMenu={(event) => {
          event.preventDefault();
          onRowContextMenu?.(fullPath, entry.name, entry.kind, { x: event.clientX, y: event.clientY }, event.currentTarget as HTMLElement);
        }}
        draggable
        onMouseDown={hideFullNameTip}
        onMouseEnter={scheduleFullNameTip}
        onMouseMove={trackCursor}
        onMouseLeave={hideFullNameTip}
        onDragStart={(e) => {
          hideFullNameTip();
          e.dataTransfer.setData(DRAG_MIME, encodeDragPayload(fullPath, entry.kind));
          const mention = buildDragMention(fullPath, entry.kind);
          if (mention !== undefined) e.dataTransfer.setData("text/plain", mention);
          e.dataTransfer.effectAllowed = "copy";
        }}
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
        <span ref={nameRef} className="fm-row-name">{entry.name}</span>
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
              level={level + 1}
              entry={child}
              hint={hint}
              path={fullPath}
              onError={onError}
              store={store} onOpenFile={onOpenFile}
              onRowContextMenu={onRowContextMenu}
              registerReload={registerReload}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface TreeProps {
  label: string;
  hint: string;
  entries: Entry[];
  onError: (msg: string, path?: string) => void;
  onOpenFile: (fullPath: string, entry: Entry) => void;
  onRowContextMenu?: (path: string, name: string, kind: string, point: { x: number; y: number }, anchor: HTMLElement) => void;
  store: FileManagerStore;
}

/**
 * Imperative handle used by the Panel's live-refresh coordinator to
 * invalidate specific expanded directories in place.
 */
export interface TreeHandle {
  refreshPaths(paths: string[]): void;
}

export const Tree = forwardRef<TreeHandle, TreeProps>(function Tree({ label, hint, entries, onError, onOpenFile, onRowContextMenu, store }, ref) {
  const { t } = useL10n();
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

  const handleTreeKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const key = e.key as TreeNavKey;
    if (key !== "ArrowUp" && key !== "ArrowDown" && key !== "Home" && key !== "End") return;
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(".fm-row"));
    if (rows.length === 0) return;
    const current = rows.indexOf(document.activeElement as HTMLElement);
    const next = treeNavStep(current, rows.length, key);
    if (next !== null) {
      e.preventDefault();
      rows[next].focus();
    }
  };

  const sorted = sortEntries(entries);

  if (sorted.length === 0) {
    return <div className="fm-empty">{t("emptyFolder")}</div>;
  }

  return (
    <div className="fm-tree" role="tree" aria-label={label} onKeyDown={handleTreeKeyDown}>
      {sorted.map((entry) => (
        <TreeNode
          key={entry.name}
          level={1}
          entry={entry}
          hint={hint}
          path=""
          onError={onError}
          store={store} onOpenFile={onOpenFile}
          onRowContextMenu={onRowContextMenu}
          registerReload={registerReload}
        />
      ))}
    </div>
  );
});
