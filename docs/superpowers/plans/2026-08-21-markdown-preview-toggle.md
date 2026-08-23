# Markdown Preview Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить безопасный клиентский Markdown preview с переключателем source/rendered, workspace-scoped режимом и сохранением текущего текстового просмотра.

**Architecture:** `Panel` продолжает загружать исходный текст через существующий `/filemanager-fs/read` и добавляет режим preview только для `.md`. Новый чистый модуль на базе `marked` + `dompurify` преобразует Markdown в безопасный HTML; URL-политика разрешает только workspace-relative ресурсы через защищённый read-контур, внешние изображения блокирует.

**Tech Stack:** TypeScript, React 18, `marked`, `dompurify`, Node test runner, `tsx`, существующий `highlight.js`, DSH CSS tokens.

**Spec:** `docs/superpowers/specs/2026-08-21-markdown-preview-toggle-design.md`

## Global Constraints

- Не менять контракт `/filemanager-fs/read` и `ReadResponse`.
- Режим по умолчанию — `source`; режим хранится отдельно для каждого workspace в localStorage.
- Переключатель показывается только для `.md` без учёта регистра.
- Никогда не вставлять необработанный Markdown; HTML санитизируется, `javascript:`/`data:` и другие опасные схемы запрещаются.
- Внешние изображения блокируются; внешние текстовые ссылки открываются в новой вкладке.
- Усечённый контент >5 МБ рендерится частично с предупреждением.
- Изменения должны сохранять текущий drag/resize/layout и существующее поведение не-Markdown файлов.
- Перед реализацией создать изолированный worktree через `using-git-worktrees`; применять TDD и коммитить каждую законченную задачу.

## File Map

- Create: `src/markdown-preview.ts` — распознавание Markdown, URL policy, Markdown-to-safe-HTML renderer.
- Create: `test/markdown-preview.test.ts` — чистые тесты renderer-а и URL policy.
- Modify: `src/Panel.tsx` — preview mode, localStorage keying, toggle and rendered state.
- Modify: `src/styles.ts` — toggle, rendered Markdown and truncated notice styles.
- Modify: `test/preview-layout.test.ts` or a new focused state test — workspace mode persistence.
- Modify: `package.json`, `package-lock.json` — `marked` and `dompurify` dependencies.

### Task 1: Add Markdown renderer and security policy

