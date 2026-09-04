// src/use-preview-dock.ts
// Preview-dock hook extracted from Panel.tsx (package 3 decomposition): owns
// the dock's state (open/title/path/content/loading/error/pos/size/changed
// banner/image cap+version) plus open/close, drag/resize and the
// hint-change cap rotation. The changed-preview banner receives debounced
// change batches from the live-refresh coordinator via receiveChanges().
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { fetchFile } from "./preview-api.js";
import { clampPosition, type Point } from "./preview-position.js";
import { classifyPreviewKind } from "./preview-kind.js";
import { capCache } from "./caps.js";
import type { Entry } from "./api.js";
import type { FileManagerStore } from "./store.js";
import type { FileChange } from "./live-refresh.js";
import {
  reduceChangedPreview,
  dismissChangedPreview,
  type ChangedPreviewState,
} from "./preview-logic.js";

export interface PreviewDockOptions {
  store: FileManagerStore;
  /** Read the current workspace hint (via a ref in the panel) so callbacks
   *  stay stable and never restart the live-refresh coordinator. */
  getHint: () => string;
  /** True while a delete confirmation is pending: Esc closes that dialog,
   *  never the preview dock (mirrors Panel's previous Esc-precedence). */
  isDeletePending: () => boolean;
}

export interface PreviewDock {
  open: boolean;
  title: string;
  path: string;
  loading: boolean;
  error: string;
  content: string;
  truncated: boolean;
  pos: Point | null;
  size: { width: number; height: number } | null;
  changedPreview: ChangedPreviewState;
  imageCap: string | null;
  imageVersion: number;
  /** Source/rendered toggle state (persisted per workspace in the store). */
  previewMode: "source" | "rendered";
  windowRef: React.MutableRefObject<HTMLDivElement | null>;
  pathRef: { current: string };
  openFile: (fullPath: string, entry: Entry) => Promise<void>;
  close: () => void;
  refreshChanged: () => Promise<void>;
  dismissChanged: () => void;
  /** Coordinator change batch -> changed-preview banner state machine. */
  receiveChanges: (changes: FileChange[]) => void;
  /** Bump the image version so the raw URL reloads (retry after failure). */
  retryImage: () => void;
  dragStart: (e: React.PointerEvent<HTMLDivElement>) => void;
  dragMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  dragEnd: () => void;
}

