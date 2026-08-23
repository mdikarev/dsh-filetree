// src/Panel.tsx
import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from "react";
import { fetchRoot, fetchList, sortEntries, type Entry } from "./api.js";
import { fetchFile } from "./preview-api.js";
import { isMarkdownFile, renderMarkdown } from "./markdown-preview.js";
import { highlightSource } from "./syntax-highlighting.js";
import { clampPosition, type Point } from "./preview-position.js";
import { Tree } from "./Tree.js";
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
  | { kind: "rendered"; html: string; blockedExternalImages: number }
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

export function Panel({ open, sidebarLeft, hint, onClose, store }: PanelProps) {
  const [status, setStatus] = useState<Status>("loading");
  const [rootName, setRootName] = useState("");
  const [rootPath, setRootPath] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState("");

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

  const previewWindowRef = useRef<HTMLDivElement | null>(null);
  const previewPosRef = useRef<Point | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const lastSizeRef = useRef<{ width: number; height: number } | null>(null);

  // Keep a ref in sync with the position state so drag-start always sees the
  // latest position (also across multiple consecutive drags).
  useEffect(() => {
    previewPosRef.current = previewPos;
  }, [previewPos]);

  // Устанавливаем текущий воркспейс в store при изменении hint
  useEffect(() => {
    if (hint) {
      store.setWorkspace(hint);
    }
  }, [hint, store]);

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
      setStatus("ready");
    } catch (err: any) {
      setError(err.message);
      setStatus("error");
    }
  }, [hint]);

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

  const handleRefresh = useCallback(() => {
    loadRoot();
  }, [loadRoot]);

  const handleError = useCallback((msg: string) => {
    // Show inline error for individual folder failures
    console.warn("[filemanager]", msg);
  }, []);

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

          {status === "ready" && (
            <Tree
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
            {!previewLoading && !previewError && previewPresentation.error && (
              <div className="fm-preview-render-error">Предпросмотр недоступен: {previewPresentation.error}</div>
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