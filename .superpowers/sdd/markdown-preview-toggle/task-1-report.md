# Task 1 report — Markdown Preview Toggle

## Changes

- Added src/markdown-preview.ts with isMarkdownFile, renderMarkdown, and workspaceResourceUrl.
- Added test/markdown-preview.test.ts covering Markdown structures, escaping, dangerous links, external images, safe external-link attributes, and workspace boundaries.
- Added marked and dompurify dependencies using npm_config_cache=.npm-cache.
- Renderer disables raw HTML, uses DOMPurify in browser contexts, has conservative Node fallback sanitization, rejects dangerous URLs, routes relative images through the protected read endpoint, and rejects traversal segments.

## Commands and output

1. npm_config_cache=.npm-cache npm install marked dompurify — exit 0; added 3 packages; 0 vulnerabilities.
2. npm test -- --test-name-pattern=markdown — exit 0; 69 tests passed, 0 failed.
3. npm test — exit 0; 69 tests passed, 0 failed.
4. git diff --check — exit 0; no whitespace errors.

## Concerns

- Node tests have no DOM implementation, so the module uses a conservative fallback sanitizer there; browser execution calls DOMPurify. Browser-level DOMPurify integration is not included in Task 1.
- Relative resources reject any parent (..) path segment to avoid weakening the workspace boundary.
- No build or GUI verification was performed because this task is limited to the renderer and specified tests.

## Round 1 fixes

- Hardened the Node fallback sanitizer by decoding HTML numeric entities, ampersands, and named colon/tab/newline entities before protocol validation, covering entity-obfuscated javascript schemes.
- Added validation for absolute, Windows-drive, percent-decoded, and traversal-containing markdownPath values in workspaceResourceUrl.
- Made MarkdownRenderOptions and MarkdownRenderResult non-exported, leaving the three named functions as the public module surface.
- Added regression tests for encoded protocols, malformed URL attributes, and invalid markdown paths.

## Round 1 verification

- npm test -- --test-name-pattern=markdown — exit 0; 71 tests passed, 0 failed.
- npm test — exit 0; 71 tests passed, 0 failed.
- git diff --check — exit 0; no whitespace errors.

## Remaining limitation

- Browser DOMPurify branch remains untested because the repository has no DOM test implementation; it remains configured with an allowlist and dangerous-scheme policy.

## Round 2 fixes

- Reject decoded backslashes in markdownPath, including encoded Windows separators and encoded absolute paths, before constructing resource URLs.
- Validate numeric HTML entities before String.fromCodePoint, rejecting out-of-range and surrogate code points without throwing.
- Added regressions for encoded backslash traversal/absolute paths and malformed numeric entities.

## Round 2 verification

- npm test -- --test-name-pattern=markdown — exit 0; 71 tests passed, 0 failed.
- npm test — exit 0; 71 tests passed, 0 failed.
- git diff --check — exit 0; no whitespace errors.

