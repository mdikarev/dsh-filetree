# Live Tree Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Автоматически обновлять раскрытые каталоги при изменениях на диске через SSE и `fs.watch`, с polling fallback и подтверждением обновления текущего preview.

**Architecture:** Host предоставляет SSE endpoint `/filemanager-fs/events`, который наблюдает только переданные раскрытые каталоги и освобождает watchers при disconnect. Клиентский coordinator дебаунсит события, инвалидирует только затронутые раскрытые узлы и сохраняет текущий UI state; при изменении открытого preview показывает confirmation banner. При сбое SSE/watch включается polling раскрытых каталогов раз в 5 секунд.

**Tech Stack:** Node.js `fs.watch`, HTTP ServerResponse SSE, TypeScript, React 18, существующие `fetchList`/`fetchFile`, `FileManagerStore`, Node test runner, `tsx`.

**Spec:** `docs/superpowers/specs/2026-08-21-file-tree-live-refresh-design.md`

## Global Constraints

- Наблюдать только раскрытые каталоги, не весь workspace.
- Все `hint` и `paths` проверять через существующие workspace boundary правила `realpath`/`isInside`.
- Требовать заголовок `x-dsh-filemanager: 1` для SSE.
- Использовать debounce 200–300 мс и объединять события по пути.
- Сохранять expanded paths, preview state и Markdown source/rendered mode.
- Изменение текущего preview не применять молча; показывать «Обновить» / «Оставить текущую версию».
- При сбое watcher/SSE включать polling раскрытых каталогов раз в 5 секунд.
- Не менять существующие root/list/read JSON-контракты и не добавлять WebSocket.
- Не отправлять события за пределы workspace или из `.git`.
- Закрывать watchers, EventSource и timers при disconnect, смене workspace и закрытии панели.

## File Map

- Create: `src/fs-events.ts` — parse/validate watched paths, watcher lifecycle, event normalization, polling snapshot helpers.
- Create: `src/live-refresh.ts` — pure debounce, affected-directory mapping, SSE payload parsing and polling coordination state.
- Modify: `src/fs-api.ts` — register SSE `events` action while preserving root/list/read behavior.
- Modify: `src/index.ts` — expose the events handler through the existing `/filemanager-fs` prefix.
- Modify: `src/api.ts` — typed SSE URL/payload helpers if needed; existing fetch headers remain unchanged.
- Modify: `src/store.ts` — expose expanded paths snapshot/subscription or use existing store APIs without duplicating persistence.
- Modify: `src/Tree.tsx` — accept refresh signals/coordinator callback and reload affected expanded nodes.
- Modify: `src/Panel.tsx` — lifecycle, current preview invalidation, confirmation banner and refresh/dismiss actions.
- Modify: `src/styles.ts` — live status and confirmation banner styles.
- Create: `test/fs-events.test.ts` — validation, normalization, debounce/snapshot helper tests.
- Create: `test/live-refresh.test.ts` — coordinator and affected-directory tests.
- Modify/create: focused Panel/Tree pure tests where existing DOM-free test patterns permit.

### Task 1: Implement secure watcher primitives and SSE host endpoint

**Files:**
- Create: `src/fs-events.ts`
- Modify: `src/fs-api.ts`
- Modify: `src/index.ts`
- Create: `test/fs-events.test.ts`

**Interfaces:**
- Produce `parseWatchedPaths(raw: string | null): string[]` that returns only valid relative paths or throws a client error.
- Produce `normalizeFsEvent(root: string, watchedDir: string, filename: string | Buffer, kind: "rename" | "change"): { type: "changed"; path: string; kind: "rename" | "change" } | null`.
- Produce `createEventsHandler(defaultRoot: string)` with the same security header and `hint` semantics as `createHandler`.
- SSE response sends `event: changed` and one JSON `data:` line per normalized event.