**Files:**
- Create: `src/markdown-preview.ts`
- Create: `test/markdown-preview.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces `isMarkdownFile(name: string): boolean`.
- Produces `renderMarkdown(source: string, options: { filePath: string; workspaceHint: string }): { html: string; blockedExternalImages: number }`.
- Produces `workspaceResourceUrl(hint: string, markdownPath: string, resource: string): string | null`.

- [ ] **Step 1: Write failing tests** for case-insensitive `.md`, headings/lists/tables/fenced code, escaped raw HTML, blocked `javascript:` links, external image removal, external link `target="_blank"` plus `rel="noreferrer noopener"`, and relative resource URL construction.
- [ ] **Step 2: Run the focused test** with `npm test -- --test-name-pattern="markdown"`; expected: FAIL because the module and functions do not exist.
- [ ] **Step 3: Add dependencies** using `npm install marked dompurify`; keep React and highlight.js versions unchanged.
- [ ] **Step 4: Implement the pure module** using `marked` to parse Markdown and `dompurify` to sanitize the result. Configure sanitizer hooks or post-processing so only safe anchors/images remain; remove external image `src`, reject unsafe schemes, and resolve relative resources as `/filemanager-fs/read?hint=...&path=...` only when the normalized resource remains inside the Markdown file’s workspace-relative path.
- [ ] **Step 5: Run focused tests** with `npm test -- --test-name-pattern="markdown"`; expected: PASS.
- [ ] **Step 6: Commit** with `git add src/markdown-preview.ts test/markdown-preview.test.ts package.json package-lock.json && git commit -m "feat: add safe markdown renderer"`.

### Task 2: Add workspace-scoped preview mode state

**Files:**
- Modify: `src/Panel.tsx`
- Create or modify: `test/preview-mode.test.ts`

**Interfaces:**
- `Panel` owns `previewMode: "source" | "rendered"` and updates it through a workspace-keyed storage helper.
- Storage key format is `dsh-filemanager-preview-mode:${encodeURIComponent(hint)}`. Invalid or missing values resolve to `source`.

- [ ] **Step 1: Write failing tests** for default source mode, independent modes for `/ws/a` and `/ws/b`, persistence after recreating state, and reset to source when stored data is invalid.
- [ ] **Step 2: Run the focused test** with `npm test -- --test-name-pattern="preview mode"`; expected: FAIL.
- [ ] **Step 3: Implement small storage helpers** in `Panel.tsx` or a focused module, using guarded `localStorage` access so unavailable storage never breaks preview. Initialize mode from the current `hint`, write only `source` or `rendered`, and reset to source when the workspace changes.
- [ ] **Step 4: Run the focused test**; expected: PASS.
- [ ] **Step 5: Commit** with `git add src/Panel.tsx test/preview-mode.test.ts && git commit -m "feat: persist markdown preview mode per workspace"`.

### Task 3: Integrate the toggle and rendered view

**Files:**
- Modify: `src/Panel.tsx`
- Modify: `src/styles.ts`

**Interfaces:**
- Use `isMarkdownFile(previewTitle)` to conditionally render the toggle.
- Use `renderMarkdown(previewContent, { filePath: previewPath, workspaceHint: hint })` only when mode is `rendered`.
- Preserve source fallback whenever renderer output is unavailable or throws.

- [ ] **Step 1: Add failing integration-oriented assertions** to the existing UI logic test strategy for `.md` toggle visibility, non-Markdown absence, mode switch persistence, and truncated notice in rendered mode.
- [ ] **Step 2: Run the focused tests**; expected: FAIL until the Panel state and elements are connected.
- [ ] **Step 3: Extend `Panel` state** with `previewPath` and `previewMode`; set path during `handleOpenFile`, load stored mode for the active workspace, and keep mode state stable while switching source/rendered.
- [ ] **Step 4: Add accessible buttons** in `.fm-preview-header` with clear labels/titles «Исходник» and «Предпросмотр», pressed state, and no toggle for non-Markdown files. Render sanitized HTML only in rendered mode; keep existing highlight/plain `<pre>` path for source mode.
- [ ] **Step 5: Add the truncated warning** in both modes when `previewTruncated` is true, without treating it as a read or render error.
- [ ] **Step 6: Add CSS** for the two-state toggle, rendered Markdown typography, code blocks, links, images, and warning using existing DSH theme variables; preserve panel resize, drag, overflow, and dark theme behavior.
- [ ] **Step 7: Run focused tests**; expected: PASS.
- [ ] **Step 8: Commit** with `git add src/Panel.tsx src/styles.ts test/* && git commit -m "feat: add markdown preview toggle"`.

### Task 4: Verify full behavior and build artifacts

**Files:**
- No source changes expected; only fix failures in the files above if verification exposes a defect.

- [ ] **Step 1: Run the complete test suite** with `npm test`; expected: all existing fs API, highlighting, layout and new Markdown tests pass.
- [ ] **Step 2: Run the production build** with `npm run build`; expected: host and client bundles build successfully with Markdown dependencies included.
- [ ] **Step 3: Inspect `git diff --check`**; expected: no whitespace errors.
- [ ] **Step 4: Refresh the existing GUI at `http://127.0.0.1:3080` and manually verify a README.md: toggle visibility, source/rendered switch, headings/lists/code/tables, blocked external image, workspace-relative image behavior, external link opening, truncated warning, light/dark themes, and unchanged non-Markdown preview.
- [ ] **Step 5: Commit any verification-only fix separately** with a message describing the observed defect and its test.

## Execution Notes

Use the approved spec and updated canon as the source of truth. Do not add editing, server-side Markdown rendering, full-file fetches, external image proxying, or unrelated file operations. If workspace-relative images cannot be safely represented by the existing read endpoint without changing its contract, stop and report the contract mismatch instead of weakening the boundary.
