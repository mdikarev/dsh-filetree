# File/Folder Deletion via Tree Context Menu — Design

**Status:** draft (2026-09-04), awaiting user review.
**Scope:** the plugin's first write-class operation. Single-object delete (file, or folder recursively) invoked from a new row context menu, protected by an inline confirmation dialog and uncommitted-change warnings. The context-menu scaffold is designed to host future commands (rename, copy path, …); multi-select delete is out of scope.
**Spec for:** the follow-up implementation plan; realizes future-plan `future_plans/p4-file-deletion-context-menu.md` (draft).
**Based on:** 2026-09-04 brainstorming with the user (decisions below marked D1–D4).

## Decisions (agreed with the user)

- **D1 (fate):** deletion is permanent (`unlink` / recursive directory removal). No OS-trash or workspace trash this cycle; trash/undo is a separate future initiative.
- **D2 (confirmation):** an inline, theme-aware dialog inside the plugin panel (not `window.confirm`, not host-approval integration). Full relative path shown; Cancel is the default-focus action; Esc cancels.
- **D3 (data-loss guard):** deleting a file, or a folder containing files, that have uncommitted git changes (modified / added / deleted / untracked; ignored excluded) shows an explicit warning in the dialog ("uncommitted changes will be lost") but does NOT block deletion — an explicit confirm is enough.
- **D4 (scope):** single-object delete only. No multi-select this cycle. The context menu is a reusable scaffold (menu items array) so later commands slot in without UI rework.

## Context / constraints discovered

- The plugin is read-only today: `GET /filemanager-fs/{root,list,read,events,cap}` and the header-less `GET /raw`. Deletion is the first operation that changes workspace state; the maturity roadmap explicitly parked "file mutations … separate future phase requiring its own security design".
- All API requests require the `x-dsh-filemanager: 1` header; only `/raw` is header-less (capability-token based) and only for `<img>` delivery. Write endpoints must stay header-gated and must not be reachable as simple cross-origin requests.
- Live refresh already handles disappearance: fs events on parent directories → targeted invalidation; removed nodes vanish; the client prunes expanded paths (`store.pruneExpandedPaths`, `staleExpandedPathsUnder`); watchers on removed directories close through the existing per-connection lifecycle. The server git-status cache invalidates on fs/git events and can be invalidated explicitly.
- The tree is keyboard-accessible (rows focusable, Menu/Shift+F10 not yet bound), the preview dock is a dialog closed by Esc, l10n is en/ru, a11y level is L1.
- Deletion of a directory that a live connection is watching is a normal fs event to its parent; the client coordinator already drops stale watchers when expanded paths are pruned.

## Design

### 1. Server — `POST /filemanager-fs/delete` (mutating)

- Method: POST only. Header `x-dsh-filemanager: 1` required. Query: `hint`, `path` (relative, posix). No body. CSRF posture equals the read API: a cross-origin simple request cannot attach the header → 403.
- Validation order: header gate → containment (`resolve` + `isInside`) → `realpath` + `isInside` → not the workspace root (403) → no path segment equals `.git` (403, covers linked-worktree `.git` files too) → exists (404 if missing).
- Operation (lstat-based, symlink-safe):
  - symlink (file or dir) → `unlink` the link only; the target — inside or outside the workspace — is never followed for deletion;
  - regular file → `unlink`;
  - directory → depth-first recursive removal: `readdir` + per-entry `lstat`; recurse into real directories, unlink files/symlinks; never descend through a symlink; `rmdir` the directory at the end.
- Success: `200 {"deleted": true, "path": "<rel>"}`. Errors as JSON: 403 (`path escapes workspace` / `cannot delete workspace root` / `cannot delete .git`), 404 (`not found`), 400 (`not a file or directory`), 409 (`delete failed: <os message>` for EPERM/EACCES/EBUSY/ENOTEMPTY/ELOOP etc.), 500.
- After success: `gitCache.invalidate(root)`.
- No extra event broadcast: the delete itself produces fs events on the parent directories, and the existing live-refresh path handles node removal, expanded-path pruning and watcher cleanup.

### 2. Server — `GET /filemanager-fs/delete-info` (read-only preflight)

- Header-gated GET. Query `hint`, `path`.
- Response `200`: `{ kind: "file" | "dir" | "symlink-file" | "symlink-dir" | "missing", name, path, isRoot: boolean, uncommitted: boolean, gitStatus?: GitStatus }` where:
  - `kind` from `lstat` (+ link target type, mirroring `/list`);
  - `isRoot` true when the resolved path is the workspace root (UI hides Delete for it; server refuses anyway);
  - `uncommitted`: for a file — git status ∈ {modified, added, untracked} (a target must exist, so "deleted" rows cannot apply); for a directory — any existing descendant entry in that set (ignored entries never count); computed from the existing per-handler git-status snapshot cache.
- Errors: 403 escape, 404 missing, 500. This endpoint is read-only and reusable by future menu commands.

