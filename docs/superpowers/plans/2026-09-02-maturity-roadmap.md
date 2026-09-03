# dsh-filemanager Maturity Roadmap

> Lightweight tracking doc for the agreed maturity phases (hybrid workflow:
> this file holds the phase list + status; per-phase designs live in chat,
> architectural phases (A, B) get their own spec documents when started).

**Status:** active — agreed 2026-09-02 (brainstorming session).
**Goal balance:** public npm plugin for other DSH users + reliable daily tool (equal weight).
**Scope boundary (first public release):** read-only explorer (tree + preview + drag-to-composer). File mutations (create/rename/delete/move) are deliberately out of scope for this roadmap — separate future phase requiring its own security design.

## Agreed priorities (in order)

| # | Phase | Why | Dependencies | Status |
|---|-------|-----|--------------|--------|
| 1 | **H-lite** — release hygiene | LICENSE, npm metadata, `typecheck` script (+ typescript devDep), `prepack: build`, CI (test + typecheck + build), CHANGELOG | none | ☑ (commit `3fd8e21`) |
| 2 | **E-lite** — dsh compat declaration | verify against current dsh rc; README "tested with" line; full version-matrix smoke moves behind CI (later) | H-lite (CI) | ☑ (commit `a8ba424`) |
| 3 | **A** — performance on large repos | git-status snapshot cache (TTL + event invalidation), per-handler instance; watchers stay per-dir (W1) | spec drafted — `docs/superpowers/specs/2026-09-02-git-status-cache-design.md` | ☑ done - 2026-09-02, plan `docs/superpowers/plans/2026-09-02-git-status-cache.md` |
| 4 | **B** — live-refresh resilience | watchdog for stalled SSE (server heartbeat + client inactivity) and setHint/poller correctness in Panel | spec drafted — `docs/superpowers/specs/2026-09-02-live-refresh-watchdog-design.md` | ☑ done - 2026-09-02, plan `docs/superpowers/plans/2026-09-02-live-refresh-watchdog.md` |
| 5 | **G** — i18n + basic a11y | plugin-local en/ru i18n (EN default, RU preserved) + L1 a11y (tree semantics/keyboard, preview dialog/Esc, toggle button, focus styles) | spec drafted — `docs/superpowers/specs/2026-09-03-i18n-a11y-design.md` | ☑ done - 2026-09-03, plan `docs/superpowers/plans/2026-09-03-i18n-a11y.md` |
| 6 | Release **0.2.0** | tags + GitHub Release + npm publish after A/B land and CI is green | 1–5 | ☑ done — published as `dsh-filetree@0.2.0`, GitHub Release v0.2.0 created |

## Phase sketches (details per phase in chat)

**1. H-lite (bounded).** Add `LICENSE` (MIT, matches package.json), `repository`/`homepage`/`bugs` in package.json, `typescript` devDependency + `typecheck` script (`tsc --noEmit`, current tsconfig scope), `prepack: npm run build` so `npm pack`/`npm publish` can never ship a stale `lib/`, `.github/workflows/ci.yml` running test + typecheck + build, `CHANGELOG.md` with the 0.1.0 history.

**2. E-lite (bounded).** Verify against the installed dsh (`@deepseek-ai/dsh@0.1.1-rc.2`, React 18.3.1); add a "Compatibility" README section. Full smoke matrix across dsh versions is deferred until CI exists.

**3. A (architectural — own spec at start).** Server: cache of `git status --ignored` results keyed by root, invalidated by git-changed/fs events (debounced); today every `list` of any folder spawns a full git status from the workspace root. Watch strategy: currently each expanded folder registers its own watcher (`fs-events.ts`) — plan a single recursive root watcher with client-side filtering to avoid OS watcher limits and event storms. Keep the existing strict read-only guarantees (`GIT_OPTIONAL_LOCKS=0`, realpath/isInside containment, header auth).

**4. B (architectural-ish — own plan at start).** Hardening of the live-refresh coordinator: workspace-switch races (stale events of an old workspace must never refresh the new tree), reconnect backoff for the fetch-based SSE, no double subscriptions, and unit-level transition coverage extending `live-coordinator.test.ts`.

**5. G (bounded-to-medium).** Strings extracted behind a small locale module: English default, Russian retained; follow DSH client-locale if its API fits (verify at phase start). Basic a11y: proper roles for the tree rows (`aria-expanded`, tree semantics), keyboard arrows/Enter, Esc closes preview, visible focus styles — stays compatible with the existing mouse+drag UX.

**6. Release 0.2.0.** Tag `v0.2.0`, GitHub Release notes from CHANGELOG, `npm publish` after `npm login` (current token is expired).

## Global constraints to keep across phases

- Tests: `npm test` (node:test + tsx) must stay green; typecheck must pass (no regressions).
- CSS only via DSH theme tokens; dark theme via `body[data-ds-dark-theme]`.
- Security: `x-dsh-filemanager: 1` on all API requests; realpath + isInside containment; read-only git (`GIT_OPTIONAL_LOCKS=0`).
- UI language: first public release stays bilingual-ready (EN default + RU); docs in repo currently Russian-heavy — roadmap doesn't mandate canon rewrites.

## Out of scope (parked)

- File mutations; editor tabs; tree search/filter; "open in OS file manager".
- Observability/UX error banner (audit item D) — candidate for the phase after this roadmap lands.
