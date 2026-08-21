import { readdir, stat, realpath, lstat } from "node:fs/promises";
import { resolve, sep, basename, join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const IGNORED = new Set(["node_modules", ".git"]);
const MAX_ENTRIES = 2000;
const ROUTE_PREFIX = "/filemanager-fs";

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

export function createHandler(defaultRoot: string) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      // Security: require header
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

          // Containment check (lexical, before touching the filesystem —
          // an escaping path must be 403 even when it does not exist)
          if (!isInside(root, target)) {
            return send(res, 403, { error: "path escapes workspace" });
          }

          // Containment check (real, after symlink resolution)
          const realTarget = await realpath(target);
          if (!isInside(root, realTarget)) {
            return send(res, 403, { error: "path escapes workspace" });
          }

          const st = await stat(realTarget);
          if (!st.isDirectory()) {
            return send(res, 400, { error: "not a directory" });
          }

          const dirents = await readdir(realTarget, { withFileTypes: true });
          const entries: Array<{ name: string; kind: string; size?: number }> = [];

          for (const d of dirents) {
            if (IGNORED.has(d.name)) continue;

            let kind: string;
            let size: number | undefined;

            if (d.isSymbolicLink()) {
              // Check if symlink points inside root
              try {
                const linkTarget = await realpath(join(realTarget, d.name));
                const linkStat = await stat(linkTarget);
                if (!isInside(root, linkTarget)) {
                  // Symlink escapes — mark but don't allow traversal
                  kind = linkStat.isDirectory() ? "symlink-dir" : "symlink-file";
                } else {
                  kind = linkStat.isDirectory() ? "dir" : "file";
                  if (!linkStat.isDirectory()) size = linkStat.size;
                }
              } catch {
                kind = "symlink-file"; // broken symlink
              }
            } else if (d.isDirectory()) {
              kind = "dir";
            } else {
              kind = "file";
              try {
                size = (await lstat(join(realTarget, d.name))).size;
              } catch {}
            }

            entries.push({ name: d.name, kind, ...(size !== undefined && { size }) });
          }

          // Truncate if too many
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
