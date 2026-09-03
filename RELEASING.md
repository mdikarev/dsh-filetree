# Releasing

How to cut a release of `dsh-filemanager`. Follow this runbook top to bottom; it mirrors what was done for v0.2.0. Release notes are written in **English** and sourced from `CHANGELOG.md`.

## When to release

- A meaningful set of changes has accumulated under `## [Unreleased]` in `CHANGELOG.md`.
- `main` is green: `npm run typecheck && npm test && npm run build` pass locally and CI is green on GitHub.

## Versioning

- Follow [Semantic Versioning](https://semver.org). The package is pre-1.0: breaking plugin-host contract changes bump the minor (0.x → 0.(x+1).0); features and fixes bump the patch.
- The version lives in `package.json` (and `package-lock.json`). Keep `CHANGELOG.md` in sync (Keep a Changelog, `[Unreleased]` on top, then dated released sections).

## Process

1. **Update the changelog.** Move the accumulated `[Unreleased]` content into a new dated section, e.g. `## [0.3.0] - 2026-09-03`, and leave an empty `## [Unreleased]` on top. Write/keep the entries in English.
2. **Bump the version** (no git tag yet):

    ```bash
    npm version 0.3.0 --no-git-tag-version
    ```

3. **Run the full gate:**

    ```bash
    npm run typecheck && npm test && npm run build
    ```

4. **Verify the publish tarball** (the `prepack` script builds `lib/` first):

    ```bash
    npm pack --dry-run   # expect: LICENSE, README.md, lib/index.js, lib/client.js, package.json
    ```

5. **Commit and push:**

    ```bash
    git add CHANGELOG.md package.json package-lock.json README.md
    git commit -m "chore: release 0.3.0"
    git push origin main
    ```

6. **Tag and push the tag:**

    ```bash
    git tag -a v0.3.0 -m "dsh-filemanager 0.3.0"
    git push origin v0.3.0
    ```

7. **Create the GitHub Release** with English notes from the changelog section (paste the section body minus the heading, or use `gh`):

    ```bash
    # gh CLI variant (extracts the changelog section as the body):
    gh release create v0.3.0 --title "dsh-filemanager 0.3.0" --notes-file <(sed -n '/^## \[0.3.0\]/,/^## \[/p' CHANGELOG.md | tail -n +2)
    ```

8. **Publish to npm** (requires an npm token with publish scope; `npm login` refreshes `~/.npmrc`):

    ```bash
    npm whoami        # confirm the account
    npm publish       # runs prepack -> build first
    npm view dsh-filemanager version   # verify the release is live
    ```

9. **Smoke-test the registry install** (best on a scratch profile, not the working one):

    ```bash
    dsh plugin --profile web add dsh-filemanager
    grep dsh-filemanager ~/.dsh/profiles/web/package.json   # registry version, not link:
    ```

## Troubleshooting

- `npm publish` → 401/403: token is missing, expired, or lacks publish scope → generate a new token at npmjs.com settings and `npm login`.
- `npm publish` → 409 version exists: bump again (0.3.1) and redo steps 1-8.
- `403` name/ownership: the package name is taken or you lack permission — resolve ownership before releasing.
- GitHub Release missing after tag push: nothing is automated yet; create it manually (step 7) or install `gh`.

## Notes

- Automation (a CI workflow that runs the gate, creates the GitHub Release and publishes to npm on a `v*` tag) is a possible future step; it would need an `NPM_TOKEN` repository secret. Until then releases are manual per this runbook.
- Keep README's installation section in sync (e.g. remove the “publication may trail the git tag” caveat once a version is actually on npm).
