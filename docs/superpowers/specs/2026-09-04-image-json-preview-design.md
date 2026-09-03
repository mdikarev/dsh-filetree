# Image Preview (standalone + in-Markdown) & JSON Pretty View — Design

**Status:** draft (2026-09-04).
**Scope:** next release cycle after the 0.2.0 maturity roadmap (phases A/B/G done). (I1) preview of image files opened from the tree, plus rendering of workspace-local relative images inside the Markdown preview; (I2) JSON pretty view with a Raw/Pretty toggle. Absorbs the drafted future-plan `future_plans/p1-image-preview-support.md`.
**Spec for:** next implementation plan (docs/superpowers/plans/); canon updates listed at the bottom.

## Context / constraints discovered

- `GET /filemanager-fs/read` is JSON-text only. Binary files are rejected by the NUL-probe heuristic ("unsupported content type"), so clicking an image today shows an error in the dock.
- Quirk: `.svg` is not in the text-extension set but has no NUL bytes, so an SVG currently passes the content probe and opens as raw XML text. This cycle gives SVG a real image path instead.
- Every API request requires the `x-dsh-filemanager: 1` header. A plain `<img src>` cannot send headers, so a "direct URL" is impossible without weakening auth; data URLs (p1 open question) add ~33% memory and no streaming.
- The Markdown pipeline already strips **all** `<img>` tags: external ones are counted (`blockedExternalImages`), workspace-local ones are counted (`unavailableLocalImages`) and removed too — even though `workspaceResourceUrl()` (safe md-relative resource resolution → read URL) already exists.
- The preview dock already has: header/title/close, per-workspace position+size memory, a changed-on-disk confirmation banner keyed by preview path, Source/Preview mode for `.md` (mode stored per workspace), a highlighted-source presentation for hljs output, en/ru l10n (`src/l10n.ts`), and L1 a11y (dialog, Escape, focus-visible).
- The hljs language set used by the text viewer does not include `json` today (verify at implementation; register if absent).

## Decisions (agreed, from the 2026-09-04 brainstorm)

