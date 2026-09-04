// src/raw-url.ts

export function buildRawFileUrl(hint: string, path: string, cap: string, version = 0): string {
  // encodeURIComponent (not URLSearchParams): spaces stay %20, never "+",
  // matching the repo URL style and the pinned test expectations.
  let url = "/filemanager-fs/raw?hint=" + encodeURIComponent(hint)
    + "&path=" + encodeURIComponent(path) + "&cap=" + encodeURIComponent(cap);
  if (version > 0) url += "&v=" + version;
  return url;
}
