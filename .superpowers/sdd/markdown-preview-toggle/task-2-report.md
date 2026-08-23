# Task 2 report — workspace-scoped preview mode

## Implementation

- Added PreviewMode (source | rendered) to src/store.ts.
- Added previewMode to FileManagerState, defaulting to source.
- Added setPreviewMode(mode) to the store interface and implementation.
- Added workspace-scoped persistence under dsh-filemanager-preview-mode:<encodeURIComponent(hint)>.
- Invalid/missing values resolve to source; localStorage read/write errors are caught and cannot break preview state.
- setWorkspace loads the selected workspace mode, so an unset workspace resets to source while returning to a workspace restores its persisted mode.
- Added focused pure state tests in test/preview-mode.test.ts without jsdom.

## TDD / verification commands

1. RED: npm_config_cache=.npm-cache npm test -- test/preview-mode.test.ts
   - Expected failure observed: 4 preview-mode tests failed because previewMode was undefined and setPreviewMode did not exist.
2. GREEN: npm_config_cache=.npm-cache npm test -- test/preview-mode.test.ts
   - Result: 75 tests passed, 0 failed (the package script expands test/*.test.ts, so this also ran the existing suite).
3. Full suite: npm_config_cache=.npm-cache npm test
   - Result: 75 tests passed, 0 failed, 0 skipped.
4. Build and whitespace check: npm run build && git diff --check
   - Result: build completed (lib/index.js, lib/client.js); diff check passed.
5. Final verification: npm_config_cache=.npm-cache npm test && git diff --check
   - Result: 75 tests passed, 0 failed; diff check passed.

## Scope

Changed only src/store.ts, test/preview-mode.test.ts, and this report. No server API, renderer, or docs/canon files were changed.
