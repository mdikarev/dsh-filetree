import { readdir, stat, realpath, lstat } from "node:fs/promises";
import { resolve, sep, basename, join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { spawn } from "node:child_process";

type GitStatus = "modified" | "added" | "deleted" | "untracked" | "ignored";

type GitEntry = {
  status: GitStatus;
  isDir: boolean;
};

const HIDDEN_SYSTEM = new Set([".git"]);
const MAX_ENTRIES = 2000;

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(text);
}

function isInside(root: string, target: string): boolean {
  return target === root || target.startsWith(root + sep);
}

async function resolveRoot(hint: string | null, fallback: string): Promise<string> {
  if (hint && hint.length > 0) {
    try {
      const real = await realpath(hint);
      const st = await stat(real);
      if (st.isDirectory()) return real;
    } catch {}
  }
  try {
    return await realpath(fallback);
  } catch {
    return fallback;
  }
}

function mapPorcelainStatus(code: string): GitStatus {
  if (code === "??") return "untracked";
  if (code === "!!") return "ignored";
  if (code.includes("D")) return "deleted";
  if (code.includes("A") || code.includes("C") || code.includes("R")) return "added";
  return "modified";
}

function normalizeGitPath(value: string): string {
  let normalized = value.replaceAll(String.fromCharCode(92), "/");
  if (normalized.startsWith("./")) normalized = normalized.slice(2);
  return normalized;
}

function promoteGitStatus(current: GitStatus | undefined, next: GitStatus): GitStatus {
  const rank: Record<GitStatus, number> = {
    modified: 4,
    added: 3,
    deleted: 3,
    untracked: 2,
    ignored: 1,
  };
  if (!current) return next;
  return rank[next] >= rank[current] ? next : current;
}

function pathSegments(relativePath: string): string[] {
  return relativePath.split("/").filter(Boolean);
}

function findInheritedIgnored(gitMap: Map<string, GitEntry>, normalized: string): boolean {
  const segments = pathSegments(normalized);
  for (let i = segments.length - 1; i >= 1; i -= 1) {
    const ancestor = segments.slice(0, i).join("/");
    const entry = gitMap.get(ancestor) ?? gitMap.get(ancestor + "/");
    if (entry?.status === "ignored") return true;
  }
  return false;
}

export function debugCollectStatuses(root: string): Promise<Map<string, GitEntry>> {
  return runGitStatus(root);
}

function prioritizeGitStatuses(statuses: Iterable<GitStatus>): GitStatus[] {
  const set = new Set(statuses);
  const ordered: GitStatus[] = [];
  if (set.has("modified")) ordered.push("modified");
  if (set.has("added")) ordered.push("added");
  if (set.has("deleted")) ordered.push("deleted");
  if (set.has("untracked")) ordered.push("untracked");
  if (set.has("ignored")) ordered.push("ignored");
  return ordered;
}

async function runGitStatus(root: string): Promise<Map<string, GitEntry>> {
  try {
    await stat(join(root, ".git"));
  } catch {
    return new Map();
  }

  const output = await new Promise<string>((resolvePromise) => {
    const child = spawn("git", ["status", "--ignored", "--porcelain=v1"], {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
    });

    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.on("error", () => resolvePromise(""));
    child.on("close", (code) => resolvePromise(code === 0 ? stdout : ""));
  });

  const map = new Map<string, GitEntry>();

  for (const rawLine of output.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    const code = line.slice(0, 2);
    const remainder = line.slice(3).trim();
    if (!remainder) continue;

    const relativePath = remainder.includes(" -> ") ? remainder.split(" -> ").at(-1) ?? remainder : remainder;
    const normalized = normalizeGitPath(relativePath);
    const status = mapPorcelainStatus(code);
    const existing = map.get(normalized);
    const segments = pathSegments(normalized);
    const inferredIsDir = existing?.isDir ?? remainder.endsWith("/");

    map.set(normalized, { status, isDir: inferredIsDir });

    for (let i = 1; i < segments.length; i += 1) {
      const dirPath = segments.slice(0, i).join("/");
      const existingDir = map.get(dirPath);
      map.set(dirPath, {
        status: promoteGitStatus(existingDir?.status, status),
        isDir: true,
      });
    }
  }

  return map;
}

