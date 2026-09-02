// src/Panel.tsx
import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from "react";
import { fetchRoot, fetchList, sortEntries, type Entry, type ListResponse } from "./api.js";
import { fetchFile } from "./preview-api.js";
import { isMarkdownFile, renderMarkdown } from "./markdown-preview.js";
import { highlightSource } from "./syntax-highlighting.js";
import { clampPosition, type Point } from "./preview-position.js";
import { Tree, type TreeHandle } from "./Tree.js";
import { createLiveRefreshCoordinator, staleExpandedPathsUnder, type FileChange } from "./live-refresh.js";
import { createSseEventSource } from "./sse-client.js";
import type { FileManagerStore } from "./store.js";

interface PanelProps {
  open: boolean;
  sidebarLeft: number;
  hint: string;
  onClose: () => void;
  store: FileManagerStore;
}

type Status = "loading" | "ready" | "error" | "no-workspace";

export type PreviewPresentation =
  | { kind: "rendered"; html: string; blockedExternalImages: number; unavailableLocalImages: number }
  | { kind: "source" | "highlighted-source"; content: string; html?: string | null; error?: string };

export function getPreviewPresentation(
  fileName: string,
  content: string,
  truncated: boolean,
  mode: "source" | "rendered",
  workspaceHint: string,
): PreviewPresentation {
  const highlighted = highlightSource(fileName, content, truncated);
  if (!isMarkdownFile(fileName) || mode === "source") {
    return highlighted.highlighted
      ? { kind: "highlighted-source", content, html: highlighted.html }
      : { kind: "source", content };
  }
  try {
    return { kind: "rendered", ...renderMarkdown(content, { filePath: fileName, workspaceHint }) };
  } catch (error) {
    return { kind: "source", content, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Pure confirmation state for the changed-preview banner. The coordinator's
 * change callback delivers debounced per-path changes; these helpers match
 * them against the current preview identity (the preview path; workspace
 * identity is already enforced by the coordinator's hint-keyed lifecycle)
 * and drive the banner's show / dismiss / refresh-clear transitions.
 */
export type ChangedPreviewState =
  | { kind: "idle" }
  | { kind: "changed"; path: string; changeKind: FileChangeKind }
  | { kind: "dismissed"; path: string };

export type FileChangeKind = FileChange["kind"];

/**
 * Reduce a change batch against the current preview path. Changes for other
 * files never show the banner; a matching event shows it (repeated events for
 * an already-shown file keep a single banner); a dismissed banner re-appears
 * only for a new event of the same file; a banner for a different file than
 * the current preview is stale and is cleared.
 */
export function reduceChangedPreview(
  state: ChangedPreviewState,
  changes: FileChange[],
  previewPath: string | null
): ChangedPreviewState {
  if (previewPath === null) return { kind: "idle" };
  if (state.kind !== "idle" && state.path !== previewPath) {
    state = { kind: "idle" };
  }
  const match = changes.find((change) => change.path === previewPath);
  if (!match) return state;
  if (state.kind === "changed" && state.path === match.path) return state;
  return { kind: "changed", path: match.path, changeKind: match.kind };
}

/** Hide the banner and remember the file until its next change event. */
export function dismissChangedPreview(state: ChangedPreviewState): ChangedPreviewState {
  return state.kind === "changed" ? { kind: "dismissed", path: state.path } : state;
}

/** Clear the banner after a successful refresh. */
export function clearChangedPreview(): ChangedPreviewState {
  return { kind: "idle" };
}

export function Panel({ open, sidebarLeft, hint, onClose, store }: PanelProps) {
  const treeRef = useRef<TreeHandle | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [rootName, setRootName] = useState("");
  const [rootPath, setRootPath] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState("");
  // True while the polling fallback is active (SSE unavailable).
  const [liveFallback, setLiveFallback] = useState(false);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTitle, setPreviewTitle] = useState("");
  const [previewPath, setPreviewPath] = useState("");
  const previewMode = useSyncExternalStore(store.subscribe, () => store.getState().previewMode);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [previewContent, setPreviewContent] = useState("");
  const [previewTruncated, setPreviewTruncated] = useState(false);
  const [previewPos, setPreviewPos] = useState<Point | null>(null);
  const [previewSize, setPreviewSize] = useState<{ width: number; height: number } | null>(null);
  // Changed-preview confirmation banner state (idle | changed | dismissed).
  const [changedPreview, setChangedPreview] = useState<ChangedPreviewState>({ kind: "idle" });

  const previewWindowRef = useRef<HTMLDivElement | null>(null);
  const previewPosRef = useRef<Point | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const lastSizeRef = useRef<{ width: number; height: number } | null>(null);
  // Latest preview path for the coordinator's change callback without
  // restarting the EventSource whenever a file is opened.
  const previewPathRef = useRef(previewPath);

  // Keep a ref in sync with the position state so drag-start always sees the
  // latest position (also across multiple consecutive drags).
  useEffect(() => {
    previewPosRef.current = previewPos;
  }, [previewPos]);

  useEffect(() => {
    previewPathRef.current = previewPath;
  }, [previewPath]);

  // Устанавливаем текущий воркспейс в store при изменении hint
  useEffect(() => {
    if (hint) {
      store.setWorkspace(hint);
    }
  }, [hint, store]);

  const handleError = useCallback((msg: string) => {
    // Show inline error for individual folder failures
    console.warn("[filemanager]", msg);
  }, []);

  // When a root listing no longer contains an expanded top-level directory,
  // that directory (and its expanded descendants) cannot exist anymore; prune
  // it from the store so the live subscription stops watching a missing path.
  const pruneRootStale = useCallback((listRes: ListResponse) => {
    if (listRes.truncated) return;
    const stale = staleExpandedPathsUnder(
      "",
      listRes.entries.map((entry) => entry.name),
      store.getExpandedPaths()
    );
    if (stale.length > 0) store.pruneExpandedPaths(stale);
  }, [store]);

  const loadRoot = useCallback(async () => {
    if (!hint) {
      setStatus("no-workspace");
      return;
    }

    setStatus("loading");
    setError("");

    try {
      const rootRes = await fetchRoot(hint);
      setRootPath(rootRes.root);
      setRootName(rootRes.name);

      const listRes = await fetchList(hint, "");
      setEntries(sortEntries(listRes.entries));
      pruneRootStale(listRes);
      setStatus("ready");
    } catch (err: any) {
      setError(err.message);
      setStatus("error");
    }
  }, [hint, pruneRootStale]);

  // Live refresh of the root listing without flashing the loading state;
  // the last known entries are preserved on failure.
  const refreshRootEntries = useCallback(async () => {
    if (!hint) return;
    try {
      const rootRes = await fetchRoot(hint);
      setRootPath(rootRes.root);
      setRootName(rootRes.name);
      const listRes = await fetchList(hint, "");
      setEntries(sortEntries(listRes.entries));
      pruneRootStale(listRes);
    } catch (err: any) {
      handleError(`Failed to refresh root: ${err.message}`);
    }
  }, [hint, handleError, pruneRootStale]);

  // Route affected directories from the live-refresh coordinator: the root
  // listing is owned by the Panel, deeper directories by the Tree handle.
  const handleRefreshDirs = useCallback((paths: string[]) => {
    for (const path of paths) {
      if (path === "") {
        refreshRootEntries();
      } else {
        treeRef.current?.refreshPaths([path]);
      }
    }
  }, [refreshRootEntries]);

  // Coordinator change callback: match the debounced change batch against the
  // current preview identity. Reading previewPath through a ref keeps the
  // callback stable, so opening files never restarts the EventSource.
  const handleFileChanges = useCallback((changes: FileChange[]) => {
    setChangedPreview((prev) => reduceChangedPreview(prev, changes, previewPathRef.current));
  }, []);

  // «Обновить»: re-fetch the current hint/path; clear the banner only after a
  // successful load. On failure the existing preview error display surfaces
  // the read error and the banner stays for another attempt or dismiss.
  const handleRefreshChangedPreview = useCallback(async () => {
    if (!hint || !previewPath) return;
    setPreviewLoading(true);
    try {
      const res = await fetchFile(hint, previewPath);
      setPreviewContent(res.content);
      setPreviewTruncated(Boolean(res.truncated));
      setPreviewError("");
      setChangedPreview({ kind: "idle" });
    } catch (err: any) {
      setPreviewError(err?.message ?? String(err));
    } finally {
      setPreviewLoading(false);
    }
  }, [hint, previewPath]);

  // «Оставить текущую версию»: hide the banner until the file's next event.
  const handleDismissChangedPreview = useCallback(() => {
    setChangedPreview((prev) => dismissChangedPreview(prev));
  }, []);

  const commitLayout = useCallback(() => {
    const el = previewWindowRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    store.setPreviewLayout({
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    });
  }, [store]);

  const handleOpenFile = useCallback(async (fullPath: string, entry: Entry) => {
    if (!hint) return;
    // Восстанавливаем сохранённое расположение панели для этого воркспейса
    const layout = store.getState().previewLayout;
    setPreviewPos(layout ? { x: layout.x, y: layout.y } : null);
    setPreviewSize(layout ? { width: layout.width, height: layout.height } : null);
    setPreviewTitle(entry.name);
    setPreviewPath(fullPath);
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError("");
    setPreviewContent("");
    setPreviewTruncated(false);
    setChangedPreview({ kind: "idle" });
    try {
      const res = await fetchFile(hint, fullPath);
      setPreviewContent(res.content);
      setPreviewTruncated(Boolean(res.truncated));
    } catch (err: any) {
      setPreviewError(err?.message ?? String(err));
    } finally {
      setPreviewLoading(false);
    }
  }, [hint, store]);

  const handleClosePreview = useCallback(() => {
    setPreviewOpen(false);
    setPreviewPos(null);
    setPreviewSize(null);
    dragRef.current = null;
    setChangedPreview({ kind: "idle" });
  }, []);

  const handleDragStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // Не перетаскиваем, если нажатие пришлось на кнопку (например, ✕)
    if ((e.target as HTMLElement).closest("button")) return;
    const el = previewWindowRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const current = previewPosRef.current ?? { x: rect.left, y: rect.top };
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: current.x,
      origY: current.y,
    };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
    e.preventDefault();
  }, []);

  const handleDragMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    const el = previewWindowRef.current;
    if (!d || !el) return;
    const nx = d.origX + (e.clientX - d.startX);
    const ny = d.origY + (e.clientY - d.startY);
    const rect = el.getBoundingClientRect();
    const clamped = clampPosition(
      nx,
      ny,
      rect.width,
      rect.height,
      window.innerWidth,
      window.innerHeight
    );
    setPreviewPos(clamped);
  }, []);

  const handleDragEnd = useCallback(() => {
    dragRef.current = null;
    commitLayout();
  }, [commitLayout]);

  // Следим за изменением размера (CSS resize) и сохраняем layout по воркспейсу
  useEffect(() => {
    if (!previewOpen) return;
    const el = previewWindowRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      const next = { width: rect.width, height: rect.height };
      const prev = lastSizeRef.current;
      // Обновляем state только при реальном изменении размера,
      // иначе каждый кадр порождает ре-рендер (и рост панели).
      if (!prev || prev.width !== next.width || prev.height !== next.height) {
        lastSizeRef.current = next;
        setPreviewSize(next);
      }
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        store.setPreviewLayout({
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        });
      }, 250);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [previewOpen, store]);

  // Load on mount and when hint changes
  useEffect(() => {
    loadRoot();
  }, [loadRoot]);

  // Live refresh: Panel owns the EventSource lifecycle keyed by hint and the
  // expanded relative paths. The coordinator is recreated per hint/open so it
  // always captures the current workspace; stop() closes the source, cancels
  // the debounce and unsubscribes (no duplicate subscriptions).
  useEffect(() => {
    if (!open || !hint) return;
    const coordinator = createLiveRefreshCoordinator({
      hint,
      getExpandedPaths: store.getExpandedPaths,
      subscribeExpandedPaths: store.subscribeExpandedPaths,
      refreshDirs: handleRefreshDirs,
      onFileChange: handleFileChanges,
      onError: handleError,
      // Fetch-based SSE: the events endpoint requires the security header,
      // which the native EventSource cannot send (403 -> permanent polling
      // fallback), so the client streams the same framing through fetch.
      createEventSource: (url) => createSseEventSource(url),
      listDir: async (path: string) => {
        const res = await fetchList(hint, path);
        return res.entries;
      },
      onFallbackChange: setLiveFallback,
    });
    coordinator.start();
    return () => coordinator.stop();
  }, [open, hint, store, handleRefreshDirs, handleFileChanges, handleError]);

  const handleRefresh = useCallback(() => {
    loadRoot();
  }, [loadRoot]);

  const previewStyle: React.CSSProperties = {
    ...(previewPos ? { left: previewPos.x, top: previewPos.y, right: "auto" } : {}),
    ...(previewSize ? { width: previewSize.width, height: previewSize.height } : {}),
  };
  const previewPresentation = getPreviewPresentation(
    previewPath || previewTitle, previewContent, previewTruncated, previewMode, hint,
  );
  const markdownFile = isMarkdownFile(previewTitle);

  return (
    <>
      <div
        className={`fm-panel-clip${open ? " fm-panel-clip--open" : ""}`}
        style={{ left: sidebarLeft }}
      >
        <div className={`fm-panel${open ? " fm-panel--open" : ""}`}>
          <div className="fm-header">
            <span className="fm-header-title" title={rootPath}>
              {rootName || "Файлы"}
            </span>
            <button
              className="fm-header-btn"
              onClick={handleRefresh}
              title="Обновить"
            >
              ↻
            </button>
            <button className="fm-header-btn" onClick={onClose} title="Закрыть">
              ✕
            </button>
          </div>

          {status === "loading" && (
            <div className="fm-loading">
              <span className="fm-spinner" /> Загрузка…
            </div>
          )}

          {status === "error" && (
            <div className="fm-error">
              <div>Ошибка: {error}</div>
              <button onClick={handleRefresh}>Повторить</button>
            </div>
          )}

          {status === "no-workspace" && (
            <div className="fm-empty">Нет воркспейса</div>
          )}

          {liveFallback && (
            <div
              role="status"
              className="fm-live-fallback"
              style={{
                padding: "6px 10px",
                borderBottom: "1px solid var(--fm-border)",
                color: "var(--dsw-alias-label-secondary)",
                fontSize: "12px",
              }}
            >
              Автообновление: опрос каталогов (SSE недоступен)
            </div>
          )}

          {status === "ready" && (
            <Tree
              ref={treeRef}
              hint={hint}
              entries={entries}
              onError={handleError}
              store={store}
              onOpenFile={handleOpenFile}
            />
          )}
        </div>
      </div>

      {previewOpen && (
        <div
          className="fm-preview-window"
          ref={previewWindowRef}
          style={previewStyle}
        >
          <div
            className="fm-preview-header"
            onPointerDown={handleDragStart}
            onPointerMove={handleDragMove}
            onPointerUp={handleDragEnd}
            onPointerCancel={handleDragEnd}
          >
            <span className="fm-preview-title">{previewTitle}</span>
            {markdownFile && (
              <div className="fm-preview-toggle" role="group" aria-label="Режим Markdown">
                <button type="button" className={previewMode === "source" ? "is-active" : ""} aria-pressed={previewMode === "source"} onClick={() => store.setPreviewMode("source")}>Исходник</button>
                <button type="button" className={previewMode === "rendered" ? "is-active" : ""} aria-pressed={previewMode === "rendered"} onClick={() => store.setPreviewMode("rendered")}>Предпросмотр</button>
              </div>
            )}
            <button
              className="fm-preview-close"
              onClick={handleClosePreview}
              title="Закрыть"
            >
              ✕
            </button>
          </div>
          {changedPreview.kind === "changed" && (
            <div role="alert" className="fm-preview-changed">
              <span className="fm-preview-changed-text">Файл изменён на диске</span>
              <span className="fm-preview-changed-actions">
                <button
                  type="button"
                  className="fm-preview-changed-btn fm-preview-changed-btn--primary"
                  onClick={handleRefreshChangedPreview}
                >
                  Обновить
                </button>
                <button
                  type="button"
                  className="fm-preview-changed-btn"
                  onClick={handleDismissChangedPreview}
                >
                  Оставить текущую версию
                </button>
              </span>
            </div>
          )}
          <div className="fm-preview-body">
            {previewLoading && (
              <div className="fm-loading">
                <span className="fm-spinner" /> Загрузка…
              </div>
            )}
            {!previewLoading && previewError && (
              <div className="fm-error">Ошибка: {previewError}</div>
            )}
            {!previewLoading && !previewError && previewPresentation.kind === "rendered" && (
              <div className="fm-markdown-content" dangerouslySetInnerHTML={{ __html: previewPresentation.html }} />
            )}
            {!previewLoading && !previewError && previewPresentation.kind !== "rendered" && (
              <pre className={previewPresentation.kind === "highlighted-source" ? "fm-modal-pre fm-modal-pre--highlighted" : "fm-modal-pre"} dangerouslySetInnerHTML={previewPresentation.html ? { __html: previewPresentation.html } : undefined}>{previewPresentation.html ? undefined : previewPresentation.content}</pre>
            )}
            {!previewLoading && !previewError && previewPresentation.kind !== "rendered" && previewPresentation.error && (
              <div className="fm-preview-render-error">Предпросмотр недоступен: {previewPresentation.error}</div>
            )}
            {!previewLoading && !previewError && previewPresentation.kind === "rendered" && previewPresentation.unavailableLocalImages > 0 && (
              <div className="fm-preview-warning" role="status">Локальные изображения недоступны в предпросмотре.</div>
            )}
            {!previewLoading && previewTruncated && (
              <div className="fm-preview-warning" role="status">Файл усечён до 5 МБ; показано не всё содержимое.</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}