- [ ] **Step 1: Write failing tests** for missing header, invalid JSON paths, absolute paths, `..` traversal, valid relative paths, `.git` filtering, event normalization inside root, outside-root rejection, SSE headers/payload, and watcher cleanup on response close.
- [ ] **Step 2: Run `npm test -- --test-name-pattern="fs events"`; expected: FAIL.
- [ ] **Step 3: Implement validation and watcher lifecycle** using `resolveRoot`, `realpath`, `stat`, `isInside`, and `fs.watch`. Never create a watcher before all requested paths validate. Register response close/error cleanup for every watcher.
- [ ] **Step 4: Add the `events` action** to the existing route dispatch without changing root/list/read response shapes. Set `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, flush headers, and handle disconnect.
- [ ] **Step 5: Run focused and full tests** with `npm test`; expected: all pass.
- [ ] **Step 6: Commit** with `git add src/fs-events.ts src/fs-api.ts src/index.ts test/fs-events.test.ts && git commit -m "feat: add secure filesystem event stream"`.

### Task 2: Implement pure live-refresh coordination

**Files:**
- Create: `src/live-refresh.ts`
- Create: `test/live-refresh.test.ts`
- Modify: `src/api.ts` only if typed event helpers are required.

**Interfaces:**
- Produce `type FileChange = { type: "changed"; path: string; kind: "rename" | "change" }`.
- Produce `parentDirectory(path: string): string`.
- Produce `affectedExpandedDirectories(changedPath: string, expandedPaths: string[]): string[]` with deduplicated relative directories.
- Produce `createDebouncer(delayMs: number, emit: (changes: FileChange[]) => void): { push(change): void; cancel(): void }`.
- Produce `parseSseChange(data: string): FileChange | null` that rejects malformed/unsafe payloads without throwing.

- [ ] **Step 1: Write failing tests** for parent mapping, root-level files, nested files, rename events, deduplication, malformed payloads, debounce grouping within 200–300 ms, and cancellation.
- [ ] **Step 2: Run focused tests**; expected: FAIL.
- [ ] **Step 3: Implement pure helpers** with no React or filesystem dependencies; preserve root path as `""` and never emit absolute paths.
- [ ] **Step 4: Run focused tests**; expected: PASS.
- [ ] **Step 5: Commit** with `git add src/live-refresh.ts test/live-refresh.test.ts src/api.ts && git commit -m "feat: add live refresh coordination"`.

### Task 3: Integrate targeted tree invalidation and SSE lifecycle

**Files:**
- Modify: `src/store.ts`
- Modify: `src/Tree.tsx`
- Modify: `src/Panel.tsx`
- Modify: `src/api.ts`
- Add focused tests as needed.

**Interfaces:**
- `Panel` owns the current EventSource lifecycle keyed by `hint` and the list of expanded relative paths.
- `Tree` receives a refresh generation or targeted refresh callback without losing its existing expanded-path persistence.
- A change event causes `fetchList` only for affected expanded directories; root is included when the root is affected.

- [ ] **Step 1: Add failing pure tests** for targeted invalidation, preserving expanded paths, ignoring events from an old workspace, and stopping subscription on workspace change/close.
- [ ] **Step 2: Run focused tests**; expected: FAIL.
- [ ] **Step 3: Expose the minimum expanded-path snapshot/subscription needed from the existing store; do not duplicate localStorage persistence.
- [ ] **Step 4: Create/recreate EventSource** when workspace or expanded-path set changes; URL-encode `hint` and the JSON `paths` query; close old source before replacement.
- [ ] **Step 5: Route parsed/debounced changes** through targeted invalidation and update Git status entries while keeping preview/layout state. Handle EventSource errors with reconnect/backoff and no duplicate active subscriptions.
- [ ] **Step 6: Run focused and full tests**; expected: PASS.
- [ ] **Step 7: Commit** with `git add src/store.ts src/Tree.tsx src/Panel.tsx src/api.ts test && git commit -m "feat: refresh expanded tree nodes from SSE"`.

### Task 4: Add polling fallback

**Files:**
- Modify: `src/fs-events.ts` or create `src/live-polling.ts`
- Modify: `src/Panel.tsx`
- Create/modify: `test/live-polling.test.ts`

**Interfaces:**
- Produce `createDirectorySnapshot(entries)` from name/type/size/mtime data.
- Produce `hasSnapshotChanged(previous, next): boolean`.
- Poll only the current expanded directories every 5 seconds.

- [ ] **Step 1: Write failing tests** for stable snapshots, create/delete/rename/size changes, empty directories, polling cancellation, and no polling of closed directories.
- [ ] **Step 2: Run focused tests**; expected: FAIL.
- [ ] **Step 3: Implement polling fallback** that invokes the same targeted invalidation callback as SSE; stop polling after SSE successfully reconnects.
- [ ] **Step 4: Wire fallback** for initial EventSource error and repeated reconnect failure; expose a non-blocking status without disabling manual ↻.
- [ ] **Step 5: Run focused/full tests and build**; expected: PASS.
- [ ] **Step 6: Commit** with `git add src/fs-events.ts src/live-polling.ts src/Panel.tsx test && git commit -m "feat: add live refresh polling fallback"`.

### Task 5: Add preview confirmation UX and styles

**Files:**
- Modify: `src/Panel.tsx`
- Modify: `src/styles.ts`
- Modify/create: focused presentation tests.

**Interfaces:**
- Current preview change state contains file identity, dirty-on-disk boolean and dismiss state.
- Actions are `refreshChangedPreview()` and `dismissChangedPreview()`.

- [ ] **Step 1: Write failing pure presentation tests** for changed current file, unrelated file, refresh action, dismiss action, repeated events, deleted file, and preservation of Markdown source/rendered mode.
- [ ] **Step 2: Run focused tests**; expected: FAIL.
- [ ] **Step 3: On a matching change event**, show a `role="alert"`/status banner with «Файл изменён на диске», «Обновить», and «Оставить текущую версию»; do not call `fetchFile` until refresh is clicked.
- [ ] **Step 4: Implement refresh action** using current `hint` and `previewPath`; clear banner only after successful fetch, preserve current mode, and show existing preview error on failure.
- [ ] **Step 5: Implement dismiss action** that hides the banner until a later event for the file.
- [ ] **Step 6: Add DSH-token styles** for live status, banner, buttons and fallback state in both themes; preserve drag behavior by keeping button pointer-down excluded.
- [ ] **Step 7: Run focused/full tests and build**; expected: PASS.
- [ ] **Step 8: Commit** with `git add src/Panel.tsx src/styles.ts test && git commit -m "feat: confirm changed preview refresh"`.

### Task 6: Final verification and GUI smoke test

**Files:**
- No source changes expected; fix defects in the relevant task file with a separate commit if verification finds one.

- [ ] **Step 1: Run `npm test`; expected: all tests pass with 0 failures.
- [ ] **Step 2: Run `npm run build`; expected: host and client bundles build successfully.
- [ ] **Step 3: Run `git diff --check`; expected: no whitespace errors.
- [ ] **Step 4: Verify SSE endpoint** with a temporary workspace fixture: header required, valid expanded path accepted, traversal rejected, event payload emitted for file create/change, disconnect releases resources.
- [ ] **Step 5: Refresh existing `http://127.0.0.1:3080` only; do not start a replacement server. Verify tree updates for create/delete/rename in an expanded folder, closed-folder limitation, confirmation banner for current preview, explicit refresh/dismiss, reconnect and polling fallback if observable.
- [ ] **Step 6: Record browser-level limitations honestly if the environment cannot interact with the GUI.
- [ ] **Step 7: Commit each verification fix separately and rerun the covering tests.

## Execution Notes

Use the approved spec and updated canon as sources of truth. Do not introduce WebSocket, whole-workspace watchers, silent preview reload, file editing, or changes to existing root/list/read JSON contracts. If DSH `webServer` does not support long-lived SSE responses or if `fs.watch` cannot be safely scoped to requested directories, stop and report the concrete contract mismatch rather than weakening security or silently switching architecture.
