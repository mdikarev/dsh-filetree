# Discrepancies

## How to use
<!-- Explain how discrepancies are recorded and resolved. -->

## Open
<!-- Keep unresolved discrepancy entries here. -->

## Resolved

### D-001: Canon (ARCHITECTURE/OVERVIEW/GLOSSARY) predates phases A/B/G, tooltip and the dsh-filetree rename
- **status:** resolved
- **decision:** docs_stale
- **canon_paths:** docs/canon/ARCHITECTURE.md, docs/canon/OVERVIEW.md, docs/canon/GLOSSARY.md
- **code_paths:** src/git-status-cache.ts, src/l10n.ts, src/use-l10n.ts, src/tree-nav.ts, src/tooltip.ts, src/fs-events.ts, src/live-refresh.ts, src/Panel.tsx, src/store.ts, src/fs-api.ts, src/Tree.tsx, src/ToggleTab.tsx
- **evidence:** Canon was refreshed via canon-write (2026-09-04): added the git-status snapshot cache (module, per-handler createHandler options, list via gitCache.get, fs-events invalidation), SSE heartbeat event:ping + client inactivity watchdog + single-coordinator/setHint lifecycle and store.setWorkspace expanded notification, i18n (l10n en/ru), L1 accessibility and the full-name hover tooltip; the module inventory, UI copy and constants were updated in ARCHITECTURE.md, OVERVIEW.md and GLOSSARY.md. doc-canon validate --json passes with 0 errors.
- **finding_ids:** F-001, F-002, F-003
- **coding_agent_prompt:** |
  Not applicable (docs_stale resolved via canon-write).

<!-- Move resolved discrepancy entries here. -->

## Template for new entries
<!--
  ### D-001: <short title>
- **status:** open | resolved
- **decision:** pending | docs_stale | code_stale
- **canon_paths:** ...
- **code_paths:** ...
- **evidence:** ...
- **finding_ids:** ...
- **coding_agent_prompt:** |
  What to study; what diverges; questions to clarify with the user.
-->
