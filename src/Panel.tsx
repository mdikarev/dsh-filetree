// src/Panel.tsx
import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from "react";
import { fetchRoot, fetchList, sortEntries, type Entry, type ListResponse } from "./api.js";
import { isMarkdownFile } from "./markdown-preview.js";
import { Tree, type TreeHandle } from "./Tree.js";
import { ContextMenu } from "./ContextMenu.js";
import { buildDeleteDialogModel, isPreviewAffected } from "./delete-flow.js";
import { useDeleteFlow } from "./use-delete-flow.js";
import { usePreviewDock } from "./use-preview-dock.js";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog.js";
import { createLiveRefreshCoordinator, staleExpandedPathsUnder } from "./live-refresh.js";
import { createSseEventSource } from "./sse-client.js";
import type { FileManagerStore } from "./store.js";
import { useL10n } from "./use-l10n.js";
import { classifyPreviewKind } from "./preview-kind.js";
import { buildRawFileUrl } from "./raw-url.js";
import { noticeStore } from "./notices.js";
import { ErrorToast } from "./ErrorToast.js";
import { ImageView } from "./ImageView.js";
import { formatJson, type JsonDisplay } from "./json-view.js";

interface PanelProps {
  open: boolean;
  sidebarLeft: number;
  hint: string;
  onClose: () => void;
  store: FileManagerStore;
}

type Status = "loading" | "ready" | "error" | "no-workspace";

// Pure preview presentation + changed-preview state helpers live in
// ./preview-logic.ts (unit-tested there); imported here for use by the panel
// and re-exported so existing consumers importing from Panel keep working.
import {
  getPreviewPresentation,
  reduceChangedPreview,
  dismissChangedPreview,
  clearChangedPreview,
  type PreviewPresentation,
  type ChangedPreviewState,
  type FileChangeKind,
} from "./preview-logic.js";
export {
  getPreviewPresentation,
  reduceChangedPreview,
  dismissChangedPreview,
  clearChangedPreview,
  type PreviewPresentation,
  type ChangedPreviewState,
  type FileChangeKind,
};

