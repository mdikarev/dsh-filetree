// src/mutate-api.ts
import type { GitStatus } from "./api.js";

const HEADER = { "x-dsh-filemanager": "1" } as const;

export type DeleteInfoKind = "file" | "dir" | "symlink-file" | "symlink-dir" | "missing";

export interface DeleteInfo {
  kind: DeleteInfoKind;
  name: string;
  path: string;
  isRoot: boolean;
  uncommitted: boolean;
  gitStatus?: GitStatus;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: HEADER, ...init });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data?.error ?? "HTTP " + res.status);
  }
  return data as T;
}

export function fetchDeleteInfo(hint: string, path: string): Promise<DeleteInfo> {
  const url = "/filemanager-fs/delete-info?hint=" + encodeURIComponent(hint) + "&path=" + encodeURIComponent(path);
  return fetchJson<DeleteInfo>(url);
}

export function fetchDelete(hint: string, path: string): Promise<{ deleted: true; path: string }> {
  const url = "/filemanager-fs/delete?hint=" + encodeURIComponent(hint) + "&path=" + encodeURIComponent(path);
  return fetchJson<{ deleted: true; path: string }>(url, { method: "POST" });
}
