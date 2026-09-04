// src/preview-api.ts
const HEADER = { "x-dsh-filemanager": "1" } as const;

export interface ReadResponse {
  name: string;
  path: string;
  content: string;
  truncated?: boolean;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: HEADER });
  const data = await res.json();
  if (!res.ok) {
    throw new Error((data as any)?.error ?? `HTTP ${res.status}`);
  }
  return data as T;
}

export function fetchFile(hint: string, path: string): Promise<ReadResponse> {
  const url = `/filemanager-fs/read?hint=${encodeURIComponent(hint)}&path=${encodeURIComponent(path)}`;
  return fetchJson<ReadResponse>(url);
}

export interface CapResponse {
  cap: string;
}

export function fetchCap(hint: string): Promise<string> {
  const url = "/filemanager-fs/cap?hint=" + encodeURIComponent(hint);
  return fetchJson<CapResponse>(url).then((data) => data.cap);
}
