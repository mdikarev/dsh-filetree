// src/delete-flow.ts
import type { DeleteInfo, DeleteInfoKind } from "./mutate-api.js";

export interface DeleteDialogModel {
  path: string;
  kind: DeleteInfoKind;
  blocked: boolean;
  uncommitted: boolean;
  isDir: boolean;
}

export function buildDeleteDialogModel(info: DeleteInfo): DeleteDialogModel {
  return {
    path: info.path,
    kind: info.kind,
    blocked: info.isRoot || info.kind === "missing",
    uncommitted: info.uncommitted,
    isDir: info.kind === "dir" || info.kind === "symlink-dir",
  };
}

export function isPreviewAffected(deletedPath: string, previewPath: string | null): boolean {
  if (!previewPath) return false;
  return previewPath === deletedPath || previewPath.startsWith(deletedPath + "/");
}
