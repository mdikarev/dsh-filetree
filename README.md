# dsh-filetree

Workspace file tree panel for the DeepSeek Harness (DSH) Web GUI — a read-only file explorer with live refresh, git status, and a text/markdown preview.

[![CI](https://github.com/mdikarev/dsh-filemanager/actions/workflows/ci.yml/badge.svg)](https://github.com/mdikarev/dsh-filemanager/actions/workflows/ci.yml)

A toggle handle at the sidebar edge opens a 300 px panel showing the directory tree of the current session's workspace. Clicking a file opens a floating dock with its text content. File and folder rows can be dragged into the composer as @-mentions.

## Features

- **Tree panel**: lazy directory loading on expand, folders first then case-insensitive alphabet, dotfiles shown (`node_modules` and `.git` filtered), theme-aware styling via DSH tokens (auto dark/light).
- **Git status**: per-file and per-folder badges (modified / added / untracked / ignored) with folder summaries; ignored rows muted.
- **Live refresh**: the tree updates automatically via a fetch-based SSE stream with a polling fallback. A server heartbeat + client watchdog detect a stalled connection and degrade to polling with a status banner instead of freezing silently.
- **Performance**: the workspace git-status snapshot is cached server-side (TTL + event invalidation), so refresh bursts share a single `git status` run.
- **Preview dock**: draggable by its header, resizable, position/size remembered per workspace; text files up to 5 MB (truncation notice); Markdown renders with a Source/Preview toggle; syntax highlighting for common languages.
- **Composer integration**: drag files/folders from the tree into the composer to insert @-mention references.
- **Truncated names**: hovering a row whose name is clipped shows a themed tooltip with the full name (only when truncated).
- **i18n**: UI copy is localized — English by default, Russian auto-selected for ru-locale browsers (override: `fm-locale` in localStorage).
- **Accessibility**: tree semantics (roles/`aria-expanded`/`aria-level`), full keyboard navigation (arrows, Home/End, Enter/Space, ArrowLeft/Right on folders), the preview is a dialog and closes on Escape, visible focus styles.

## Scope

The panel is **read-only**: it browses and previews files and never mutates them. File operations (create/rename/delete/move) are intentionally out of scope.

## Server API

The plugin registers a `/filemanager-fs` prefix on the DSH host:

- `GET /filemanager-fs/root?hint=<workspace>` — workspace root
- `GET /filemanager-fs/list?hint=<workspace>&path=<rel>` — directory listing with git status
- `GET /filemanager-fs/read?hint=<workspace>&path=<rel>` — text file content (up to 5 MB; `truncated: true` when cut)
- `GET /filemanager-fs/events?hint=<workspace>&paths=<json>` — SSE stream of workspace changes (and `git-changed` events), with a heartbeat

All requests require the `x-dsh-filemanager: 1` header. Paths are contained to the workspace (realpath + escape checks, symlink-safe), and git is invoked read-only.

## Compatibility

- **Node** >= 20 (`engines`).
- **React 18** — provided by the DSH web host, not bundled (peer `^18.2.0`; verified against 18.3.1).
- **DSH**: built and tested against `@deepseek-ai/dsh@0.1.1-rc.2` (web profile). The plugin host and client APIs are pre-1.0 — pin the dsh version you deploy and re-test after dsh upgrades.
- **Trust model**: server endpoints are served by the dsh host on localhost and rely on the `x-dsh-filemanager` header plus the browser's same-origin/CORS behavior — treat the local dsh process as the trust boundary.

## Installation

### From npm (requires an npm registry release — currently tagged v0.2.0, publication may trail the git tag)

```bash
dsh plugin --profile web add dsh-filetree
```

### From a local checkout (development)

```bash
npm install
npm run build
dsh plugin --profile web add /path/to/dsh-filemanager-plugin
```

Then register the service in the profile patch (`~/.dsh/profiles/web/cordis.patch.yml`):

```yaml
- insert:
    - id: filemanager
      name: 'dsh-filetree'
```

Restart `dsh web` and refresh the browser.

## Development

```bash
npm run build      # esbuild: host (lib/index.js) + client bundle (lib/client.js)
npm test           # node:test + tsx
npm run typecheck  # tsc --noEmit
npm pack           # builds lib/ first (prepack) — inspect the publish tarball
```

CI (`.github/workflows/ci.yml`) runs typecheck, tests and the build on every push/PR.

## Documentation

- Behavioral source of truth lives in `docs/canon/` (doc-canon).
- The maturity roadmap and per-phase specs/plans live under `docs/superpowers/`.
- `CHANGELOG.md` follows Keep a Changelog; releases are tagged `vX.Y.Z` — see [RELEASING.md](RELEASING.md) for the release runbook.

## License

MIT — see [LICENSE](LICENSE).
