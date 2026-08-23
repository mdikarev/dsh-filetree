// src/api.ts

const HEADER = { "x-dsh-filemanager": "1" };

export type GitStatus = "modified" | "added" | "deleted" | "untracked" | "ignored";

export interface Entry {
  name: string;
  kind: "dir" | "file" | "symlink-dir" | "symlink-file";
  size?: number;
  gitStatus?: GitStatus;
  gitStatusSummary?: GitStatus[];
}

export interface RootResponse {
  root: string;
  name: string;
}

export interface ListResponse {
  entries: Entry[];
  truncated?: boolean;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: HEADER });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  return data as T;
}

export function fetchRoot(hint: string): Promise<RootResponse> {
  const url = `/filemanager-fs/root?hint=${encodeURIComponent(hint)}`;
  return fetchJson<RootResponse>(url);
}

export function fetchList(hint: string, path: string): Promise<ListResponse> {
  const url = `/filemanager-fs/list?hint=${encodeURIComponent(hint)}&path=${encodeURIComponent(path)}`;
  return fetchJson<ListResponse>(url);
}

/**
 * Build the SSE events subscription URL for the given workspace hint and the
 * relative expanded directories. Both parameters are encoded with
 * encodeURIComponent so spaces become %20 (never "+") and plus signs stay
 * %2B; the paths array travels as an encoded JSON array, matching the host's
 * parseWatchedPaths contract.
 */
export function buildEventsUrl(hint: string, paths: string[]): string {
  return (
    "/filemanager-fs/events?hint=" +
    encodeURIComponent(hint) +
    "&paths=" +
    encodeURIComponent(JSON.stringify(paths))
  );
}

export function sortEntries(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => {
    const aIsDir = a.kind === "dir" || a.kind === "symlink-dir";
    const bIsDir = b.kind === "dir" || b.kind === "symlink-dir";
    if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

const EXT_COLORS: Record<string, string> = {
  ts: "#3178c6",
  tsx: "#3178c6",
  js: "#f7df1e",
  jsx: "#61dafb",
  mjs: "#f7df1e",
  json: "#cbcb41",
  md: "#519aba",
  css: "#563d7c",
  html: "#e34c26",
  py: "#3572a5",
  rs: "#dea584",
  go: "#00add8",
  yaml: "#cb171e",
  yml: "#cb171e",
  sh: "#89e051",
  txt: "#9ca3af",
};

export function getFileColor(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 1) return "#9ca3af";
  const ext = name.slice(dot + 1).toLowerCase();
  return EXT_COLORS[ext] ?? "#9ca3af";
}

export function getGitStatusBadge(status?: GitStatus): string | null {
  switch (status) {
    case "modified":
      return "M";
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "untracked":
      return "?";
    case "ignored":
      return "I";
    default:
      return null;
  }
}

export function getDirectoryGitStatus(entry: Entry): GitStatus | null {
  if (entry.gitStatus) return entry.gitStatus;
  const statuses = entry.gitStatusSummary ?? [];
  if (statuses.some((status) => status === "modified" || status === "added" || status === "deleted")) {
    return "modified";
  }
  if (statuses.includes("untracked")) return "untracked";
  if (statuses.includes("ignored")) return "ignored";
  return null;
}

export function getEntryGitTone(entry: Entry): "changed" | "untracked" | "ignored" | null {
  const status = (entry.kind === "dir" || entry.kind === "symlink-dir")
    ? getDirectoryGitStatus(entry)
    : entry.gitStatus ?? null;

  if (!status) return null;
  if (status === "ignored") return "ignored";
  if (status === "untracked") return "untracked";
  return "changed";
}