function getEntryStatuses(
  gitMap: Map<string, GitEntry>,
  relPath: string,
  isDir: boolean,
): { gitStatus?: GitStatus; gitStatusSummary?: GitStatus[] } {
  const normalized = normalizeGitPath(relPath).replace(/\/+$/, "");
  const direct = gitMap.get(normalized);
  const directDir = isDir ? gitMap.get(normalized + "/") : undefined;
  const inheritedIgnored = findInheritedIgnored(gitMap, normalized);
  const effectiveDirect = direct ?? directDir ?? (inheritedIgnored ? { status: "ignored" as GitStatus, isDir: false } : undefined);
  const descendantStatuses = new Set<GitStatus>();

  if (effectiveDirect) descendantStatuses.add(effectiveDirect.status);

  if (isDir) {
    if (directDir) descendantStatuses.add(directDir.status);

    const prefix = normalized ? normalized + "/" : "";
    for (const [path, entry] of gitMap.entries()) {
      if (path === normalized || path === normalized + "/") continue;
      if (prefix && path.startsWith(prefix)) descendantStatuses.add(entry.status);
    }
  }

  const summary = prioritizeGitStatuses(descendantStatuses);
  return {
    ...(effectiveDirect ? { gitStatus: effectiveDirect.status } : {}),
    ...(summary.length > 0 ? { gitStatusSummary: summary } : {}),
  };
}

export function createHandler(defaultRoot: string) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      if (req.headers["x-dsh-filemanager"] !== "1") {
        return send(res, 403, { error: "missing x-dsh-filemanager header" });
      }

      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);

      if (parts[0] !== "filemanager-fs" || parts.length < 2) {
        return send(res, 404, { error: "not found" });
      }

      const action = parts[1];
      const hint = url.searchParams.get("hint");
      const root = await resolveRoot(hint, defaultRoot);

      switch (action) {
        case "root":
          return send(res, 200, { root, name: basename(root) });

        case "list": {
          const relPath = url.searchParams.get("path") ?? "";
          const target = resolve(root, relPath);

          if (!isInside(root, target)) {
            return send(res, 403, { error: "path escapes workspace" });
          }

          const realTarget = await realpath(target);
          if (!isInside(root, realTarget)) {
            return send(res, 403, { error: "path escapes workspace" });
          }

          const st = await stat(realTarget);
          if (!st.isDirectory()) {
            return send(res, 400, { error: "not a directory" });
          }

          const gitMap = await runGitStatus(root);
          const dirents = await readdir(realTarget, { withFileTypes: true });
          const entries: Array<{ name: string; kind: string; size?: number; gitStatus?: GitStatus; gitStatusSummary?: GitStatus[] }> = [];

          for (const d of dirents) {
            if (HIDDEN_SYSTEM.has(d.name)) continue;

            let kind: string;
            let size: number | undefined;

            if (d.isSymbolicLink()) {
              try {
                const linkTarget = await realpath(join(realTarget, d.name));
                const linkStat = await stat(linkTarget);
                if (!isInside(root, linkTarget)) {
                  kind = linkStat.isDirectory() ? "symlink-dir" : "symlink-file";
                } else {
                  kind = linkStat.isDirectory() ? "dir" : "file";
                  if (!linkStat.isDirectory()) size = linkStat.size;
                }
              } catch {
                kind = "symlink-file";
              }
            } else if (d.isDirectory()) {
              kind = "dir";
            } else {
              kind = "file";
              try {
                size = (await lstat(join(realTarget, d.name))).size;
              } catch {}
            }

            const relativeEntryPath = relPath ? `${relPath}/${d.name}` : d.name;
            const gitLookupPath = (kind === "dir" || kind === "symlink-dir") ? `${relativeEntryPath}/` : relativeEntryPath;
            const gitMeta = getEntryStatuses(gitMap, gitLookupPath, kind === "dir" || kind === "symlink-dir");
            entries.push({ name: d.name, kind, ...(size !== undefined && { size }), ...gitMeta });
          }

          const truncated = entries.length > MAX_ENTRIES;
          const result = truncated ? entries.slice(0, MAX_ENTRIES) : entries;

          return send(res, 200, { entries: result, ...(truncated && { truncated: true }) });
        }

        default:
          return send(res, 404, { error: `unknown action: ${action}` });
      }
    } catch (err: any) {
      const status = err?.code === "ENOENT" ? 404 : 500;
      send(res, status, { error: err?.message ?? String(err) });
    }
  };
}