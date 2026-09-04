# File/Folder Deletion via Tree Context Menu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user delete a single file or folder from the workspace through a new row context menu, protected by an inline confirmation dialog and uncommitted-change warnings, via two new server actions.

**Architecture:** Server adds a read-only preflight action (`GET /filemanager-fs/delete-info`) and the first mutating action (`POST /filemanager-fs/delete`) to the existing header-gated handler, with lstat-based symlink-safe deletion. Client adds a reusable context-menu scaffold on tree rows (right-click or Menu key), an inline confirm dialog, and pure helpers that derive dialog facts and preview-close decisions; Panel owns the menu/dialog state and drives the flow.

**Tech Stack:** TypeScript, Node >= 20 (fs/promises), React 18 (host), node:test + tsx. No new runtime dependencies.

**Spec:** docs/superpowers/specs/2026-09-04-file-deletion-context-menu-design.md

## Global Constraints

- The plugin is read-only except explicit, confirmed deletion (this is the only write path added this cycle).
- Header gate: `delete-info` and `delete` both require `x-dsh-filemanager: 1`. `delete` is POST-only. Neither is reachable as a simple cross-origin request (no header-less path; no capability tokens for writes).
- Delete rules (verbatim from spec): file → `unlink`; folder → depth-first recursive removal; symlink → `unlink` the link only, never follow it; refusing to descend through an intermediate symlink (403); workspace root → 403; any `.git` path segment → 403; missing → 404; success body `200 {"deleted": true, "path": "<rel>"}`; OS errors (EPERM/EACCES/EBUSY/ENOTEMPTY/ELOOP) → 409 `{error: "delete failed: <os message>"}`; after success `gitCache.invalidate(root)`.
- `delete-info` (read-only): `{ kind: "file"|"dir"|"symlink-file"|"symlink-dir"|"missing", name, path, isRoot, uncommitted, gitStatus? }`; `uncommitted` = file status in {modified, added, untracked} or, for a dir, any existing descendant in that set; ignored never counts; `isRoot` true when rel is the root.
- l10n: new strings in BOTH en (source of truth) and ru dictionaries; removals in both.
- CSS only in src/styles.ts via DSH tokens; dark theme via body[data-ds-dark-theme].
- A11y: menu `role="menu"`/`menuitem`, keyboard Menu/Shift+F10 opens, arrows/Enter/Esc inside; dialog `role="alertdialog"`, focus lands on Cancel, Esc cancels and does NOT close the preview dock while the dialog is open; focus-visible.
- Gate before every commit: `npm run typecheck && npm test && npm run build` all green (suite is 370 tests).
- ESM imports use `.js` suffix. Panel/Tree follow their existing ref/state patterns.
- User go-ahead for the code after the canon update (Task 1) has already been given (2026-09-04) — no mid-plan pause.

## File Structure

- Modify: `docs/canon/**` + roadmap (Task 1, via canon-write skill)
- Modify: `src/fs-api.ts` — `delete-info` and `delete` actions + helpers (Tasks 2–3)
- Create: `test/delete-api.test.ts` (Tasks 2–3 share the file; each task adds its describe block)
- Create: `src/mutate-api.ts` (Task 4) — typed client fetchers
- Create: `src/delete-flow.ts` (Task 4) — pure dialog-model + preview-close helpers
- Create: `test/delete-flow.test.ts`, `test/mutate-api.test.ts` (Task 4)
- Create: `src/ContextMenu.tsx` (Task 5) — generic themed menu
- Modify: `src/styles.ts`, `src/Tree.tsx`, `src/Panel.tsx`, `src/l10n.ts` (Tasks 5–6)
- Create: `src/ConfirmDeleteDialog.tsx` (Task 6)
- Modify: `README.md`, `CHANGELOG.md` (Task 7)

---

### Task 1: Living canon update (canon-first) + roadmap sync

