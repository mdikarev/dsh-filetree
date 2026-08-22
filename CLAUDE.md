<!-- doc-canon:start -->
# doc-canon context rule

For design and development, the context source of truth is `docs/canon/`. Try `doc-canon search "<topic>"` first; on fail-closed fall back to `docs/canon/INDEX.md`, select only relevant indexed sections, and build a small **working set** before deep reads. If the working set is doubtful, **expand**; do not silently under-read or invent structure to save tokens. Do not preload the entire canon.

## Search-first is mandatory

For design and development, `doc-canon search "<topic>"` (and `doc-canon code-index search` for covered languages) is **mandatory before deep reads when an index exists or can be built** — `doc-canon search` self-heals a stale index, and a missing index fails closed with a build hint; run `doc-canon index` / `doc-canon code-index build`, then retry. Only if building fails, fall back to INDEX-first / source-first and note each read outside a pack: `doc_miss: <query> -> docs:<path>` or `code_miss: <query> -> source:<path>`. The expand valve is unchanged: a thin probe licenses targeted reads as evidence with a miss note — never silent under-reading, never silent skipping.

`docs/canon/future_plans/` is part of the canon for **future system shape** (initiatives). It is not the behavioral source of truth for current behavior. Do not store development tasks, checklists, or coding-agent prompts there; use roadmap/issues/`DISCREPANCIES.md` for execution work. After an initiative is realized, absorb outcomes into living canon sections.

## Feature-change order (canon-first)

For **new or changed functionality** (behavior / public contract), do **not** start application code first. Order:

1. Update living canon via **`canon-write`** (invoke the skill, or stop and ask the user to run it). Coding agents must not edit `docs/canon/**` themselves.
2. Optionally write or sync a **project-local** design/plan artifact when the change is large (multi-module, non-obvious design, or handoff). Do not assume a fixed path such as `docs/superpowers/specs/`.
3. After a **substantial** canon change, wait for explicit user go-ahead before coding. After a spot section sync, you may proceed.
4. Implement application code against the updated canon (and optional plan).
5. Close with **`canon-audit`** on the affected topic (spot `canon-write` does not guarantee sibling-section sync; the closing audit catches that and docs↔code drift).

**Exceptions** (skip canon-first, including the closing audit): pure bugfix with intended behavior unchanged; `code_stale` (canon already correct); non-behavioral edits (typos, tests, refactor without contract change).

Post-hoc sync (`canon-write` / `check` / `canon-audit` after drift) remains valid and does not replace this order for intentional feature work. Coding agents follow working-set discipline without a mandatory chat ritual of listing the set every turn.

## Code analysis order

For code analysis in a covered language (TypeScript/JavaScript, Go, C#, Rust, Python), run `doc-canon code-index search <symbol> --root <repo>` before reading whole source files — mandatory when the index is available. Use the bounded snippet windows as the first probe. When the probe returns nothing or a thin set — or the code index is missing (see CLI warnings) — read the source files as evidence and note the miss (`code_miss: <query> -> source:<path>`). A stale code index is served with a warning; keep using the pack and expand when thin. Quality over thrift: never let a thin probe license under-reading. Languages outside the covered set go straight to source. `canon-bootstrap` and `canon-audit` build the indexes first (`doc-canon index`, `doc-canon code-index build` when covered source exists) and prefer index search for their goals when the indexes exist.

On docs↔code divergence, do not silently pick a side. Present the evidence and escalate through the canon skills and `docs/canon/DISCREPANCIES.md`. Canon skills never modify application code.

This rule sets context priority; it does not replace other domain rules in the repository.
<!-- doc-canon:end -->
