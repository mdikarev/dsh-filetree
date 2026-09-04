// src/use-delete-flow.ts
// Delete-flow hook extracted from Panel.tsx (package 3 decomposition): owns
// the tree-row context menu + the confirmed-delete state machine (pending
// target -> read-only preflight delete-info -> confirm dialog busy/error ->
// POST delete). Preview interaction stays external: onDeleted(path) lets the
// panel close a preview of the removed file/folder.
import { useCallback, useEffect, useState } from "react";
import { fetchDeleteInfo, fetchDelete, type DeleteInfo } from "./mutate-api.js";
import type { FileManagerStore } from "./store.js";

export interface RowContextMenuState {
  path: string;
  name: string;
  x: number;
  y: number;
  anchor: HTMLElement | null;
}

export interface UseDeleteFlowOptions {
  hint: string;
  store: FileManagerStore;
  /** Called with the deleted relative path after a successful DELETE. */
  onDeleted: (deletedPath: string) => void;
}

export interface DeleteFlow {
  contextMenu: RowContextMenuState | null;
  openContextMenu: (state: RowContextMenuState) => void;
  closeContextMenu: () => void;
  /** The pending delete target (set by the menu's Delete item). */
  pendingDelete: { path: string; name: string } | null;
  requestDelete: () => void;
  deleteInfo: DeleteInfo | null;
  deleteBusy: boolean;
  deleteError: string | null;
  cancelDelete: () => void;
  confirmDelete: () => Promise<void>;
}

export function useDeleteFlow({ hint, store, onDeleted }: UseDeleteFlowOptions): DeleteFlow {
  const [contextMenu, setContextMenu] = useState<RowContextMenuState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ path: string; name: string } | null>(null);
  const [deleteInfo, setDeleteInfo] = useState<DeleteInfo | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // When a delete becomes pending, preflight its delete-info (kind, root,
  // uncommitted git state) so the confirm dialog can show warnings and block
  // deleteable-as-root / missing targets; a failed preflight surfaces as a
  // dialog error with a blocked (missing) model.
  useEffect(() => {
    if (!pendingDelete || !hint) {
      setDeleteInfo(null);
      return;
    }
    let cancelled = false;
    setDeleteBusy(false);
    setDeleteError(null);
    fetchDeleteInfo(hint, pendingDelete.path)
      .then((info) => {
        if (!cancelled) setDeleteInfo(info);
      })
      .catch((err: any) => {
        if (!cancelled) {
          setDeleteError(err?.message ?? String(err));
          setDeleteInfo(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [pendingDelete, hint]);

  const confirmDelete = useCallback(async () => {
    if (!hint || !pendingDelete || !deleteInfo) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await fetchDelete(hint, pendingDelete.path);
      const deletedPath = pendingDelete.path;
      // Drop expanded state under the deleted path.
      const expanded = store.getExpandedPaths();
      const stale = expanded.filter((p) => p === deletedPath || p.startsWith(deletedPath + "/"));
      if (stale.length > 0) store.pruneExpandedPaths(stale);
      // The fs event from the delete itself refreshes the parent listings.
      setPendingDelete(null);
      setDeleteInfo(null);
      onDeleted(deletedPath);
    } catch (err: any) {
      setDeleteError(err?.message ?? String(err));
    } finally {
      setDeleteBusy(false);
    }
  }, [hint, pendingDelete, deleteInfo, store, onDeleted]);

  const openContextMenu = useCallback((state: RowContextMenuState) => {
    setContextMenu(state);
  }, []);

  const closeContextMenu = useCallback(() => {
    setPendingDelete(null);
    setContextMenu(null);
  }, []);

  const requestDelete = useCallback(() => {
    if (!contextMenu) return;
    // The preflight effect above runs and opens the confirm dialog.
    setPendingDelete({ path: contextMenu.path, name: contextMenu.name });
  }, [contextMenu]);

  const cancelDelete = useCallback(() => {
    setPendingDelete(null);
    setDeleteInfo(null);
    setDeleteError(null);
  }, []);

  return {
    contextMenu,
    openContextMenu,
    closeContextMenu,
    pendingDelete,
    requestDelete,
    deleteInfo,
    deleteBusy,
    deleteError,
    cancelDelete,
    confirmDelete,
  };
}