- **D1 (scope):** standalone image files (click in tree → dock) **and** workspace-local relative images inside Markdown. One binary endpoint serves both.
- **D2 (transport):** capability URLs — a new header-gated `/cap` endpoint mints a random per-workspace token; a new `/raw` endpoint serves image bytes to requests carrying a valid, unexpired token in the query string (chosen over: plain public URLs — would drop the header gate; blob URLs — per-image async fetch + blob lifecycle is painful for Markdown's many images; data URLs — memory overhead).
- **D3 (formats / limits):** raster png/jpeg/gif/webp/avif detected by magic bytes (extension as fallback); SVG allowed only when content looks like an SVG/XML document and is served with `content-security-policy: sandbox`. Server byte caps: raster ≤ 20 MB, SVG ≤ 2 MB. Anything else → 415.
- **D4 (standalone UX):** images open **in the existing dock** (position/size memory reused), fit-to-panel by default with zoom controls (buttons + Ctrl+wheel, clamped; plain wheel scrolls the panel), double-click toggles 100%/fit, "open original in new tab" action. Backdrop is theme-token neutral/checkered. Load failure or unsupported format → localized message in the dock. Very large decoded dimensions → warning banner (decode guard after load).
- **D5 (Markdown images):** safe workspace-local relative images render inline via the raw URL; the external-image block policy is unchanged; `unavailableLocalImages` accounting is removed (replaced by a container-level load-error handler that hides only failed workspace images).
- **D6 (JSON):** `.json` only (no `.jsonc`/YAML this cycle). Raw/Pretty toggle mirrors the Markdown Source/Preview pattern; Pretty is the default for valid JSON whose content is < ~1 MB: parse → `JSON.stringify(2)` → hljs-`json` highlight (existing highlighted-source presentation reused). Invalid JSON or content over the pretty cap → Raw with a subtle note. No collapsing, no key sorting (YAGNI).
- **D7 (invariants):** read-only is preserved (`/raw` only reads; git untouched); the changed-on-disk banner applies to every preview kind via the existing path-keyed machinery; mutations, thumbnails, image editing and tree-row image previews stay out of scope.

## Design

### 1. Server — capability + raw image endpoint (src/fs-api.ts, new src/capabilities.ts)

- `GET /filemanager-fs/cap?hint=` (header-gated, JSON): returns a 256-bit random token for the hint. Server keeps `Map<hint, { token, expiresAt }>`, TTL ~8 h, rotated whenever a new one is issued (client re-issues per workspace switch / panel open). Validation is constant-time. `/list`, `/read`, `/events` stay header-gated — nothing is weakened; a cross-origin page cannot enumerate paths (list is header-gated) and cannot guess the token.
- `GET /filemanager-fs/raw?hint=&path=&cap=`: same containment as `/read` (realpath + isInside, symlink-safe); validates the cap for that hint; sniffs type from the first bytes (png/jpeg/gif/webp/avif; svg via leading `<svg`/`<?xml`); streams the file with `fs.createReadStream` and headers:
  - `content-type` (image/*), `cache-control: no-store`, `x-content-type-options: nosniff`; for SVG also `content-security-policy: sandbox` so an SVG opened top-level in a new tab cannot run scripts in the DSH web origin.
  - Errors as JSON bodies like the existing `send()`: 403 (bad/expired cap), 404 (outside workspace / missing), 415 (not an image), 413 (over byte cap).
- No change to `/read`: existing text behaviour and responses stay byte-identical.

### 2. Client — preview kind dispatch (src/Panel.tsx)

- The click handler decides the kind by extension **before** calling `/read`: image extension set → image viewer; `.md` → Markdown (unchanged); `.json` → JSON viewer; anything else → the existing text path (its "unsupported content type" error remains for binary non-images).
- The dock chrome (header, close, changed-on-disk banner, error area) stays shared; only the body and an optional toolbar differ per kind. Markdown/JSON modes keep the per-workspace persistence pattern already used by `previewMode`.

### 3. Image viewer (new src/image-view.ts — pure zoom logic; new ImageView component)

- `rawResourceUrl(hint, path, cap)` builds `/filemanager-fs/raw?...` for a workspace-root-relative path (distinct from the md-relative builder in §4).
- State: `{ scale, fit }`; `fit` = CSS contain; zoom clamped ~0.1–8×; buttons and Ctrl+wheel zoom (plain wheel scrolls), double-click toggles 100%/fit; "open original" opens the raw URL in a new tab. Toolbar buttons carry localized `aria-label`s and are keyboard-reachable.
- After load, dimensions (`naturalWidth × naturalHeight`) are shown in the header; a decoded-area guard shows a warning for extremely large images. Byte weight is **not** shown (the list API does not carry file sizes) — no new list payload this cycle.

### 4. Markdown local images (src/markdown-preview.ts)

- `renderMarkdown` gains a `resourceUrl(resource)` parameter (the caller — Panel — provides a builder bound to the current hint and an already-fetched cap). All md-relative containment checks of the current `workspaceResourceUrl()` are preserved; the produced `src` points at `/filemanager-fs/raw?...` with the cap.
- The `<img>` rewriter keeps `alt`/`title`, drops external and unsafe images as today (`blockedExternalImages` stays), and emits local images. Failed workspace images are hidden by a container-level React error handler (dataset-flagged), so no inline event attributes and no sanitizer-config change.
- `unavailableLocalImages` is removed from the API/UI; the existing Markdown local-images warning string is replaced by the new load-failure behaviour. Sanitizer allowed-tags/attrs stay as-is; verify with tests that an absolute path `/filemanager-fs/raw?...` (no scheme) passes `DOMPurify`.
- The cap is fetched lazily, once per hint, and memoised client-side (new src/caps.ts + `fetchCap` in preview-api); a 403 on an image triggers exactly one re-fetch, then surfaces the localized error.

### 5. JSON viewer (json-view.ts — pure parse/format/decide; Panel integration)

- `isJsonFile(name)` = `.json` case-insensitive. Toggle Raw/Pretty (localized, `aria-pressed`), Pretty default when parse succeeds and source length < ~1 MB; persisted per workspace like `previewMode`.
- Pretty path: `JSON.parse` → `JSON.stringify(v, null, 2)` → hljs highlight → existing highlighted-source presentation.
- Invalid JSON → Raw content plus a one-line parse note; over-cap valid JSON → Raw plus "too large to format" note. Toggle stays visible for every `.json`.

### 6. l10n & a11y

- New en/ru keys: zoom in/out/100%/fit/open-original, raw/pretty labels, "image failed to load", "image too large to display", "JSON too large to format", JSON parse note, dimension title. Types are enforced by the existing typed l10n module.
- A11y L1 holds: buttons are real buttons with labels; Esc still closes the dock; focus-visible applies to the new toolbar.

### 7. Live refresh & edge cases

- The changed-on-disk banner (existing path-keyed logic) covers all kinds: image → reload `src`; JSON → re-pretty; Markdown → re-render. `no-store` avoids stale-image caching.
- Workspace switch (setHint): a fresh cap is fetched per new hint; stale raw URLs 403 and the dock shows the localized message (Markdown re-renders on hint change as today, clearing old `<img>` srcs).
- A file whose kind changes while open (extension unchanged, content no longer decodable) degrades to the dock error presentation — no crash, no silent stale content.

### 8. Testing (node:test + tsx, per repo pattern)

- **fs-api:** /raw — magic-byte→type mapping, svg detection, nosniff + CSP-sandbox headers, byte caps (413), containment (404), 403 for missing/expired/rotated cap, cap endpoint issues + rotates + is header-gated; /read regression untouched.
- **markdown-preview:** md-relative raw-URL builder with cap (path checks identical to today), external still blocked, alt/title preserved, sanitizer passes the generated src.
- **json:** detection, pretty/raw decision matrix (valid/under cap, invalid, over cap), formatting output.
- **image:** pure zoom reducer (clamping, 100%/fit toggle); raw-URL builder.
- typecheck, build and CI stay green.

## Security notes

| Threat | Mitigation |
| --- | --- |
| Cross-origin page hot-links localhost images | `/raw` requires unguessable per-hint cap; `/list`/`/read` remain header-gated so paths cannot be enumerated |
| SVG with scripts opened top-level in a new tab | `content-security-policy: sandbox` on SVG responses |
| MIME confusion | magic-byte sniffing + `x-content-type-options: nosniff` |
| Path escape | realpath + isInside containment reused from `/read` |
| Stale/caching leaks | `cache-control: no-store`; token TTL + rotation |

## Out of scope (parked / later cycles)

- `.jsonc`/`.json5`/YAML pretty; collapsible JSON tree; key sorting
- Image editing/annotations; thumbnails in tree rows; EXIF; animated-GIF playback control; download action (open-in-tab only); multi-image paging in the dock
- File mutations and any write path (unchanged: parked in the maturity roadmap)
- Tree search/filter, diff preview and "Changes" tab (roadmap parked — independent future cycle)

## Canon updates (after user go-ahead, via canon-write)

- `OVERVIEW.md`: Scope in/out + Success signals for image preview, Markdown local images, JSON pretty view.
- `ARCHITECTURE.md`: Public interfaces (`/cap`, `/raw`), key flows (image preview; Markdown images; JSON pretty), failure modes (403/415/413 handling client-side).
- `GLOSSARY.md`: capability token, preview kind.
- `future_plans/INDEX.md`: p1 → absorbed (pattern of p2/p3); add nothing new.
- Maturity roadmap doc: add the post-0.2.0 cycle row with this spec/plan.