**Files:**
- Modify: `docs/canon/OVERVIEW.md`, `docs/canon/ARCHITECTURE.md`, `docs/canon/GLOSSARY.md`, `docs/canon/future_plans/p4-file-deletion-context-menu.md` (status → implementing), `docs/superpowers/plans/2026-09-02-maturity-roadmap.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Load the canon-write skill** and follow it for every `docs/canon/**` edit (coding agents must not edit canon directly).
- [ ] **Step 2: Update OVERVIEW** — Scope: the read-only invariant now reads "read-only, except explicit confirmed deletion of files/folders from the tree"; add in-scope bullet (context-menu delete + confirm dialog + uncommitted warning) and out-of-scope reminder (other mutations, trash/undo, multi-select). Add success-signal lines (menu opens by right-click/Menu key; dialog shows path + warning; delete removes the node and the tree updates; root/.git cannot be deleted).
- [ ] **Step 3: Update ARCHITECTURE** — Building blocks: context menu (src/ContextMenu.tsx), confirm dialog (src/ConfirmDeleteDialog.tsx), client fetchers (src/mutate-api.ts) and pure helpers (src/delete-flow.ts). Public interfaces: `GET /filemanager-fs/delete-info` and `POST /filemanager-fs/delete` with the verbatim contracts from the spec (Section 1–2). Key flows: "Удаление через контекстное меню". Failure modes: 403/404/409 handling; .git and root guards. Security note row: POST + header gate, symlink-safe lstat deletion, no capability for writes. Tech & constraints additions mirror the Global Constraints above.
- [ ] **Step 4: Update GLOSSARY** — terms: контекстное меню строки, диалог подтверждения удаления, uncommitted-предупреждение.
- [ ] **Step 5: Sync roadmap + future plan** — roadmap mutations note: deletion is the designed first slice (link to spec/plan); `p4-...md` status → `implementing`.
- [ ] **Step 6: Validate and commit**
  Run: `doc-canon validate --json` (expect ok:true, 0 errors), then `npm run typecheck && npm test && npm run build` (docs only; must stay green).
  Commit:

  ```bash
  git add docs/canon docs/superpowers
  git commit -m "docs(canon): delete via context menu — canon, p4 -> implementing, roadmap note"
  ```

---

### Task 2: Server — `GET /filemanager-fs/delete-info` (read-only preflight)

**Files:**
- Modify: `src/fs-api.ts`
- Test: `test/delete-api.test.ts` (new file; add only this task's describe here)

**Interfaces:**
- Consumes: existing `send`, `isInside`, `resolveRoot`, `runGitStatus` map shape, `GitStatus` type, and the per-handler `gitCache` in `createHandler`.
- Produces (consumed by Task 3 and the client in Task 4):

  ```ts
  // src/fs-api.ts — internal helpers (module scope, not exported)
  type ResolvedEntryKind = "file" | "dir" | "symlink-file" | "symlink-dir";
  async function resolveEntryKind(root: string, relPath: string): Promise<{ kind: ResolvedEntryKind } | null>;
  function uncommittedStatusSet(): ReadonlySet<GitStatus>; // { modified, added, untracked }
  function entryUncommitted(gitMap: Map<string, GitEntry>, relPath: string, isDir: boolean): boolean;

  // HTTP action (inside createHandler's switch):
  // case "delete-info": ...  -> 200 { kind, name, path, isRoot, uncommitted, ...(gitStatus?) }
  ```

- [ ] **Step 1: Write the failing tests**

Create `test/delete-api.test.ts` (request helper copied from `test/raw-api.test.ts`; fixture workspace is git-initialized):

```ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createGitStatusCache } from "../src/git-status-cache.js";
import { createHandler, debugCollectStatuses } from "../src/fs-api.js";

const execFileAsync = promisify(execFile);

function request(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  path: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => { await handler(req, res); });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      fetch("http://127.0.0.1:" + addr.port + path, { headers })
        .then(async (res) => { const body = await res.json(); server.close(); resolve({ status: res.status, body }); })
        .catch((err) => { server.close(); reject(err); });
    });
  });
}

describe("GET /filemanager-fs/delete-info", () => {
  let dir: string;
  let handler: ReturnType<typeof createHandler>;
  const hdr = { "x-dsh-filemanager": "1" };

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "delete-api-test-"));
    handler = createHandler(dir, { gitStatusCache: createGitStatusCache({ ttlMs: 0, collect: (root) => debugCollectStatuses(root) }) });
    await mkdir(join(dir, "sub"));
    await writeFile(join(dir, "tracked.txt"), "t");
    await writeFile(join(dir, "untracked.txt"), "u");
    await writeFile(join(dir, "sub", "nested.js"), "n");
    await execFileAsync("git", ["init"], { cwd: dir });
    await execFileAsync("git", ["config", "user.email", "t@e.c"], { cwd: dir });
    await execFileAsync("git", ["config", "user.name", "T"], { cwd: dir });
    await execFileAsync("git", ["add", "tracked.txt", "sub/nested.js"], { cwd: dir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: dir });
    await writeFile(join(dir, "tracked.txt"), "changed"); // modified
  });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it("reports kinds and isRoot=false for files and dirs", async () => {
    const file = await request(handler, "/filemanager-fs/delete-info?hint=" + encodeURIComponent(dir) + "&path=tracked.txt", hdr);
    assert.equal(file.status, 200);
    assert.equal(file.body.kind, "file");
    assert.equal(file.body.isRoot, false);
    assert.equal(file.body.uncommitted, true); // modified
    const dirRes = await request(handler, "/filemanager-fs/delete-info?hint=" + encodeURIComponent(dir) + "&path=sub", hdr);
    assert.equal(dirRes.body.kind, "dir");
    assert.equal(dirRes.body.uncommitted, false);
  });

  it("counts untracked files as uncommitted but never ignored", async () => {
    const u = await request(handler, "/filemanager-fs/delete-info?hint=" + encodeURIComponent(dir) + "&path=untracked.txt", hdr);
    assert.equal(u.body.uncommitted, true);
    const sub = await request(handler, "/filemanager-fs/delete-info?hint=" + encodeURIComponent(dir) + "&path=sub", hdr);
    assert.equal(sub.body.uncommitted, false); // nested.js committed
  });

  it("reports isRoot=true for an empty path and errors for escapes/missing", async () => {
    const root = await request(handler, "/filemanager-fs/delete-info?hint=" + encodeURIComponent(dir) + "&path=", hdr);
    assert.equal(root.status, 200);
    assert.equal(root.body.isRoot, true);
    const esc = await request(handler, "/filemanager-fs/delete-info?hint=" + encodeURIComponent(dir) + "&path=../x", hdr);
    assert.equal(esc.status, 403);
    const miss = await request(handler, "/filemanager-fs/delete-info?hint=" + encodeURIComponent(dir) + "&path=nope.txt", hdr);
    assert.equal(miss.status, 404);
  });

  it("requires the header", async () => {
    const res = await request(handler, "/filemanager-fs/delete-info?hint=" + encodeURIComponent(dir) + "&path=tracked.txt");
    assert.equal(res.status, 403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/delete-api.test.ts`
Expected: FAIL — unknown action: delete-info (404) / missing helpers.

- [ ] **Step 3: Implement in src/fs-api.ts**

Add module-level helpers (place near `getEntryStatuses`):

```ts
const UNCOMMITTED = new Set<GitStatus>(["modified", "added", "untracked"]);

async function resolveEntryKind(root: string, relPath: string): Promise<ResolvedEntryKind | null> {
  const target = resolve(root, relPath);
  if (!isInside(root, target)) return null; // caller maps to 403/404
  const st = await lstat(target).catch(() => null);
  if (!st) return null;
  if (st.isSymbolicLink()) {
    const linkStat = await stat(target).catch(() => null);
    if (!linkStat) return null;
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
 *  an uncommitted git status; ignored rows never count. */