export function Panel({ open, sidebarLeft, hint, onClose, store }: PanelProps) {
  const { t } = useL10n();
  const treeRef = useRef<TreeHandle | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [rootName, setRootName] = useState("");
  const [rootPath, setRootPath] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState("");
  // True while the polling fallback is active (SSE unavailable).
  const [liveFallback, setLiveFallback] = useState(false);

  // Deleted-path side effects (close an affected preview) route through a ref
  // because useDeleteFlow is created before handleClosePreview is defined.
  const handleDeletedRef = useRef<(deletedPath: string) => void>(() => {});
  const deleteFlow = useDeleteFlow({
    hint,
    store,
    onDeleted: (deletedPath) => handleDeletedRef.current(deletedPath),
  });
  const { contextMenu, pendingDelete, deleteInfo, deleteBusy, deleteError } = deleteFlow;

  // Preview dock state + logic live in usePreviewDock (open/close, content
  // fetch, drag/resize, changed-preview banner, image cap handling). It needs
  // the current hint and delete-pending state through stable getters so its
  // callbacks never recreate the live-refresh coordinator or fight Esc.
  const previewHintRef = useRef(hint);
  useEffect(() => {
    previewHintRef.current = hint;
  }, [hint]);
  const deletePendingRef = useRef(false);
  useEffect(() => {
    deletePendingRef.current = pendingDelete !== null;
  }, [pendingDelete]);
  const previewDock = usePreviewDock({
    store,
    getHint: () => previewHintRef.current,
    isDeletePending: () => deletePendingRef.current,
  });
  const {
    open: previewOpen,
    title: previewTitle,
    path: previewPath,
    loading: previewLoading,
    error: previewError,
    content: previewContent,
    truncated: previewTruncated,
    pos: previewPos,
    size: previewSize,
    changedPreview,
    imageCap,
    imageVersion,
    previewMode,
    windowRef: previewWindowRef,
    pathRef: previewPathRef,
    openFile: handleOpenFile,
    close: handleClosePreview,
    refreshChanged: handleRefreshChangedPreview,
    dismissChanged: handleDismissChangedPreview,
    receiveChanges,
    retryImage,
    dragStart: handleDragStart,
    dragMove: handleDragMove,
    dragEnd: handleDragEnd,
  } = previewDock;

  const jsonMode = useSyncExternalStore(store.subscribe, () => store.getState().jsonMode);


  // Latest workspace hint for coordinator callbacks (refreshRootEntries,
  // listDirStable) without restarting the coordinator whenever the workspace
  // changes; mirrors the previewPathRef pattern above.
  const hintRef = useRef(hint);

  useEffect(() => {
    hintRef.current = hint;
  }, [hint]);

  // The live-refresh coordinator lives for the whole open panel; hint changes
  // are routed through coordinatorRef.current.setHint (see the effects below).
  const coordinatorRef = useRef<ReturnType<typeof createLiveRefreshCoordinator> | null>(null);

  // Устанавливаем текущий воркспейс в store при изменении hint
  useEffect(() => {
    if (hint) {
      store.setWorkspace(hint);
    }
  }, [hint, store]);

  // Latest root-refresh closure for error-toast retry (handleError below is
  // created before refreshRootEntries, so retry reads through this ref).
  const refreshRootRef = useRef<() => void>(() => {});

  // Background live-refresh failures are surfaced as error toasts (not just
  // console.warn): a failed expanded-directory listing or root refresh would
  // otherwise leave the tree silently stale. The toast is deduped by message,
  // so repeated failures of the same directory keep a single notice, and its
  // «Повторить»/Retry action reloads exactly what failed: the affected
  // directory (via the Tree handle) or the root listing (via refreshRootRef).
  const handleError = useCallback((msg: string, path?: string) => {
    console.warn("[filemanager]", msg);
    noticeStore.push({
      key: msg,
      kind: "error",
      message: msg,
      retry: path
        ? () => treeRef.current?.refreshPaths([path])
        : () => refreshRootRef.current(),
    });
  }, []);

  // SSE degradation (stalled/lost connection) shows a transient warning toast:
  // the persistent liveFallback banner already communicates the polling state,
  // so this toast auto-dismisses and has no Retry (reconnect runs on its own).
  // The localized text is read through a ref so the callback stays stable and
  // the open coordinator is never recreated by a locale re-render.
  const sseWarningRef = useRef(t("liveRefreshUnavailable"));
  useEffect(() => {
    sseWarningRef.current = t("liveRefreshUnavailable");
  }, [t]);
  const handleSseError = useCallback((msg: string) => {
    console.warn("[filemanager]", msg);
    noticeStore.push({
      key: "sse-degraded",
      kind: "warning",
      message: sseWarningRef.current,
      autoDismissMs: 8000,
    });
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
    const currentHint = hintRef.current;
    if (!currentHint) return;
    try {
      const rootRes = await fetchRoot(currentHint);
      setRootPath(rootRes.root);
      setRootName(rootRes.name);
      const listRes = await fetchList(currentHint, "");
      setEntries(sortEntries(listRes.entries));
      pruneRootStale(listRes);
    } catch (err: any) {
      handleError(`Failed to refresh root: ${err.message}`);
    }
  }, [handleError, pruneRootStale]);

  useEffect(() => {
    refreshRootRef.current = refreshRootEntries;
  }, [refreshRootEntries]);

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

  // Stable listDir for the coordinator's polling fallback: read the current
  // hint through the ref so a poll in flight across a workspace switch still
  // lists the current workspace rather than the hint captured at creation.
  const listDirStable = useCallback(async (path: string) => {
    const currentHint = hintRef.current;
    if (!currentHint) return [];
    const res = await fetchList(currentHint, path);
    return res.entries;
  }, []);

  // Coordinator change callback: match the debounced change batch against the
  // current preview identity. Reading previewPath through a ref keeps the
  // callback stable, so opening files never restarts the EventSource.
  // Deleting a file/folder closes a preview of it (or of anything under a
  // deleted folder); routed through the ref set up by the delete-flow hook.
  useEffect(() => {
    handleDeletedRef.current = (deletedPath: string) => {
      if (previewPathRef.current && isPreviewAffected(deletedPath, previewPathRef.current)) {
        handleClosePreview();
      }
    };
  }, [handleClosePreview, previewPathRef]);

  // Load on mount and when hint changes
  useEffect(() => {
    loadRoot();
  }, [loadRoot]);

  // Live refresh: ONE coordinator per open panel, created with the panel's
  // current hint when it opens and stopped when it closes. It owns the
  // EventSource lifecycle, the expanded-path subscription and the polling
  // fallback for the panel's whole open lifetime; later hint changes are
  // routed through setHint (Effect B below) instead of recreating it, so this
  // effect's dependency array deliberately excludes hint.
  useEffect(() => {
    if (!open) return;
    const coordinator = createLiveRefreshCoordinator({
      hint: hintRef.current,
      getExpandedPaths: store.getExpandedPaths,
      subscribeExpandedPaths: store.subscribeExpandedPaths,
      refreshDirs: handleRefreshDirs,
      onFileChange: receiveChanges,
      onError: handleError,
      // Fetch-based SSE: the events endpoint requires the security header,
      // which the native EventSource cannot send (403 -> permanent polling
      // fallback), so the client streams the same framing through fetch.
      createEventSource: (url) => createSseEventSource(url),
      listDir: listDirStable,
      onFallbackChange: setLiveFallback,
    });
    coordinatorRef.current = coordinator;
    coordinator.start();
    return () => {
      coordinatorRef.current = null;
      coordinator.stop();
    };
  }, [open, store, handleRefreshDirs, receiveChanges, handleError, handleSseError, listDirStable]);

  // Route hint changes through setHint so the open coordinator's subscription
  // follows the panel's current workspace without a restart. Declared after
  // the store.setWorkspace effect and the root-load effect, so the store and
  // the root listing already reflect the new workspace before setHint reads
  // the expanded set.
  useEffect(() => {
    if (!open || !hint) return;
    coordinatorRef.current?.setHint(hint);
  }, [open, hint]);

  const handleRefresh = useCallback(() => {
    loadRoot();
  }, [loadRoot]);

  const previewStyle: React.CSSProperties = {
    ...(previewPos ? { left: previewPos.x, top: previewPos.y, right: "auto" } : {}),
    ...(previewSize ? { width: previewSize.width, height: previewSize.height } : {}),
  };
  const previewKind = classifyPreviewKind(previewTitle);
  const isImage = previewKind === "image";
  const isJson = previewKind === "json";
  const jsonDisplay: JsonDisplay | null = isJson ? formatJson(previewContent, jsonMode, previewTruncated) : null;
  const displayContent = isJson && jsonDisplay ? jsonDisplay.text : previewContent;
  const previewPresentation = isImage
    ? null
    : getPreviewPresentation(previewPath || previewTitle, displayContent, previewTruncated, previewMode, hint, imageCap);
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
              {rootName || t("filesFallback")}
            </span>
            <button
              className="fm-header-btn"
              onClick={handleRefresh}
              title={t("refresh")}
            >
              ↻
            </button>
            <button className="fm-header-btn" onClick={onClose} title={t("close")}>
              ✕
            </button>
          </div>

          {status === "loading" && (
            <div className="fm-loading">
              <span className="fm-spinner" /> {t("loading")}
            </div>
          )}

          {status === "error" && (
            <div className="fm-error">
              <div>{t("errorPrefix")}{error}</div>
              <button onClick={handleRefresh}>{t("retry")}</button>
            </div>
          )}

          {status === "no-workspace" && (
            <div className="fm-empty">{t("noWorkspace")}</div>
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
              {t("liveFallback")}
            </div>
          )}

          {status === "ready" && (
            <Tree
              ref={treeRef}
              label={rootName || t("filesFallback")}
              hint={hint}
              entries={entries}
              onError={handleError}
              store={store}
              onOpenFile={handleOpenFile}
              onRowContextMenu={(path, name, _kind, point, anchor) => deleteFlow.openContextMenu({ path, name, x: point.x, y: point.y, anchor })}
            />
          )}
        </div>
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          anchorRow={contextMenu.anchor}
          onClose={deleteFlow.closeContextMenu}
          items={[
            {
              id: "delete",
              label: t("deleteMenuItem"),
              danger: true,
              onSelect: deleteFlow.requestDelete,
            },
          ]}
        />
      )}

      {previewOpen && (
        <div
          className="fm-preview-window"
          ref={previewWindowRef}
          style={previewStyle}
          role="dialog"
          aria-label={previewTitle}
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
              <div className="fm-preview-toggle" role="group" aria-label={t("markdownMode")}>
                <button type="button" className={previewMode === "source" ? "is-active" : ""} aria-pressed={previewMode === "source"} onClick={() => store.setPreviewMode("source")}>{t("sourceMode")}</button>
                <button type="button" className={previewMode === "rendered" ? "is-active" : ""} aria-pressed={previewMode === "rendered"} onClick={() => store.setPreviewMode("rendered")}>{t("renderedMode")}</button>
              </div>
            )}
            {isJson && (
              <div className="fm-preview-toggle" role="group" aria-label={t("jsonMode")}>
                <button type="button" className={jsonMode === "raw" ? "is-active" : ""} aria-pressed={jsonMode === "raw"} onClick={() => store.setJsonMode("raw")}>{t("rawMode")}</button>
                <button type="button" className={jsonMode === "pretty" ? "is-active" : ""} aria-pressed={jsonMode === "pretty"} onClick={() => store.setJsonMode("pretty")}>{t("prettyMode")}</button>
              </div>
            )}
            <button
              className="fm-preview-close"
              onClick={handleClosePreview}
              title={t("close")}
            >
              ✕
            </button>
          </div>
          {changedPreview.kind === "changed" && (
            <div role="alert" className="fm-preview-changed">
              <span className="fm-preview-changed-text">{t("fileChanged")}</span>
              <span className="fm-preview-changed-actions">
                <button
                  type="button"
                  className="fm-preview-changed-btn fm-preview-changed-btn--primary"
                  onClick={handleRefreshChangedPreview}
                >
                  {t("update")}
                </button>
                <button
                  type="button"
                  className="fm-preview-changed-btn"
                  onClick={handleDismissChangedPreview}
                >
                  {t("keepCurrent")}
                </button>
              </span>
            </div>
          )}
          <div className="fm-preview-body">
            {previewLoading && (
              <div className="fm-loading">
                <span className="fm-spinner" /> {t("loading")}
              </div>
            )}
            {!previewLoading && previewError && (
              <div className="fm-error">{t("errorPrefix")}{previewError}</div>
            )}
            {!previewLoading && !previewError && isImage && imageCap && (
              <ImageView
                src={buildRawFileUrl(hint, previewPath, imageCap, imageVersion)}
                onRetry={retryImage}
              />
            )}
            {!previewLoading && !previewError && isJson && jsonDisplay?.note === "parse" && (
              <div className="fm-preview-warning" role="status">{t("jsonParseNote")}</div>
            )}
            {!previewLoading && !previewError && isJson && jsonDisplay?.note === "too-large" && (
              <div className="fm-preview-warning" role="status">{t("jsonTooLargeNote")}</div>
            )}
            {!previewLoading && !previewError && !isImage && previewPresentation !== null && previewPresentation.kind === "rendered" && (
              <div
                className="fm-markdown-content"
                dangerouslySetInnerHTML={{ __html: previewPresentation.html }}
                onErrorCapture={(event) => {
                  const target = event.target as HTMLElement;
                  if (target instanceof HTMLImageElement && target.closest(".fm-markdown-content")) {
                    target.style.display = "none";
                  }
                }}
              />
            )}
            {!previewLoading && !previewError && !isImage && previewPresentation !== null && previewPresentation.kind !== "rendered" && (
              <pre className={previewPresentation.kind === "highlighted-source" ? "fm-modal-pre fm-modal-pre--highlighted" : "fm-modal-pre"} dangerouslySetInnerHTML={previewPresentation.html ? { __html: previewPresentation.html } : undefined}>{previewPresentation.html ? undefined : previewPresentation.content}</pre>
            )}
            {!previewLoading && !previewError && !isImage && previewPresentation !== null && previewPresentation.kind !== "rendered" && previewPresentation.error && (
              <div className="fm-preview-render-error">{t("previewUnavailablePrefix")}{previewPresentation.error}</div>
            )}
            {!previewLoading && previewTruncated && (
              <div className="fm-preview-warning" role="status">{t("fileTruncated")}</div>
            )}
          </div>
        </div>
      )}

      {/* The confirm dialog must be the LAST overlay in the fragment: its
          backdrop and the preview dock share z-index 2147483647, so with
          equal z-index the later DOM sibling paints above — a dialog after
          the preview (and after the context menu) always covers the dock. */}
      {pendingDelete && (deleteInfo || deleteError) && (
        <ConfirmDeleteDialog
          name={pendingDelete.name}
          model={buildDeleteDialogModel(
            deleteInfo ?? { kind: "missing", name: pendingDelete.name, path: pendingDelete.path, isRoot: false, uncommitted: false }
          )}
          busy={deleteBusy}
          error={deleteError}
          onCancel={deleteFlow.cancelDelete}
          onConfirm={() => { void deleteFlow.confirmDelete(); }}
        />
      )}

      <ErrorToast />
    </>
  );
}