export function usePreviewDock({ store, getHint, isDeletePending }: PreviewDockOptions): PreviewDock {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [path, setPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [content, setContent] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [pos, setPos] = useState<Point | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [changedPreview, setChangedPreview] = useState<ChangedPreviewState>({ kind: "idle" });
  const [imageCap, setImageCap] = useState<string | null>(null);
  const [imageVersion, setImageVersion] = useState(0);

  const windowRef = useRef<HTMLDivElement | null>(null);
  const posRef = useRef<Point | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const lastSizeRef = useRef<{ width: number; height: number } | null>(null);
  const pathRef = useRef(path);
  const titleRef = useRef(title);

  useEffect(() => {
    posRef.current = pos;
  }, [pos]);
  useEffect(() => {
    pathRef.current = path;
  }, [path]);
  useEffect(() => {
    titleRef.current = title;
  }, [title]);

  // Preview mode (source/rendered) and JSON mode live in the store (they are
  // per-workspace persisted preferences, shared with the toggle UI).
  const previewMode = useSyncExternalStore(store.subscribe, () => store.getState().previewMode);

  const receiveChanges = useCallback((changes: FileChange[]) => {
    setChangedPreview((prev) => reduceChangedPreview(prev, changes, pathRef.current));
  }, []);

  const commitLayout = useCallback(() => {
    const el = windowRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    store.setPreviewLayout({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
  }, [store]);

  const openFile = useCallback(async (fullPath: string, entry: Entry) => {
    const hint = getHint();
    if (!hint) return;
    const layout = store.getState().previewLayout;
    setPos(layout ? { x: layout.x, y: layout.y } : null);
    setSize(layout ? { width: layout.width, height: layout.height } : null);
    setTitle(entry.name);
    setPath(fullPath);
    setOpen(true);
    setLoading(true);
    setError("");
    setContent("");
    setTruncated(false);
    setChangedPreview({ kind: "idle" });
    setImageVersion(0);

    const kind = classifyPreviewKind(entry.name);
    try {
      if (kind === "image") {
        const cap = await capCache.getCap(hint);
        setImageCap(cap);
        return;
      }
      const res = await fetchFile(hint, fullPath);
      setContent(res.content);
      setTruncated(Boolean(res.truncated));
      if (kind === "markdown") {
        capCache.getCap(hint).then(setImageCap).catch(() => {});
      }
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, [getHint, store]);

  const refreshChanged = useCallback(async () => {
    const hint = getHint();
    const currentPath = pathRef.current;
    const currentTitle = titleRef.current;
    if (!hint || !currentPath) return;
    if (classifyPreviewKind(currentTitle) === "image") {
      setImageVersion((v) => v + 1);
      setChangedPreview({ kind: "idle" });
      return;
    }
    setLoading(true);
    try {
      const res = await fetchFile(hint, currentPath);
      setContent(res.content);
      setTruncated(Boolean(res.truncated));
      setError("");
      setChangedPreview({ kind: "idle" });
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, [getHint]);

  const dismissChanged = useCallback(() => {
    setChangedPreview((prev) => dismissChangedPreview(prev));
  }, []);

  const retryImage = useCallback(() => {
    setImageVersion((v) => v + 1);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setPos(null);
    setSize(null);
    dragRef.current = null;
    setChangedPreview({ kind: "idle" });
  }, []);

  // Close the preview dialog on Escape while it is open; a pending delete
  // confirmation takes precedence (its own dialog handles Escape).
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (isDeletePending()) return;
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close, isDeletePending]);

  // When the hint changes with an image or markdown preview open, invalidate
  // + refetch the cap so raw image URLs point at the new workspace (images via
  // the bumped version, markdown's local images via a fresh cap on re-render).
  // Runs only when the hint actually changed.
  const prevHintRef = useRef(getHint());
  useEffect(() => {
    const hint = getHint();
    if (prevHintRef.current === hint) return;
    prevHintRef.current = hint;
    const kind = classifyPreviewKind(titleRef.current);
    if (!hint || !open || (kind !== "image" && kind !== "markdown")) return;
    setImageCap(null);
    if (kind === "image") setImageVersion((v) => v + 1);
    capCache.invalidate(hint);
    capCache.getCap(hint).then(setImageCap).catch((err: any) => setError(err?.message ?? String(err)));
  }, [getHint, open]);

  const dragStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    const el = windowRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const current = posRef.current ?? { x: rect.left, y: rect.top };
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: current.x, origY: current.y };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
    e.preventDefault();
  }, []);

  const dragMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    const el = windowRef.current;
    if (!d || !el) return;
    const nx = d.origX + (e.clientX - d.startX);
    const ny = d.origY + (e.clientY - d.startY);
    const rect = el.getBoundingClientRect();
    const clamped = clampPosition(nx, ny, rect.width, rect.height, window.innerWidth, window.innerHeight);
    setPos(clamped);
  }, []);

  const dragEnd = useCallback(() => {
    dragRef.current = null;
    commitLayout();
  }, [commitLayout]);

  // Persist size changes (CSS resize) per workspace, debounced.
  useEffect(() => {
    if (!open) return;
    const el = windowRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      const next = { width: rect.width, height: rect.height };
      const prev = lastSizeRef.current;
      if (!prev || prev.width !== next.width || prev.height !== next.height) {
        lastSizeRef.current = next;
        setSize(next);
      }
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        store.setPreviewLayout({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
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
  }, [open, store]);

  return {
    open,
    title,
    path,
    loading,
    error,
    content,
    truncated,
    pos,
    size,
    changedPreview,
    imageCap,
    imageVersion,
    previewMode,
    windowRef,
    pathRef,
    openFile,
    close,
    refreshChanged,
    dismissChanged,
    receiveChanges,
    retryImage,
    dragStart,
    dragMove,
    dragEnd,
  };
}
