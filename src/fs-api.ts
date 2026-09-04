import { readdir, stat, realpath, lstat, open, rmdir, unlink } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { resolve, sep, basename, join } from "node:path";
import { createEventsHandler } from "./fs-events.js";
import { createGitStatusCache, type SnapshotCache } from "./git-status-cache.js";
import { createCapabilityIssuer, type CapabilityIssuer } from "./capabilities.js";
import { detectImageType, looksLikeSvg, MAX_IMAGE_BYTES, MAX_SVG_BYTES } from "./image-types.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { spawn } from "node:child_process";

type GitStatus = "modified" | "added" | "deleted" | "untracked" | "ignored";

type GitEntry = {
  status: GitStatus;
  isDir: boolean;
};

export type GitStatusCache = SnapshotCache<GitEntry>;

export interface CreateHandlerOptions {
  /** Override the per-handler git-status cache (tests inject spies). */
  gitStatusCache?: GitStatusCache;
  /** Override the capability issuer (tests inject expiry/rotation). */
  capabilities?: CapabilityIssuer;
}

const HIDDEN_SYSTEM = new Set([".git"]);
const MAX_ENTRIES = 2000;
const MAX_READ_BYTES = 5 * 1024 * 1024;
// Probe window for the content-based text heuristic (same size as git's).
const TEXT_PROBE_BYTES = 8000;

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(text);
}

function isTextByExtension(name: string): boolean {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const TEXT_EXT = new Set([
    'md','txt','rst','log','json','yml','yaml','toml','ini','env',
    'ts','tsx','js','jsx','mjs','cjs',
    'css','html','xml','graphql','proto','sql','csv',
    'py','rs','go','java','kt','kts','c','h','cpp','cc','cs','php','rb','sh','bash','zsh'
  ]);
  if (name === 'Dockerfile') return true;
  return TEXT_EXT.has(ext);
}

/**
 * Content-based text heuristic for names that fail the extension check: a file
 * whose first TEXT_PROBE_BYTES contain no NUL byte is treated as text. This
 * lets extensionless dotfiles (.gitignore, .env) and other extensionless text
 * files (Makefile, LICENSE) be previewed, while binary files (which virtually
 * always contain NULs early, e.g. .DS_Store, archives, images) are still
 * rejected as "unsupported content type".
 */
async function isTextByContent(filePath: string): Promise<boolean> {
  const fh = await open(filePath, "r");
  try {
    const st = await fh.stat();
    const toRead = Math.min(st.size, TEXT_PROBE_BYTES);
    const buf = Buffer.alloc(toRead);
    if (toRead > 0) await fh.read(buf, 0, toRead, 0);
    return !buf.includes(0);
  } finally {
    await fh.close();
  }
}