### 3. Client — context menu scaffold (`src/context-menu.tsx`)

- Trigger: row `onContextMenu` (right-click) or keyboard Menu / Shift+F10 on the focused row. The menu renders fixed at the cursor (clamped to the panel), items are `role="menu"`/`role="menuitem"`, arrow keys/Enter/Esc navigate within the menu; outside click / Esc / scroll / row-change closes it.
- The single item now is **Delete…** (danger-styled); the item list is data-driven (`{ id, label, danger?, disabled?, onSelect }[]`) so later commands are additive.
- Delete is disabled/hidden when the row is the workspace root.

### 4. Client — confirmation dialog (`src/ConfirmDialog.tsx`) and flow

- Open Delete… → `GET delete-info` (loading state on the menu item or a thin spinner) → open the dialog with the fetched facts.
- Dialog: `role="alertdialog"`, `aria-label` localized; title "Delete …?"; the full relative path; for directories "and all its contents"; the D3 warning line when `uncommitted`; buttons **Cancel** (default focus, Enter activates) and **Delete** (danger). Esc cancels. While the dialog is open, the preview dock's Esc handler is suppressed (dialog wins).
- Confirm → `POST delete`. On success: if the open preview path equals the deleted path or lies under a deleted directory, close the preview dock; `store.pruneExpandedPaths([deletedPath])` (and any expanded descendants via the existing prune semantics); listings update through normal fs events. On failure: close the dialog and surface the localized server error in the panel error area; the tree is left untouched.

### 5. Error handling / edge cases

- 403/404/409 mapped to localized messages in the panel error area; a repeated Delete on a gone path yields 404, nothing breaks.
- TOCTOU: deletion operates on realpath-resolved paths with a fresh `lstat` per recursion level; the narrow race between preflight and delete is accepted under the localhost trust boundary (documented, not hardened with extra syscalls).
- Deleting a watched expanded directory flows through the existing watcher-error tolerance and client pruning.

### 6. Security notes

| Threat | Mitigation |
| --- | --- |
| Cross-origin trigger of deletion | POST only + `x-dsh-filemanager: 1` header gate (same CSRF posture as the read API); no header-less write path, no capability tokens for write |
| Delete outside the workspace | realpath + isInside containment (mirrors `/read`) |
| Delete the workspace root or `.git` | explicit 403 guards |
| Symlink pointing outside the workspace | lstat-based: the link is unlinked, the target is never followed |
| Unbounded recursion | recursion confined under the workspace root; symlinks not descended |

### 7. Testing

- **Server** (`test/delete-api.test.ts`, existing local-http harness): delete file; delete nested folder recursively; symlink (to inside and outside target) removes only the link, target file intact; escape → 403; root → 403; `.git` → 403; missing → 404; success body; git cache invalidated after delete (next listing shows the removal / no stale badge).
- **Server** (`delete-info` in the same or `fs-api` tests): kinds incl. symlink and missing; file gitStatus; folder aggregate with modified inside; untracked counts, ignored does not; `isRoot`.
- **Client** (pure helpers, node tests): dialog props derived from `delete-info` (warning string selection); preview-close decision given (deletedPath, previewPath); context-menu target derivation. Existing no-DOM-infra constraint stands — the interactive parts go through the human GUI smoke.
- Gate per commit: `npm run typecheck && npm test && npm run build`; l10n en/ru key parity; a11y L1 checks via code review.

### 8. l10n / a11y / styles

- New en/ru keys: menu label "Delete…", dialog title/message pieces (file vs folder, contents), uncommitted warning, Cancel/Delete buttons, error strings for 403/404/409, loading. Danger styling via DSH tokens in `styles.ts`; menu + dialog styles additive.
- A11y: `alertdialog` semantics, focus on Cancel, Esc priority over the preview dock, menu keyboard model, focus-visible.

## Out of scope (parked)

- Multi-select delete; trash/undo/restore; rename/create/move/copy; delete initiated by drag-and-drop; deleting `.git` internals; OS-permission escalation (no elevation); server-side trash hooks.
- Context-menu commands other than Delete (the scaffold allows them later).

## Canon updates (after user go-ahead, via canon-write; then the implementation plan)

- `OVERVIEW.md`: Scope — the read-only invariant becomes "read-only except explicit, confirmed deletion"; success signals for the delete flow.
- `ARCHITECTURE.md`: Public interfaces (`/delete`, `/delete-info`), key flow "Удаление через контекстное меню", failure modes (403/404/409), security notes table row; Building blocks (context-menu, dialog).
- `GLOSSARY.md`: context menu, deletion dialog, uncommitted warning terms.
- `future_plans/p4-file-deletion-context-menu.md`: status stays `draft` until implementation begins (→ `implementing`), open questions that got answered here (trash → out; multi-select → out; confirm inline) recorded.
- Maturity roadmap: note that the parked mutations phase now has its designed first slice (deletion).