function entryUncommitted(gitMap: Map<string, GitEntry>, relPath: string, isDir: boolean): boolean {
  const normalized = normalizeGitPath(relPath).replace(/\/+$/, "");
  const self = gitMap.get(normalized) ?? gitMap.get(normalized + "/");
  if (isDir) {
    const prefix = normalized ? normalized + "/" : "";
    for (const [path, entry] of gitMap.entries()) {
      if (path === normalized || path === normalized + "/") continue;
      if ((!prefix || path.startsWith(prefix)) && entry.status !== "ignored" && isUncommittedStatus(entry.status)) return true;
    }
    return false;
  }
  return isUncommittedStatus(self?.status);
}
```

Add the switch case in `createHandler` (before `case "delete":`) and note that `root` is already resolved above the switch:

```ts
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
```

Note: the git-status row for a directory may be under `rel + "/"`; for dirs, prefer not sending `gitStatus` when absent (the `uncommitted` aggregate is the contract the UI uses). Keep the response stable and documented in the case comment.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test test/delete-api.test.ts`
Expected: PASS (all delete-info tests).

- [ ] **Step 5: Full gate + commit**

Run: `npm run typecheck && npm test && npm run build`
Commit:

```bash
git add src/fs-api.ts test/delete-api.test.ts
git commit -m "feat(fs-api): GET /filemanager-fs/delete-info read-only preflight"
```

---

### Task 3: Server — `POST /filemanager-fs/delete` (mutating)