async function readTextChunk(filePath: string, maxBytes: number): Promise<{ content: string; truncated: boolean }> {
  const fh = await open(filePath, 'r');
  try {
    const statInfo = await fh.stat();
    const toRead = Math.min(statInfo.size, maxBytes);
    const buf = Buffer.alloc(toRead);
    await fh.read(buf, 0, toRead, 0);
    let content: string;
    try {
      content = buf.toString('utf8');
    } catch {
      throw Object.assign(new Error('unsupported content type'), { code: 'UNSUPPORTED' });
    }
    return { content, truncated: statInfo.size > maxBytes };
  } finally {
    await fh.close();
  }
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
  // Проверяем только непосредственных предков, которые ЯВНО в gitMap
  // Это важно: если папка не показана git как ignored, она не ignored,
  // даже если у неё есть ignored предок (может быть negated pattern)
  for (let i = segments.length - 1; i >= 1; i -= 1) {
    const ancestor = segments.slice(0, i).join("/");
    const entry = gitMap.get(ancestor) ?? gitMap.get(ancestor + "/");
    
    // Если нашли явную запись с ignored - наследуем
    if (entry?.status === "ignored") return true;
    
    // ВАЖНО: если нашли явную запись с другим статусом (не ignored —
    // ignored уже вернул true выше), то даже если есть ignored предки,
    // мы НЕ наследуем, потому что эта папка - исключение (negated pattern)
    if (entry) return false;
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
    // GIT_OPTIONAL_LOCKS=0 keeps git status strictly read-only: otherwise git
    // may refresh the index stat cache and write .git/index, which the events
    // endpoint watches - a list-triggered write would emit git-changed and
    // create a refresh feedback loop (flashing loaders on expanded folders).
    const child = spawn("git", ["status", "--ignored", "--porcelain=v1"], {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
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

    // Обновляем родительские папки, но НЕ распространяем ignored статус
    // Если файл ignored, это не значит что вся папка ignored
    if (status !== "ignored") {
      for (let i = 1; i < segments.length; i += 1) {
        const dirPath = segments.slice(0, i).join("/");
        const existingDir = map.get(dirPath);
        map.set(dirPath, {
          status: promoteGitStatus(existingDir?.status, status),
          isDir: true,
        });
      }
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
  // Наследуем ignored статус только если родитель явно в gitMap как ignored
  // Git не показывает каждый файл в ignored папке, только саму папку
  const effectiveDirect = direct ?? directDir ?? (inheritedIgnored ? { status: "ignored" as GitStatus, isDir: false } : undefined);
  const descendantStatuses = new Set<GitStatus>();

  // Для ФАЙЛОВ: всегда добавляем их статус в summary (даже inherited ignored)
  // Для ПАПОК: добавляем статус только если он явно в gitMap, не унаследован
  if (!isDir && effectiveDirect) {
    // Файл - добавляем его статус
    descendantStatuses.add(effectiveDirect.status);
  } else if (isDir && (direct || directDir) && effectiveDirect) {
    // Папка с явным статусом в gitMap - добавляем
    descendantStatuses.add(effectiveDirect.status);
  }

  if (isDir) {
    if (directDir) descendantStatuses.add(directDir.status);

    const prefix = normalized ? normalized + "/" : "";
    for (const [path, entry] of gitMap.entries()) {
      if (path === normalized || path === normalized + "/") continue;
      // Не добавляем ignored статус в summary - это "шум", не значимое изменение
      // Папка с tracked файлами + ignored файлами = НЕ ignored папка
      if (prefix && path.startsWith(prefix) && entry.status !== "ignored") {
        descendantStatuses.add(entry.status);
      }
    }
  }

  const summary = prioritizeGitStatuses(descendantStatuses);
  return {
    ...(effectiveDirect ? { gitStatus: effectiveDirect.status } : {}),
    ...(summary.length > 0 ? { gitStatusSummary: summary } : {}),
  };
}

// --- delete-info preflight helpers (GET /filemanager-fs/delete-info) ---

type ResolvedEntryKind = "file" | "dir" | "symlink-file" | "symlink-dir";

const UNCOMMITTED = new Set<GitStatus>(["modified", "added", "untracked"]);

async function resolveEntryKind(root: string, relPath: string): Promise<ResolvedEntryKind | null> {
  const target = resolve(root, relPath);
  if (!isInside(root, target)) return null; // caller maps to 403/404
  const st = await lstat(target).catch(() => null);
  if (!st) return null;
  if (st.isSymbolicLink()) {
    const linkStat = await stat(target).catch(() => null);
    if (!linkStat) return "symlink-file"; // dangling link — still deletable as a link
    return linkStat.isDirectory() ? "symlink-dir" : "symlink-file";
  }
  if (st.isDirectory()) return "dir";
  if (st.isFile()) return "file";
  return null;
}

function isUncommittedStatus(status: GitStatus | undefined): boolean {
  return status !== undefined && UNCOMMITTED.has(status);
}

/** True when the entry itself (file) or any existing descendant (dir) carries
 *  an uncommitted git status; a dir's own collapsed `?? dir/` row (wholly
 *  untracked directory) counts as well. Ignored rows never count. */
function entryUncommitted(gitMap: Map<string, GitEntry>, relPath: string, isDir: boolean): boolean {
  const normalized = normalizeGitPath(relPath).replace(/\/+$/, "");
  const self = gitMap.get(normalized) ?? gitMap.get(normalized + "/");
  if (isDir) {
    const prefix = normalized ? normalized + "/" : "";
    for (const [path, entry] of gitMap.entries()) {
      if (path === normalized || path === normalized + "/") continue;
      if ((!prefix || path.startsWith(prefix)) && entry.status !== "ignored" && isUncommittedStatus(entry.status)) return true;
    }
    // `git status --porcelain` collapses a brand-new directory to one `?? dir/`
    // row that the descendant scan above skips, so a wholly-untracked dir
    // would otherwise report uncommitted=false and lose its delete warning.
    // Count an uncommitted self row (collapsed dir row first).
    const selfDir = gitMap.get(normalized + "/") ?? gitMap.get(normalized);
    return isUncommittedStatus(selfDir?.status);
  }
  return isUncommittedStatus(self?.status);
}

async function serveRawImage(
  res: ServerResponse,
  root: string,
  hint: string,
  capabilities: CapabilityIssuer,
  params: { path: string | null; cap: string | null },
): Promise<void> {
  const cap = params.cap;
  if (!cap || !capabilities.isValid(hint, cap)) {
    return send(res, 403, { error: "invalid or expired capability" });
  }
  const relPath = params.path ?? "";
  const target = resolve(root, relPath);
  if (!isInside(root, target)) {
    return send(res, 403, { error: "path escapes workspace" });
  }
  const realTarget = await realpath(target).catch(() => null);
  if (!realTarget) {
    return send(res, 404, { error: "not found" });
  }
  if (!isInside(root, realTarget)) {
    return send(res, 403, { error: "path escapes workspace" });
  }
  const st = await stat(realTarget);
  if (!st.isFile()) {
    return send(res, 400, { error: "not a file" });
  }

  const fh = await open(realTarget, "r");
  let detected: ReturnType<typeof detectImageType> = null;
  try {
    const headerSize = Math.min(st.size, 32);
    const header = Buffer.alloc(headerSize);
    if (headerSize > 0) await fh.read(header, 0, headerSize, 0);
    detected = detectImageType(header);
    // Probe text for SVG up to the RASTER cap so an over-limit SVG is still
    // recognized and answered 413 (image too large), not 415.
    if (!detected && st.size <= MAX_IMAGE_BYTES) {
      const sampleSize = Math.min(st.size, 4096);
      const sample = Buffer.alloc(sampleSize);
      if (sampleSize > 0) await fh.read(sample, 0, sampleSize, 0);
      if (looksLikeSvg(sample.toString("latin1"))) {
        detected = { kind: "svg", mime: "image/svg+xml" };
      }
    }
  } finally {
    await fh.close();
  }

  if (!detected) {
    return send(res, 415, { error: "unsupported content type" });
  }
  if (detected.kind === "svg" && st.size > MAX_SVG_BYTES) {
    return send(res, 413, { error: "image too large" });
  }
  if (detected.kind === "raster" && st.size > MAX_IMAGE_BYTES) {
    return send(res, 413, { error: "image too large" });
  }

  res.writeHead(200, {
    "content-type": detected.mime,
    "content-length": String(st.size),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...(detected.kind === "svg" ? { "content-security-policy": "sandbox" } : {}),
  });
  const stream = createReadStream(realTarget);
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}

// --- delete action helpers (POST /filemanager-fs/delete) ---

async function deleteRecursive(absDir: string): Promise<void> {
  const entries = await readdir(absDir);
  for (const entry of entries) {
    const abs = join(absDir, entry);
    const st = await lstat(abs);
    if (st.isSymbolicLink()) await unlink(abs);
    else if (st.isDirectory()) await deleteRecursive(abs);
    else await unlink(abs);
  }
  await rmdir(absDir);
}

async function deletePathEntry(root: string, relPath: string): Promise<boolean> {
  const segments = relPath.split("/").filter(Boolean);
  if (segments.length === 0) {
    throw Object.assign(new Error("cannot delete workspace root"), { expose: "cannot delete workspace root" });
  }
  // Never delete *through* an intermediate symlink.
  let current = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const next = join(current, segments[i]);
    const st = await lstat(next).catch(() => null);
    if (!st) return false;
    if (st.isSymbolicLink()) throw Object.assign(new Error("path resolves through a symlink"), { expose: "path resolves through a symlink" });
    current = next;
  }
  const target = join(current, segments[segments.length - 1]!);
  if (target === root) {
    // "." / "<dir>/.." normalize to the root: never reach deleteRecursive(root).
    throw Object.assign(new Error("cannot delete workspace root"), { expose: "cannot delete workspace root" });
  }
  const st = await lstat(target).catch(() => null);
  if (!st) return false;
  if (st.isSymbolicLink()) await unlink(target);
  else if (st.isDirectory()) await deleteRecursive(target);
  else await unlink(target);
  return true;
}

function hasGitSegment(relPath: string): boolean {
  return relPath.split("/").filter(Boolean).some((segment) => segment === ".git");
}

export function createHandler(defaultRoot: string, options: CreateHandlerOptions = {}) {
  const gitCache =
    options.gitStatusCache ??
    createGitStatusCache<GitEntry>({ collect: runGitStatus });
  const eventsHandler = createEventsHandler(defaultRoot, gitCache);
  const capabilities = options.capabilities ?? createCapabilityIssuer();
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);

      if (parts[0] !== "filemanager-fs" || parts.length < 2) {
        return send(res, 404, { error: "not found" });
      }

      const action = parts[1];
      // /raw is the only action reachable without the header: plain <img>
      // tags cannot send headers, so /raw authenticates with a capability
      // token instead. Every other action keeps the header gate.
      if (action !== "raw" && req.headers["x-dsh-filemanager"] !== "1") {
        return send(res, 403, { error: "missing x-dsh-filemanager header" });
      }

      const hint = url.searchParams.get("hint");
      const effectiveHint = hint && hint.length > 0 ? hint : defaultRoot;
      const root = await resolveRoot(hint, defaultRoot);

      switch (action) {
        case "root":
          return send(res, 200, { root, name: basename(root) });

        case "cap":
          return send(res, 200, { cap: capabilities.issueFor(effectiveHint) });

        case "raw":
          return serveRawImage(res, root, effectiveHint, capabilities, {
            path: url.searchParams.get("path"),
            cap: url.searchParams.get("cap"),
          });

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

          const gitMap = await gitCache.get(root);
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

        
        case "read": {
          const relPath = url.searchParams.get("path") ?? "";
          const target = resolve(root, relPath);

          if (!isInside(root, target)) {
            return send(res, 403, { error: "path escapes workspace" });
          }

          const realTarget = await realpath(target).catch(() => null as any);
          if (!realTarget) {
            return send(res, 404, { error: "not found" });
          }
          if (!isInside(root, realTarget)) {
            return send(res, 403, { error: "path escapes workspace" });
          }

          const st = await stat(realTarget);
          if (!st.isFile()) {
            return send(res, 400, { error: "not a file" });
          }

          const name = basename(realTarget);
          if (!isTextByExtension(name) && !(await isTextByContent(realTarget))) {
            return send(res, 400, { error: "unsupported content type" });
          }

          try {
            const { content, truncated } = await readTextChunk(realTarget, MAX_READ_BYTES);
            return send(res, 200, { name, path: relPath, content, ...(truncated && { truncated: true }) });
          } catch (e: any) {
            if (e?.code === 'UNSUPPORTED') {
              return send(res, 400, { error: "unsupported content type" });
            }
            throw e;
          }
        }
        case "events":
          return eventsHandler(req, res);

        // Read-only preflight for deletion: reports the entry kind, whether it
        // is the workspace root, and whether it (file) or any existing
        // descendant (dir) carries an uncommitted git status (modified /
        // added / untracked; ignored never counts). gitStatus is included for
        // files that have a direct row; for dirs the aggregate `uncommitted`
        // is the contract the UI uses, so a dir row is not forced here.
        // `root` was already resolved above the switch.
        case "delete-info": {
          const relPath = url.searchParams.get("path") ?? "";
          const target = resolve(root, relPath);
          if (!isInside(root, target)) {
            return send(res, 403, { error: "path escapes workspace" });
          }
          const kind = await resolveEntryKind(root, relPath);
          if (kind === null) {
            return send(res, 404, { error: "not found" });
          }
          const gitMap = await gitCache.get(root);
          const isDir = kind === "dir" || kind === "symlink-dir";
          const gitStatus = gitMap.get(normalizeGitPath(relPath).replace(/\/+$/, ""))?.status;
          return send(res, 200, {
            kind,
            name: basename(target),
            path: relPath,
            isRoot: relPath.length === 0,
            uncommitted: entryUncommitted(gitMap, relPath, isDir),
            ...(gitStatus !== undefined && gitStatus !== null ? { gitStatus } : {}),
          });
        }

        case "delete": {
          if (req.method !== "POST") {
            return send(res, 405, { error: "method not allowed" });
          }
          const relPath = url.searchParams.get("path") ?? "";
          const target = resolve(root, relPath);
          if (!isInside(root, target)) {
            return send(res, 403, { error: "path escapes workspace" });
          }
          if (target === root) {
            // resolve() normalizes "." and "<entry>/.." to the root itself;
            // reject before any fs work so deleteRecursive(root) is unreachable.
            return send(res, 403, { error: "cannot delete workspace root" });
          }
          if (hasGitSegment(relPath)) {
            return send(res, 403, { error: "cannot delete .git" });
          }
          let deleted: boolean;
          try {
            deleted = await deletePathEntry(root, relPath);
          } catch (err: any) {
            const expose = err?.expose ?? err?.message ?? String(err);
            const code = err?.code;
            if (code === "EACCES" || code === "EPERM" || code === "EBUSY" || code === "ENOTEMPTY" || code === "ELOOP") {
              return send(res, 409, { error: "delete failed: " + expose });
            }
            return send(res, 403, { error: expose });
          }
          if (!deleted) {
            return send(res, 404, { error: "not found" });
          }
          gitCache.invalidate(root);
          return send(res, 200, { deleted: true, path: relPath });
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