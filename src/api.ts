// src/api.ts

const HEADER = { "x-dsh-filemanager": "1" };

export interface Entry {
  name: string;
  kind: "dir" | "file" | "symlink-dir" | "symlink-file";
  size?: number;
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

// Sort: directories first, then files, alphabetically case-insensitive
export function sortEntries(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => {
    const aIsDir = a.kind === "dir" || a.kind === "symlink-dir";
    const bIsDir = b.kind === "dir" || b.kind === "symlink-dir";
    if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

// Color by extension for file dot markers
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