**Files:**
- Modify: `src/fs-api.ts`
- Test: `test/delete-api.test.ts` (append this task's describe)

**Interfaces:**
- Consumes: Task 2 helpers (`resolveEntryKind`), existing `send`/`isInside`/`resolveRoot`, `gitCache`.
- Produces: `POST /filemanager-fs/delete?hint=&path=` → `200 {"deleted": true, "path": "<rel>"}`.

- [ ] **Step 1: Write the failing tests**

Append to `test/delete-api.test.ts` (reuses the same before-fixture; add more fixtures inside the describe):

```ts
describe("POST /filemanager-fs/delete", () => {
  let dir: string;
  let handler: ReturnType<typeof createHandler>;
  const hdr = { "x-dsh-filemanager": "1" };
  const q = (p: string) => "/filemanager-fs/delete?hint=" + encodeURIComponent(dir) + "&path=" + encodeURIComponent(p);

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "delete-api-test-"));
    handler = createHandler(dir, { gitStatusCache: createGitStatusCache({ ttlMs: 0, collect: (root) => debugCollectStatuses(root) }) });
    await mkdir(join(dir, "sub", "deep"), { recursive: true });
    await writeFile(join(dir, "a.txt"), "a");
    await writeFile(join(dir, "sub", "b.js"), "b");
    await writeFile(join(dir, "sub", "deep", "c.txt"), "c");
    await symlink(join(dir, "a.txt"), join(dir, "link-file"));
    await symlink(join(dir, "sub"), join(dir, "link-dir"));
    await writeFile(join(dir, "outside.txt"), "keep me"); // created before the outside symlink target
  });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it("requires the header and rejects non-POST-less semantics via 403 for GET", async () => {
    // Our handler does not branch on method for this action; header is the gate.
    const noHeader = await request(handler, q("a.txt"));
    assert.equal(noHeader.status, 403);
  });

  it("deletes a single file", async () => {
    const res = await request(handler, q("a.txt"), hdr);
    assert.equal(res.status, 200);
    assert.equal(res.body.deleted, true);
    await assert.rejects(import("node:fs/promises").then((fs) => fs.stat(join(dir, "a.txt"))));
  });

  it("deletes a folder recursively", async () => {
    const res = await request(handler, q("sub"), hdr);
    assert.equal(res.status, 200);
    await assert.rejects(import("node:fs/promises").then((fs) => fs.stat(join(dir, "sub"))));
  });

  it("deletes a symlink but not its target (inside or outside)", async () => {
    const outsideDir = await mkdtemp(join(tmpdir(), "delete-link-target-"));
    await writeFile(join(outsideDir, "target.txt"), "keep");
    const linkOutside = join(dir, "link-outside");
    await symlink(join(outsideDir, "target.txt"), linkOutside);
    const okLink = await request(handler, q("link-file"), hdr);
    assert.equal(okLink.status, 200);
    const okOut = await request(handler, q("link-outside"), hdr);
    assert.equal(okOut.status, 200);
    const targetOk = await request(handler, "/filemanager-fs/delete?hint=" + encodeURIComponent(outsideDir) + "&path=target.txt", hdr);
    // sanity: outside target still exists
    const st = await import("node:fs/promises").then((fs) => fs.stat(join(outsideDir, "target.txt")));
    assert.ok(st.isFile());
    await rm(outsideDir, { recursive: true, force: true });
  });

  it("refuses workspace root, .git and escapes", async () => {
    const rootRes = await request(handler, q(""), hdr);
    assert.equal(rootRes.status, 403);
    const gitRes = await request(handler, q(".git"), hdr);
    assert.equal(gitRes.status, 403);
    const esc = await request(handler, q("../outside.txt"), hdr);
    assert.equal(esc.status, 403);
  });

  it("returns 404 for missing paths", async () => {
    const res = await request(handler, q("nope.txt"), hdr);
    assert.equal(res.status, 404);
  });
});
```

Notes for the implementer: adapt the symlink-outside case to your platform (`symlink` may need no special privileges on macOS/Node for files; if a directory-symlink target fixture is flaky, use a file target). Keep every assertion meaningful.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test test/delete-api.test.ts`
Expected: FAIL — unknown action: delete.

- [ ] **Step 3: Implement in src/fs-api.ts**

Add module helpers (above `createHandler`). First extend the existing `node:fs/promises` import in `src/fs-api.ts` so it also imports `unlink` and `rmdir` (today it imports `readdir, stat, realpath, lstat, open`):

```ts
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
  const st = await lstat(target).catch(() => null);
  if (!st) return false;
  if (st.isSymbolicLink()) await unlink(target);
  else if (st.isDirectory()) await deleteRecursive(target);
  else await unlink(target);
  return true;
}
```

Add the switch case (place after `case "delete-info":`; the action must also enforce the method — see the createHandler note below):

```ts
        case "delete": {
          if (req.method !== "POST") {
            return send(res, 405, { error: "method not allowed" });
          }
          const relPath = url.searchParams.get("path") ?? "";
          const target = resolve(root, relPath);
          if (!isInside(root, target)) {
            return send(res, 403, { error: "path escapes workspace" });
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
```

Method note for `createHandler`: the shared handler today dispatches by pathname only. For the mutating action add the `req.method !== "POST"` check inside the case (as above) — do NOT change the dispatch structure for other actions.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test test/delete-api.test.ts`
Expected: PASS (delete-info + delete describes).

- [ ] **Step 5: Full gate + commit**

Run: `npm run typecheck && npm test && npm run build`
Commit:

```bash
git add src/fs-api.ts test/delete-api.test.ts
git commit -m "feat(fs-api): POST /filemanager-fs/delete with root/.git guards and symlink-safe recursion"
```

---

### Task 4: Client — typed API fetchers + pure delete-flow helpers

**Files:**
- Create: `src/mutate-api.ts`, `src/delete-flow.ts`, `test/mutate-api.test.ts`, `test/delete-flow.test.ts`

**Interfaces:**
- Consumes: `GitStatus` type from `./api.js`.
- Produces (used by Tasks 5–6):

```ts
// mutate-api.ts
export type DeleteInfoKind = "file" | "dir" | "symlink-file" | "symlink-dir" | "missing";
export interface DeleteInfo {
  kind: DeleteInfoKind;
  name: string;
  path: string;
  isRoot: boolean;
  uncommitted: boolean;
  gitStatus?: GitStatus;
}
export function fetchDeleteInfo(hint: string, path: string): Promise<DeleteInfo>;
export function fetchDelete(hint: string, path: string): Promise<{ deleted: true; path: string }>;

// delete-flow.ts
export interface DeleteDialogModel {
  path: string;         // relative posix path as shown
  kind: DeleteInfoKind;
  blocked: boolean;     // root, or missing (nothing to delete)
  uncommitted: boolean;
  isDir: boolean;
}
export function buildDeleteDialogModel(info: DeleteInfo): DeleteDialogModel;
export function isPreviewAffected(deletedPath: string, previewPath: string | null): boolean;
```

`blocked` = `info.isRoot || info.kind === "missing"`. `isPreviewAffected` is true when `previewPath` equals `deletedPath` or starts with `deletedPath + "/"`.

- [ ] **Step 1: Write the failing tests**

`test/delete-flow.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDeleteDialogModel, isPreviewAffected, type DeleteInfo } from "../src/delete-flow.js";

const info = (partial: Partial<DeleteInfo>): DeleteInfo => ({
  kind: "file", name: "a.txt", path: "a.txt", isRoot: false, uncommitted: false, ...partial,
});

describe("buildDeleteDialogModel", () => {
  it("blocks root and missing entries", () => {
    assert.equal(buildDeleteDialogModel(info({ isRoot: true })).blocked, true);
    assert.equal(buildDeleteDialogModel(info({ kind: "missing" })).blocked, true);
    assert.equal(buildDeleteDialogModel(info({})).blocked, false);
  });
  it("carries dir-ness and the uncommitted flag", () => {
    const m = buildDeleteDialogModel(info({ kind: "dir", uncommitted: true }));
    assert.equal(m.isDir, true);
    assert.equal(m.uncommitted, true);
  });
});

describe("isPreviewAffected", () => {
  it("matches the deleted path and anything under a deleted directory", () => {
    assert.equal(isPreviewAffected("docs", null), false);
    assert.equal(isPreviewAffected("docs", "docs"), true);
    assert.equal(isPreviewAffected("docs", "docs/a/b.md"), true);
    assert.equal(isPreviewAffected("docs", "docs2/a.md"), false);
    assert.equal(isPreviewAffected("a.txt", "b.txt"), false);
  });
});
```

`test/mutate-api.test.ts` (mock global fetch):

```ts
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fetchDeleteInfo, fetchDelete } from "../src/mutate-api.js";

type FetchArgs = [string, RequestInit?];
let captured: FetchArgs[] = [];

afterEach(() => { captured = []; });

function mockFetch(status: number, body: unknown) {
  (globalThis as any).fetch = async (input: any, init?: RequestInit) => {
    captured.push([String(input), init ?? {}]);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
}

describe("mutate-api", () => {
  it("fetchDeleteInfo hits the action with the header and parses the body", async () => {
    mockFetch(200, { kind: "file", name: "a.txt", path: "a.txt", isRoot: false, uncommitted: true });
    const info = await fetchDeleteInfo("/ws", "a.txt");
    assert.equal(info.kind, "file");
    assert.equal(info.uncommitted, true);
    const [url, init] = captured[0] as FetchArgs;
    assert.ok(url.includes("/filemanager-fs/delete-info"));
    assert.equal((init.headers as Record<string, string>)["x-dsh-filemanager"], "1");
  });

  it("fetchDelete posts and parses success", async () => {
    mockFetch(200, { deleted: true, path: "a.txt" });
    const res = await fetchDelete("/ws", "a.txt");
    assert.equal(res.deleted, true);
    const [url, init] = captured[0] as FetchArgs;
    assert.ok(url.includes("/filemanager-fs/delete"));
    assert.equal((init as RequestInit).method, "POST");
  });

  it("throws the server error message on failure", async () => {
    mockFetch(403, { error: "cannot delete workspace root" });
    await assert.rejects(() => fetchDelete("/ws", ""), /cannot delete workspace root/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test test/delete-flow.test.ts test/mutate-api.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement**

`src/mutate-api.ts`:

```ts
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
```

`src/delete-flow.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test test/delete-flow.test.ts test/mutate-api.test.ts`
Expected: PASS.

- [ ] **Step 5: Full gate + commit**

Run: `npm run typecheck && npm test && npm run build`
Commit:

```bash
git add src/mutate-api.ts src/delete-flow.ts test/mutate-api.test.ts test/delete-flow.test.ts
git commit -m "feat(preview): delete API client and pure delete-flow helpers"
```

---

### Task 5: Client — context menu scaffold + row trigger

**Files:**
- Create: `src/ContextMenu.tsx`
- Modify: `src/styles.ts`, `src/Tree.tsx`, `src/Panel.tsx`, `src/l10n.ts`

**Interfaces:**
- Consumes: nothing new (uses `useL10n`).
- Produces (used by Task 6):

```tsx
// ContextMenu.tsx
export interface ContextMenuItem {
  id: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}
export interface ContextMenuProps {
  x: number; // viewport coords; the menu clamps itself to the viewport
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}
export function ContextMenu(props: ContextMenuProps): JSX.Element;
```

New l10n keys (en + ru): `deleteMenuItem` — en "Delete…", ru "Удалить…".

Panel owns the menu state. New Panel state:

```ts
const [contextMenu, setContextMenu] = useState<{ path: string; name: string; x: number; y: number } | null>(null);
```

Tree rows call a new optional prop when the user right-clicks a row or presses Menu/Shift+F10:

```ts
// TreeProps + per-row plumbing
onRowContextMenu?: (path: string, name: string, kind: string, point: { x: number; y: number }) => void;
```

Row trigger (inside the row `<div>` in `src/Tree.tsx`): add `onContextMenu` (preventDefault then call the prop with clientX/Y) and onKeyDown handling for `key === "ContextMenu"` / `(event.shiftKey && event.key === "F10")` that prevents default and calls the prop with the row's bounding rect (left, bottom).

- [ ] **Step 1: Add the l10n key (en + ru)**

In `src/l10n.ts`: add `deleteMenuItem: "Delete…"` to en and `deleteMenuItem: "Удалить…"` to ru.

- [ ] **Step 2: Add the styles**

In `src/styles.ts` (before `.fm-name-tooltip`), append:

```css
.fm-context-menu {
  position: fixed;
  z-index: 2147483645;
  min-width: 150px;
  padding: 4px;
  border: 1px solid var(--fm-border-strong);
  border-radius: 8px;
  background: var(--fm-surface-elevated);
  box-shadow: 0 6px 24px rgba(15, 23, 42, 0.18);
}
.fm-context-menu-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 10px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  cursor: pointer;
}
.fm-context-menu-item:hover,
.fm-context-menu-item:focus-visible {
  background: var(--fm-hover);
}
.fm-context-menu-item--danger {
  color: var(--dsw-alias-state-error-primary);
}
```

- [ ] **Step 3: Create `src/ContextMenu.tsx`**

```tsx
// src/ContextMenu.tsx
import { useEffect, useRef, type ReactNode } from "react";

export interface ContextMenuItem {
  id: string;
  label: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

const MENU_MARGIN = 6;

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Clamp to the viewport after mount so long menus / edge anchors stay visible.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const left = Math.max(MENU_MARGIN, Math.min(x, window.innerWidth - rect.width - MENU_MARGIN));
    const top = Math.max(MENU_MARGIN, Math.min(y, window.innerHeight - rect.height - MENU_MARGIN));
    el.style.left = left + "px";
    el.style.top = top + "px";
  }, [x, y]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); }
    };
    const onScroll = () => onClose();
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  const focusFirst = (el: HTMLDivElement | null) => { el?.focus(); };

  return (
    <div
      ref={(node) => { ref.current = node; focusFirst(node?.querySelector?.("[data-autofocus]") as HTMLDivElement | null ?? null); }}
      className="fm-context-menu"
      role="menu"
      style={{ left: x, top: y }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
          const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === "ArrowDown" ? (idx + 1) % buttons.length : (idx - 1 + buttons.length) % buttons.length;
          buttons[next]?.focus();
        }
      }}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          className={"fm-context-menu-item" + (item.danger ? " fm-context-menu-item--danger" : "")}
          disabled={item.disabled}
          data-autofocus={item.id === items[0]?.id ? "" : undefined}
          onClick={() => { onClose(); item.onSelect(); }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Wire the trigger in `src/Tree.tsx`**

Add the prop to `TreeProps`/`TreeNodeProps` and thread it down to the row div (row level is where `fullPath`/`entry.name` are known). On the row div add:

```tsx
onContextMenu={(event) => {
  event.preventDefault();
  onRowContextMenu?.(fullPath, entry.name, entry.kind, { x: event.clientX, y: event.clientY });
}}
```

and extend the existing row keyboard handler so Menu / Shift+F10 opens the menu at the row rect:

```tsx
if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
  event.preventDefault();
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  onRowContextMenu?.(fullPath, entry.name, entry.kind, { x: rect.left, y: rect.bottom });
  return;
}
```

Wire it in Panel: pass `onRowContextMenu={(path, name, _kind, point) => setContextMenu({ path, name, x: point.x, y: point.y })}` to `<Tree>`. In Panel's returned JSX render the menu when `contextMenu !== null`:

```tsx
{contextMenu && (
  <ContextMenu
    x={contextMenu.x}
    y={contextMenu.y}
    onClose={() => setContextMenu(null)}
    items={[
      {
        id: "delete",
        label: t("deleteMenuItem"),
        danger: true,
        onSelect: () => {
          // Task 6 wires the confirm dialog; for now only clear + keep a
          // pending marker so the flow compiles green at this commit.
          setPendingDelete({ path: contextMenu.path, name: contextMenu.name });
        },
      },
    ]}
  />
)}
```

Add `const [pendingDelete, setPendingDelete] = useState<{ path: string; name: string } | null>(null);` to Panel now (Task 6 consumes it; at this commit it is set but unused — guard TS by referencing it in the menu close handler if needed, or keep the state and an eslint-safe no-op; the typecheck only requires the variable to be used, so pass it through `setPendingDelete(null)` on menu close if unused). Cleaner: Task 5 keeps the state and Task 6 consumes it — to satisfy TS in Task 5 use it in the onClose: `onClose={() => { setPendingDelete(null); setContextMenu(null); }}`.

- [ ] **Step 5: Full gate + commit**

Run: `npm run typecheck && npm test && npm run build`
Commit:

```bash
git add src/ContextMenu.tsx src/styles.ts src/Tree.tsx src/Panel.tsx src/l10n.ts
git commit -m "feat(preview): tree row context menu scaffold (right-click / Menu key) with Delete item"
```

---

### Task 6: Client — confirm dialog + delete flow

**Files:**
- Create: `src/ConfirmDeleteDialog.tsx`
- Modify: `src/styles.ts`, `src/Panel.tsx`, `src/l10n.ts`

**Interfaces:**
- Consumes: `ContextMenu`/`pendingDelete` (Task 5), `fetchDeleteInfo`/`fetchDelete` + `DeleteInfo` (Task 4), `buildDeleteDialogModel`/`isPreviewAffected` (Task 4), store (for prune + preview path), `useL10n`.
- Produces: full delete flow — menu Delete → fetch delete-info → dialog (warnings) → confirm → POST delete → close affected preview + prune expanded + clear pending → error surface on failure.

New l10n keys (en + ru): `deleteDialogTitle` ("Delete" / "Удалить"), `deleteFileBody` ("Delete {name}?"), `deleteFolderBody` ("Delete {name} and all its contents?"), `deleteUncommittedWarning` ("Uncommitted git changes inside will be lost." / "Незакоммиченные изменения git внутри будут потеряны."), `cancel` ("Cancel"/"Отмена"), `deleteAction` ("Delete"/"Удалить"), `deleteBlocked` ("Nothing to delete." / "Удалять нечего."), `deleteErrorPrefix` ("Delete failed: "/"Не удалось удалить: ").

Interpolation style matches the repo (`errorPrefix` prefix concatenation at call sites) — the body builders concatenate `t(...)` + name, they are not ICU strings.

ConfirmDeleteDialog props:

```tsx
export interface ConfirmDeleteDialogProps {
  name: string;
  model: ReturnType<typeof buildDeleteDialogModel>;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}
```

- [ ] **Step 1: Add l10n keys + styles**

l10n en + ru keys listed above. Styles (append):

```css
.fm-confirm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  background: rgba(15, 23, 42, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
}
.fm-confirm-dialog {
  width: min(420px, calc(100vw - 32px));
  background: var(--fm-surface-elevated);
  border: 1px solid var(--fm-border-strong);
  border-radius: 12px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.25);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.fm-confirm-path {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  word-break: break-all;
  color: var(--dsw-alias-label-secondary);
}
.fm-confirm-warning {
  color: var(--dsw-alias-state-error-primary);
  font-size: 13px;
}
.fm-confirm-error {
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
}
.fm-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.fm-confirm-btn {
  border: 1px solid var(--fm-border-strong);
  background: none;
  color: var(--dsw-alias-label-primary);
  border-radius: 8px;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
}
.fm-confirm-btn:hover { background: var(--fm-hover); }
.fm-confirm-btn--danger {
  border-color: var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-state-error-primary);
}
```

- [ ] **Step 2: Create `src/ConfirmDeleteDialog.tsx`**

```tsx
// src/ConfirmDeleteDialog.tsx
import { useEffect, useRef } from "react";
import { useL10n } from "./use-l10n.js";
import type { DeleteDialogModel } from "./delete-flow.js";

export interface ConfirmDeleteDialogProps {
  name: string;
  model: DeleteDialogModel;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDeleteDialog({ name, model, busy, error, onCancel, onConfirm }: ConfirmDeleteDialogProps) {
  const { t } = useL10n();
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); onCancel(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  return (
    <div className="fm-confirm-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <div className="fm-confirm-dialog" role="alertdialog" aria-label={t("deleteDialogTitle")}>
        <strong>{model.isDir ? t("deleteFolderBody").replace("{name}", name) : t("deleteFileBody").replace("{name}", name)}</strong>
        <div className="fm-confirm-path">{model.path}</div>
        {model.uncommitted && <div className="fm-confirm-warning">{t("deleteUncommittedWarning")}</div>}
        {model.blocked && !busy && <div className="fm-confirm-error">{t("deleteBlocked")}</div>}
        {error && <div className="fm-confirm-error">{t("deleteErrorPrefix")}{error}</div>}
        <div className="fm-confirm-actions">
          <button ref={cancelRef} type="button" className="fm-confirm-btn" onClick={onCancel} disabled={busy}>
            {t("cancel")}
          </button>
          <button
            type="button"
            className="fm-confirm-btn fm-confirm-btn--danger"
            onClick={onConfirm}
            disabled={busy || model.blocked}
          >
            {busy ? t("loading") : t("deleteAction")}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Implement the Panel flow**

Panel state additions (in addition to Task 5's):

```ts
const [pendingDelete, setPendingDelete] = useState<{ path: string; name: string } | null>(null); // Task 5 already declared
const [deleteInfo, setDeleteInfo] = useState<DeleteInfo | null>(null);
const [deleteBusy, setDeleteBusy] = useState(false);
const [deleteError, setDeleteError] = useState<string | null>(null);
```

Effect — when `pendingDelete` becomes non-null, fetch its delete-info and open the dialog:

```ts
useEffect(() => {
  if (!pendingDelete || !hint) { setDeleteInfo(null); return; }
  let cancelled = false;
  setDeleteBusy(false);
  setDeleteError(null);
  fetchDeleteInfo(hint, pendingDelete.path)
    .then((info) => { if (!cancelled) setDeleteInfo(info); })
    .catch((err: any) => { if (!cancelled) { setDeleteError(err?.message ?? String(err)); setDeleteInfo(null); } });
  return () => { cancelled = true; };
}, [pendingDelete, hint]);
```

The menu Delete item (Task 5) sets `pendingDelete`; render the dialog when `pendingDelete && deleteInfo && !deleteInfo.isRoot` (blocked states still render with the Delete disabled via the model). If `deleteError && pendingDelete && !deleteInfo`, render the dialog with `model = buildDeleteDialogModel({ kind: "missing", name: pendingDelete.name, path: pendingDelete.path, isRoot: false, uncommitted: false })`.

Confirm handler:

```ts
const handleConfirmDelete = useCallback(async () => {
  if (!hint || !pendingDelete || !deleteInfo) return;
  setDeleteBusy(true);
  setDeleteError(null);
  try {
    await fetchDelete(hint, pendingDelete.path);
    const deletedPath = pendingDelete.path;
    // Close a preview of the deleted file / a file under the deleted folder.
    if (previewPathRef.current && isPreviewAffected(deletedPath, previewPathRef.current)) {
      handleClosePreview();
    }
    // Drop expanded state under the deleted path.
    const expanded = store.getExpandedPaths();
    const stale = expanded.filter((p) => p === deletedPath || p.startsWith(deletedPath + "/"));
    if (stale.length > 0) store.pruneExpandedPaths(stale);
    // The fs event from the delete itself refreshes the parent listings.
    setPendingDelete(null);
    setDeleteInfo(null);
  } catch (err: any) {
    setDeleteError(err?.message ?? String(err));
  } finally {
    setDeleteBusy(false);
  }
}, [hint, pendingDelete, deleteInfo, store, handleClosePreview]);
```

Render block in Panel JSX (after the ContextMenu block):

```tsx
{pendingDelete && (deleteInfo || deleteError) && (
  <ConfirmDeleteDialog
    name={pendingDelete.name}
    model={buildDeleteDialogModel(
      deleteInfo ?? { kind: "missing", name: pendingDelete.name, path: pendingDelete.path, isRoot: false, uncommitted: false }
    )}
    busy={deleteBusy}
    error={deleteError}
    onCancel={() => { setPendingDelete(null); setDeleteInfo(null); setDeleteError(null); }}
    onConfirm={handleConfirmDelete}
  />
)}
```

Guard the preview-dock Esc handler: in Panel's existing Escape `keydown` effect for the preview, ignore when a delete dialog is open (`if (pendingDelete) return;` before closing the preview).

- [ ] **Step 4: Full gate + commit**

Run: `npm run typecheck && npm test && npm run build`
Commit:

```bash
git add src/ConfirmDeleteDialog.tsx src/Panel.tsx src/l10n.ts src/styles.ts
git commit -m "feat(preview): delete confirmation dialog and delete flow (preview close, prune, errors)"
```

---

### Task 7: Docs wrap-up — README and CHANGELOG

**Files:**
- Modify: `README.md`, `CHANGELOG.md`

- [ ] **Step 1: Update README**

- Features: add a bullet — tree rows get a context menu (right-click or Menu key) with Delete; deletion is confirmed in an inline dialog that warns about uncommitted git changes; files and folders (recursively) can be deleted, symlinks are removed as links; the workspace root and `.git` are protected.
- Scope paragraph: update "The panel is read-only" to say "read-only, except explicit confirmed deletion of files/folders via the tree's context menu (File operations create/rename/move are out of scope)."
- Server API: add `GET /filemanager-fs/delete-info` and `POST /filemanager-fs/delete` descriptions (both header-gated; delete is POST-only; error codes 403/404/409).

- [ ] **Step 2: Update CHANGELOG under [Unreleased]**

```markdown
### Added

- Tree row context menu (right-click or Menu key) with Delete; inline
  confirmation dialog warns about uncommitted git changes inside the
  deleted file/folder before the destructive action
- Server actions `GET /filemanager-fs/delete-info` (read-only preflight) and
  `POST /filemanager-fs/delete` (header-gated, POST-only, symlink-safe,
  workspace root and `.git` protected)
```

- [ ] **Step 3: Full gate + commit**

Run: `npm run typecheck && npm test && npm run build`
Commit:

```bash
git add README.md CHANGELOG.md
git commit -m "docs: README + CHANGELOG for context-menu delete"
```

---

## Self-Review Notes (from the planner)

- **Spec coverage:** D1 permanent delete → Tasks 3 + 6; D2 inline dialog → Task 6; D3 uncommitted warning → Tasks 2 + 6; D4 single-object via reusable menu → Task 5. Server contract (Section 1–2) → Tasks 2–3; flows/errors (Sections 3–5) → Tasks 5–6; security notes → Tasks 1 + 3; testing (Section 7) → Tasks 2–4; l10n/a11y (Section 8) → Tasks 5–6; canon updates → Task 1; out-of-scope untouched.
- **Type consistency:** `DeleteInfoKind`/`DeleteInfo`/`fetchDeleteInfo`/`fetchDelete` defined in Task 4, consumed by Task 6; `buildDeleteDialogModel`/`isPreviewAffected` in Task 4 → Task 6; `pendingDelete`/`contextMenu` state introduced in Task 5, consumed in Task 6; `ConfirmDeleteDialogProps` Task 6 only; server action names match the client fetchers.
- **Placeholder scan:** all code steps carry real code; Task 3 contains the final recursion once (deleteRecursive over absolute paths) with the import note, no alternate drafts.
