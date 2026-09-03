# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Workspace file tree panel with toggle tab at the sidebar edge
- Lazy directory loading on expand; git status badges for files and folders
- File preview dock (drag header to move, resizable): text up to 5 MB,
  Markdown render with source/rendered toggle, syntax highlighting
- Live tree refresh: SSE streaming with polling fallback
- Drag files/folders from the tree into the composer as @-mentions
- Full-name tooltip on hover for truncated tree rows
- CI workflow (typecheck + tests + build), MIT license, CHANGELOG

### Changed

- Live refresh detects a stalled SSE connection (server heartbeat +
  client inactivity watchdog) and degrades to polling with a banner
- Panel keeps one live-refresh coordinator per open panel and switches
  workspaces via setHint, so polling always targets the current workspace
- Server caches the workspace git-status snapshot (TTL + event
  invalidation); bursts of refresh listings now share a single git run
- Typecheck now runs in CI (7 latent type errors fixed); `npm pack` always
  builds `lib/` first via the prepack script
- UI is localized: English default with Russian preserved (auto-selected
  for ru-locale browsers; override via fm-locale)
- Basic accessibility: tree semantics + keyboard navigation (arrows,
  Home/End, Enter/Space, ArrowLeft/Right on folders), preview dialog
  closes on Escape, toggle handle is a button, focus-visible styles

### Security

- Path containment (realpath + isInside) and symlink-escape rejection;
  read-only git status (`GIT_OPTIONAL_LOCKS=0`); layered markdown sanitizing
