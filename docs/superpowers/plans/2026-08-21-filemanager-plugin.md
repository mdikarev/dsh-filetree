# dsh-filemanager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a DSH plugin that adds a workspace file tree panel accessible via a toggle tab at the sidebar edge.

**Architecture:** Two-halves plugin pattern — host side registers HTTP API routes (`/filemanager-fs`) via webServer service; client side registers two React components into `shell.overlay` slot (toggle tab + panel). State persistence via slot store, lazy directory loading, ResizeObserver for sidebar tracking.

**Tech Stack:** TypeScript, esbuild (host ESM + client browser bundle with ModuleLoader wrapper), React 18 (peer), node:test + tsx for testing.

**Spec:** `docs/superpowers/specs/2026-08-21-filemanager-plugin-design.md`

## Global Constraints

- Node.js ≥20
- React 18.x peer dependency (not bundled)
- CSS: only DSH theme tokens (`var(--dsw-...)`)
- Hidden directories: `node_modules`, `.git` filtered server-side; dotfiles shown
- Max directory entries: 2000 (truncated with flag)
- Security header: `x-dsh-filemanager: 1` required on all API requests
- Containment: realpath + isInside check, symlinks outside root return 403

---

## File Structure

```
dsh-filemanager-plugin/
├── package.json         # Plugin manifest with dsh.client config
├── tsconfig.json        # TypeScript config (erasable syntax)
├── build.mjs            # esbuild: host→node-esm, client→browser with ModuleLoader wrapper
├── src/
│   ├── index.ts         # Host apply(): webServer route registration
│   ├── fs-api.ts        # Pure HTTP handler (root/list) — tested without cordis
│   ├── client.tsx       # Client apply(): 2 × ctx.slots.register
│   ├── ToggleTab.tsx    # Toggle button component + ResizeObserver
│   ├── Panel.tsx        # Panel shell: header + tree container
│   ├── Tree.tsx         # Recursive tree nodes, lazy loading
│   ├── store.ts         # defineStore { open } + persist; toggle/close actions
│   ├── api.ts           # Client fetch wrapper (header, error handling, URL builder)
│   └── styles.ts        # CSS string using --dsw-* tokens
├── test/
│   ├── fs-api.test.ts   # Host API tests with temp fixtures
│   └── client-logic.test.ts # Pure client logic (sorting, URL building)
└── docs/superpowers/specs/2026-08-21-filemanager-plugin-design.md
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `build.mjs`

**Interfaces:**
- Consumes: nothing
- Produces: Working build system; `npm run build` compiles `src/` to `lib/`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "dsh-filemanager",
  "version": "0.1.0",
  "description": "Workspace file tree panel for DeepSeek Harness Web GUI",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": {
      "default": "./lib/index.js"
    },
    "./client": {
      "default": "./lib/client.js"
    },
    "./package.json": "./package.json"
  },
  "files": ["lib", "README.md"],
  "dsh": {
    "client": {
      "platform": "web",
      "immediately": true,
      "inject": [
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-slots",
        "@deepseek-ai/dsh-client-ui-theme"
      ]
    }
  },
  "scripts": {
    "build": "node build.mjs",
    "test": "tsx --test test/*.test.ts"
  },
  "peerDependencies": {
    "react": "^18.2.0"
  },
  "devDependencies": {
    "esbuild": "^0.25.0",
    "tsx": "^4.19.0",
    "@types/node": "^22.0.0",
    "@types/react": "^18.3.0"
  },
  "engines": {
    "node": ">=20"
  },
  "license": "MIT",
  "keywords": ["deepseek-harness", "dsh", "plugin", "file-tree", "workspace"]
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": false,
    "jsx": "react-jsx",
    "outDir": "lib",
    "rootDir": "src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "lib", "test"]
}
```

- [ ] **Step 3: Create build.mjs**

```javascript
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

// Host build: Node ESM
await build({
  entryPoints: ["src/index.ts"],
  outfile: "lib/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  external: Object.keys(pkg.peerDependencies ?? {}),
});

// Client build: Browser bundle wrapped for DSH ModuleLoader
const clientResult = await build({
  entryPoints: ["src/client.tsx"],
  bundle: true,
  platform: "browser",
  format: "cjs",
  target: "es2020",
  jsx: "automatic",
  external: ["react", "react/jsx-runtime"],
  write: false,
});

const clientCode = clientResult.outputFiles[0].text;
const wrappedClient = `window.__ModuleLoader__.load({
  id: "dsh-filemanager",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${clientCode}
    return module.exports;
  }
});`;

await import("node:fs/promises").then((fs) =>
  fs.writeFile("lib/client.js", wrappedClient)
);

console.log("Build complete: lib/index.js, lib/client.js");
```

- [ ] **Step 4: Create src directories and placeholder files**

```bash
mkdir -p src test
touch src/index.ts src/client.tsx
```

Add minimal placeholder to src/index.ts:
```typescript
// Host entry - will be implemented in Task 3
export function apply() {}
```

Add minimal placeholder to src/client.tsx:
```typescript
// Client entry - will be implemented in Task 6
export function apply() {}
```

- [ ] **Step 5: Install dependencies and verify build**

```bash
npm install
npm run build
```

Expected: `lib/index.js` and `lib/client.js` created without errors.

- [ ] **Step 6: Commit scaffolding**

```bash
git add package.json tsconfig.json build.mjs src/
git commit -m "feat: project scaffolding with build system"
```

---

### Task 2: fs-api.ts — Pure HTTP Handler (TDD)

**Files:**
- Create: `src/fs-api.ts`
- Create: `test/fs-api.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `createHandler(defaultRoot: string): (req, res) => Promise<void>`

The handler processes:
- `GET /filemanager-fs/root?hint=<path>` → `{ root, name }`
- `GET /filemanager-fs/list?hint=<root>&path=<rel>` → `{ entries: [{name, kind, size?}], truncated? }`

- [ ] **Step 1: Write test for root endpoint (happy path)**

```typescript
// test/fs-api.test.ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { createHandler } from "../src/fs-api.js";

function request(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  path: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      await handler(req, res);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      const url = `http://127.0.0.1:${addr.port}${path}`;
      fetch(url, { headers })
        .then(async (res) => {
          const body = await res.json();
          server.close();
          resolve({ status: res.status, body });
        })
        .catch((err) => {
          server.close();
          reject(err);
        });
    });
  });
}

describe("fs-api", () => {
  let tempDir: string;
  let handler: ReturnType<typeof createHandler>;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "fs-api-test-"));
    handler = createHandler(tempDir);
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("GET /filemanager-fs/root", () => {
    it("returns canonical root and basename", async () => {
      const { status, body } = await request(
        handler,
        "/filemanager-fs/root",
        { "x-dsh-filemanager": "1" }
      );
      assert.strictEqual(status, 200);
      assert.strictEqual((body as any).name, basename(tempDir));
      assert.ok((body as any).root.length > 0);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test
```

Expected: FAIL — `createHandler` not found or returns nothing.

- [ ] **Step 3: Implement root endpoint in fs-api.ts**

```typescript
// src/fs-api.ts
import { readdir, stat, realpath, lstat } from "node:fs/promises";
import { resolve, sep, basename, join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const IGNORED = new Set(["node_modules", ".git"]);
const MAX_ENTRIES = 2000;
const ROUTE_PREFIX = "/filemanager-fs";

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(text);
}

function isInside(root: string, target: string): boolean {
  return target === root || target.startsWith(root + sep);
}

async function resolveRoot(hint: string | null, fallback: string): Promise<string> {
  if (hint && hint.length > 0) {
    try {
      const real = await realpath(hint);
      const st = await stat(real);
      if (st.isDirectory()) return real;
    } catch {}
  }
  try {
    return await realpath(fallback);
  } catch {
    return fallback;
  }
}

export function createHandler(defaultRoot: string) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      // Security: require header
      if (req.headers["x-dsh-filemanager"] !== "1") {
        return send(res, 403, { error: "missing x-dsh-filemanager header" });
      }

      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);

      if (parts[0] !== "filemanager-fs" || parts.length < 2) {
        return send(res, 404, { error: "not found" });
      }

      const action = parts[1];
      const hint = url.searchParams.get("hint");
      const root = await resolveRoot(hint, defaultRoot);

      switch (action) {
        case "root":
          return send(res, 200, { root, name: basename(root) });

        default:
          return send(res, 404, { error: `unknown action: ${action}` });
      }
    } catch (err: any) {
      const status = err?.code === "ENOENT" ? 404 : 500;
      send(res, status, { error: err?.message ?? String(err) });
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test
```

Expected: PASS

- [ ] **Step 5: Add test for missing header (403)**

Add to test/fs-api.test.ts:

```typescript
    it("returns 403 without x-dsh-filemanager header", async () => {
      const { status, body } = await request(handler, "/filemanager-fs/root");
      assert.strictEqual(status, 403);
      assert.ok((body as any).error.includes("header"));
    });
```

- [ ] **Step 6: Run test — should pass (already implemented)**

```bash
npm test
```

- [ ] **Step 7: Add test for list endpoint (happy path)**

Add to test/fs-api.test.ts inside the describe block:

```typescript
  describe("GET /filemanager-fs/list", () => {
    before(async () => {
      // Create test structure
      await mkdir(join(tempDir, "subdir"));
      await mkdir(join(tempDir, "node_modules")); // should be filtered
      await mkdir(join(tempDir, ".git")); // should be filtered
      await mkdir(join(tempDir, ".hidden")); // dotfile dir, should appear
      await writeFile(join(tempDir, "file.txt"), "hello");
      await writeFile(join(tempDir, ".dotfile"), "secret");
      await writeFile(join(tempDir, "subdir", "nested.js"), "code");
    });

    it("lists root directory entries", async () => {
      const { status, body } = await request(
        handler,
        `/filemanager-fs/list?hint=${encodeURIComponent(tempDir)}&path=`,
        { "x-dsh-filemanager": "1" }
      );
      assert.strictEqual(status, 200);
      const entries = (body as any).entries as Array<{ name: string; kind: string }>;
      const names = entries.map((e) => e.name);
      
      // Check filtering
      assert.ok(!names.includes("node_modules"), "node_modules should be filtered");
      assert.ok(!names.includes(".git"), ".git should be filtered");
      
      // Check dotfiles present
      assert.ok(names.includes(".hidden"), ".hidden dir should appear");
      assert.ok(names.includes(".dotfile"), ".dotfile should appear");
      
      // Check regular entries
      assert.ok(names.includes("subdir"));
      assert.ok(names.includes("file.txt"));
    });

    it("returns kind for each entry", async () => {
      const { status, body } = await request(
        handler,
        `/filemanager-fs/list?hint=${encodeURIComponent(tempDir)}&path=`,
        { "x-dsh-filemanager": "1" }
      );
      const entries = (body as any).entries as Array<{ name: string; kind: string }>;
      const subdir = entries.find((e) => e.name === "subdir");
      const file = entries.find((e) => e.name === "file.txt");
      assert.strictEqual(subdir?.kind, "dir");
      assert.strictEqual(file?.kind, "file");
    });

    it("lists nested directory", async () => {
      const { status, body } = await request(
        handler,
        `/filemanager-fs/list?hint=${encodeURIComponent(tempDir)}&path=subdir`,
        { "x-dsh-filemanager": "1" }
      );
      assert.strictEqual(status, 200);
      const entries = (body as any).entries as Array<{ name: string }>;
      const names = entries.map((e) => e.name);
      assert.ok(names.includes("nested.js"));
    });
  });
```

- [ ] **Step 8: Run test to verify it fails**

```bash
npm test
```

Expected: FAIL — list action not implemented.

- [ ] **Step 9: Implement list endpoint**

Update src/fs-api.ts, add to the switch statement before `default`:

```typescript
        case "list": {
          const relPath = url.searchParams.get("path") ?? "";
          const target = resolve(root, relPath);
          
          // Containment check
          const realTarget = await realpath(target);
          if (!isInside(root, realTarget)) {
            return send(res, 403, { error: "path escapes workspace" });
          }

          const st = await stat(realTarget);
          if (!st.isDirectory()) {
            return send(res, 400, { error: "not a directory" });
          }

          const dirents = await readdir(realTarget, { withFileTypes: true });
          const entries: Array<{ name: string; kind: string; size?: number }> = [];

          for (const d of dirents) {
            if (IGNORED.has(d.name)) continue;

            let kind: string;
            let size: number | undefined;

            if (d.isSymbolicLink()) {
              // Check if symlink points inside root
              try {
                const linkTarget = await realpath(join(realTarget, d.name));
                const linkStat = await stat(linkTarget);
                if (!isInside(root, linkTarget)) {
                  // Symlink escapes — mark but don't allow traversal
                  kind = linkStat.isDirectory() ? "symlink-dir" : "symlink-file";
                } else {
                  kind = linkStat.isDirectory() ? "dir" : "file";
                  if (!linkStat.isDirectory()) size = linkStat.size;
                }
              } catch {
                kind = "symlink-file"; // broken symlink
              }
            } else if (d.isDirectory()) {
              kind = "dir";
            } else {
              kind = "file";
              try {
                size = (await lstat(join(realTarget, d.name))).size;
              } catch {}
            }

            entries.push({ name: d.name, kind, ...(size !== undefined && { size }) });
          }

          // Truncate if too many
          const truncated = entries.length > MAX_ENTRIES;
          const result = truncated ? entries.slice(0, MAX_ENTRIES) : entries;

          return send(res, 200, { entries: result, ...(truncated && { truncated: true }) });
        }
```

- [ ] **Step 10: Run tests to verify they pass**

```bash
npm test
```

Expected: All PASS.

- [ ] **Step 11: Add test for path traversal attack (403)**

```typescript
    it("returns 403 for path traversal attempt", async () => {
      const { status, body } = await request(
        handler,
        `/filemanager-fs/list?hint=${encodeURIComponent(tempDir)}&path=../../../etc`,
        { "x-dsh-filemanager": "1" }
      );
      assert.strictEqual(status, 403);
      assert.ok((body as any).error.includes("escape"));
    });
```

- [ ] **Step 12: Run test — should pass**

```bash
npm test
```

- [ ] **Step 13: Add test for ENOENT (404)**

```typescript
    it("returns 404 for non-existent path", async () => {
      const { status } = await request(
        handler,
        `/filemanager-fs/list?hint=${encodeURIComponent(tempDir)}&path=nonexistent`,
        { "x-dsh-filemanager": "1" }
      );
      assert.strictEqual(status, 404);
    });
```

- [ ] **Step 14: Run test — should pass**

```bash
npm test
```

- [ ] **Step 15: Add test for file instead of directory (400)**

```typescript
    it("returns 400 when path is a file", async () => {
      const { status, body } = await request(
        handler,
        `/filemanager-fs/list?hint=${encodeURIComponent(tempDir)}&path=file.txt`,
        { "x-dsh-filemanager": "1" }
      );
      assert.strictEqual(status, 400);
      assert.ok((body as any).error.includes("directory"));
    });
```

- [ ] **Step 16: Run test — should pass**

```bash
npm test
```

- [ ] **Step 17: Commit fs-api with tests**

```bash
git add src/fs-api.ts test/fs-api.test.ts
git commit -m "feat: fs-api HTTP handler with root/list endpoints (TDD)"
```

---

### Task 3: Host Entry (index.ts)

**Files:**
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `createHandler` from `./fs-api.js`
- Produces: `apply(ctx)` that registers `/filemanager-fs` route via `ctx.webServer`

- [ ] **Step 1: Implement host apply function**

```typescript
// src/index.ts
import { createHandler } from "./fs-api.js";
import { resolve } from "node:path";

const ROUTE_PREFIX = "/filemanager-fs";

function resolveDefaultRoot(): string {
  return resolve(process.env.DSH_WORKSPACE ?? process.cwd());
}

export function apply(ctx: any): void {
  ctx.inject(["webServer"], (httpCtx: any) => {
    httpCtx.effect(
      () =>
        httpCtx.webServer.register({
          kind: "prefix",
          path: ROUTE_PREFIX,
          handler: createHandler(resolveDefaultRoot()),
        }),
      "dsh-filemanager: /filemanager-fs file tree API"
    );
  });
}
```

- [ ] **Step 2: Build and verify no errors**

```bash
npm run build
```

Expected: Build succeeds, `lib/index.js` contains the registration code.

- [ ] **Step 3: Commit host entry**

```bash
git add src/index.ts
git commit -m "feat: host entry with webServer route registration"
```

---

### Task 4: Client Infrastructure (styles, store, api)

**Files:**
- Create: `src/styles.ts`
- Create: `src/store.ts`
- Create: `src/api.ts`
- Create: `test/client-logic.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `CSS_STRING: string` — injectable CSS
  - `createStore(ctx): { useOpen, toggle, close }`
  - `fetchRoot(hint): Promise<{root, name}>`
  - `fetchList(hint, path): Promise<{entries, truncated?}>`
  - `sortEntries(entries): Entry[]` — dirs first, then files, alphabetic

- [ ] **Step 1: Create styles.ts**

```typescript
// src/styles.ts

// All styles use DSH theme tokens (--dsw-*) for automatic dark/light support
export const CSS_STRING = `
/* Toggle tab */
.fm-toggle {
  position: fixed;
  z-index: 100;
  width: 24px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--dsw-alias-bg-overlay);
  border: 1px solid var(--dsw-alias-border-l2);
  border-left: none;
  border-radius: 0 8px 8px 0;
  cursor: pointer;
  pointer-events: auto;
  transition: left 0.2s ease, background 0.15s;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}
.fm-toggle:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

/* Panel */
.fm-panel {
  position: fixed;
  top: 0;
  bottom: 0;
  width: 300px;
  z-index: 99;
  display: flex;
  flex-direction: column;
  background: var(--dsw-alias-bg-overlay);
  border-right: 1px solid var(--dsw-alias-border-l2);
  box-shadow: 4px 0 16px rgba(0,0,0,0.15);
  transform: translateX(-100%);
  transition: transform 0.2s ease;
  pointer-events: auto;
}
.fm-panel.fm-panel--open {
  transform: translateX(0);
}

/* Panel header */
.fm-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  flex-shrink: 0;
}
.fm-header-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}
.fm-header-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font-size: 14px;
}
.fm-header-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

/* Tree container */
.fm-tree {
  flex: 1;
  overflow: auto;
  padding: 8px;
}

/* Tree row */
.fm-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: default;
  font-size: 13px;
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
}
.fm-row--dir {
  cursor: pointer;
}
.fm-row--dir:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.fm-row-chevron {
  width: 16px;
  text-align: center;
  font-size: 10px;
  color: var(--dsw-alias-label-tertiary);
}
.fm-row-icon {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.fm-row-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fm-row-children {
  margin-left: 16px;
}

/* States */
.fm-loading, .fm-error, .fm-empty {
  padding: 16px;
  text-align: center;
  font-size: 13px;
  color: var(--dsw-alias-label-tertiary);
}
.fm-error {
  color: var(--dsw-alias-state-error-primary);
}
.fm-error button {
  margin-top: 8px;
  padding: 4px 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.fm-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid var(--dsw-alias-border-l2);
  border-top-color: var(--dsw-alias-brand-primary);
  border-radius: 50%;
  animation: fm-spin 0.8s linear infinite;
}
@keyframes fm-spin {
  to { transform: rotate(360deg); }
}

/* Scrollbar */
.fm-tree::-webkit-scrollbar {
  width: 8px;
}
.fm-tree::-webkit-scrollbar-thumb {
  background: var(--dsw-alias-scrollbar-bg-l2);
  border-radius: 4px;
}
`;
```

- [ ] **Step 2: Create store.ts**

```typescript
// src/store.ts

const LS_KEY = "dsh-filemanager-open";

export interface FileManagerState {
  open: boolean;
}

export interface FileManagerStore {
  getState(): FileManagerState;
  setState(partial: Partial<FileManagerState>): void;
  subscribe(listener: () => void): () => void;
}

function loadFromStorage(): boolean {
  try {
    return localStorage.getItem(LS_KEY) === "1";
  } catch {
    return false;
  }
}

function saveToStorage(open: boolean): void {
  try {
    localStorage.setItem(LS_KEY, open ? "1" : "0");
  } catch {}
}

export function createStore(): FileManagerStore {
  let state: FileManagerState = { open: loadFromStorage() };
  const listeners = new Set<() => void>();

  return {
    getState: () => state,
    setState: (partial) => {
      state = { ...state, ...partial };
      if (partial.open !== undefined) {
        saveToStorage(state.open);
      }
      listeners.forEach((l) => l());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// Actions
export function toggle(store: FileManagerStore): void {
  store.setState({ open: !store.getState().open });
}

export function close(store: FileManagerStore): void {
  store.setState({ open: false });
}
```

- [ ] **Step 3: Create api.ts**

```typescript
// src/api.ts

const HEADER = { "x-dsh-filemanager": "1" };

export interface Entry {
  name: string;
  kind: "dir" | "file" | "symlink-dir" | "symlink-file";
  size?: number;
}

export interface RootResponse {
  root: string;
  name: string;
}

export interface ListResponse {
  entries: Entry[];
  truncated?: boolean;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: HEADER });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  return data as T;
}

export function fetchRoot(hint: string): Promise<RootResponse> {
  const url = `/filemanager-fs/root?hint=${encodeURIComponent(hint)}`;
  return fetchJson<RootResponse>(url);
}

export function fetchList(hint: string, path: string): Promise<ListResponse> {
  const url = `/filemanager-fs/list?hint=${encodeURIComponent(hint)}&path=${encodeURIComponent(path)}`;
  return fetchJson<ListResponse>(url);
}

// Sort: directories first, then files, alphabetically case-insensitive
export function sortEntries(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => {
    const aIsDir = a.kind === "dir" || a.kind === "symlink-dir";
    const bIsDir = b.kind === "dir" || b.kind === "symlink-dir";
    if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

// Color by extension for file dot markers
const EXT_COLORS: Record<string, string> = {
  ts: "#3178c6",
  tsx: "#3178c6",
  js: "#f7df1e",
  jsx: "#61dafb",
  mjs: "#f7df1e",
  json: "#cbcb41",
  md: "#519aba",
  css: "#563d7c",
  html: "#e34c26",
  py: "#3572a5",
  rs: "#dea584",
  go: "#00add8",
  yaml: "#cb171e",
  yml: "#cb171e",
  sh: "#89e051",
  txt: "#9ca3af",
};

export function getFileColor(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 1) return "#9ca3af";
  const ext = name.slice(dot + 1).toLowerCase();
  return EXT_COLORS[ext] ?? "#9ca3af";
}
```

- [ ] **Step 4: Write client logic tests**

```typescript
// test/client-logic.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { sortEntries, getFileColor, type Entry } from "../src/api.js";
import { createStore, toggle, close } from "../src/store.js";

describe("sortEntries", () => {
  it("sorts directories before files", () => {
    const entries: Entry[] = [
      { name: "zebra.txt", kind: "file" },
      { name: "alpha", kind: "dir" },
      { name: "beta.js", kind: "file" },
    ];
    const sorted = sortEntries(entries);
    assert.strictEqual(sorted[0].name, "alpha");
    assert.strictEqual(sorted[1].name, "beta.js");
    assert.strictEqual(sorted[2].name, "zebra.txt");
  });

  it("sorts alphabetically case-insensitive", () => {
    const entries: Entry[] = [
      { name: "Zebra", kind: "dir" },
      { name: "alpha", kind: "dir" },
      { name: "Beta", kind: "dir" },
    ];
    const sorted = sortEntries(entries);
    assert.strictEqual(sorted[0].name, "alpha");
    assert.strictEqual(sorted[1].name, "Beta");
    assert.strictEqual(sorted[2].name, "Zebra");
  });

  it("treats symlink-dir as directory", () => {
    const entries: Entry[] = [
      { name: "file.txt", kind: "file" },
      { name: "link", kind: "symlink-dir" },
    ];
    const sorted = sortEntries(entries);
    assert.strictEqual(sorted[0].name, "link");
  });
});

describe("getFileColor", () => {
  it("returns blue for .ts files", () => {
    assert.strictEqual(getFileColor("index.ts"), "#3178c6");
  });

  it("returns gray for unknown extension", () => {
    assert.strictEqual(getFileColor("file.xyz"), "#9ca3af");
  });

  it("returns gray for no extension", () => {
    assert.strictEqual(getFileColor("Makefile"), "#9ca3af");
  });
});

describe("store", () => {
  it("toggle flips open state", () => {
    const store = createStore();
    const initial = store.getState().open;
    toggle(store);
    assert.strictEqual(store.getState().open, !initial);
    toggle(store);
    assert.strictEqual(store.getState().open, initial);
  });

  it("close sets open to false", () => {
    const store = createStore();
    store.setState({ open: true });
    close(store);
    assert.strictEqual(store.getState().open, false);
  });

  it("notifies subscribers on change", () => {
    const store = createStore();
    let called = 0;
    store.subscribe(() => called++);
    toggle(store);
    assert.strictEqual(called, 1);
  });
});
```

- [ ] **Step 5: Run tests**

```bash
npm test
```

Expected: All PASS.

- [ ] **Step 6: Commit client infrastructure**

```bash
git add src/styles.ts src/store.ts src/api.ts test/client-logic.test.ts
git commit -m "feat: client infrastructure (styles, store, api)"
```

---

### Task 5: Tree Component

**Files:**
- Create: `src/Tree.tsx`

**Interfaces:**
- Consumes: `Entry`, `fetchList`, `sortEntries`, `getFileColor` from `./api.js`
- Produces: `<Tree hint={string} onError={fn} />` — recursive tree with lazy loading

- [ ] **Step 1: Create Tree.tsx**

```tsx
// src/Tree.tsx
import { useState, useEffect, useCallback } from "react";
import { fetchList, sortEntries, getFileColor, type Entry } from "./api.js";

interface TreeNodeProps {
  entry: Entry;
  hint: string;
  path: string;
  onError: (msg: string) => void;
}

function TreeNode({ entry, hint, path, onError }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<Entry[] | null>(null);
  const [loading, setLoading] = useState(false);

  const isDir = entry.kind === "dir" || entry.kind === "symlink-dir";
  const fullPath = path ? `${path}/${entry.name}` : entry.name;

  const handleToggle = useCallback(async () => {
    if (!isDir) return;

    if (expanded) {
      setExpanded(false);
      return;
    }

    // Symlink dirs that escape root cannot be expanded
    if (entry.kind === "symlink-dir" && children === null) {
      setExpanded(true);
      setChildren([]); // Empty, can't traverse
      return;
    }

    if (children === null) {
      setLoading(true);
      try {
        const res = await fetchList(hint, fullPath);
        setChildren(sortEntries(res.entries));
      } catch (err: any) {
        onError(`Failed to load ${fullPath}: ${err.message}`);
        setChildren([]);
      } finally {
        setLoading(false);
      }
    }
    setExpanded(true);
  }, [isDir, expanded, children, hint, fullPath, entry.kind, onError]);

  return (
    <div>
      <div
        className={`fm-row${isDir ? " fm-row--dir" : ""}`}
        onClick={handleToggle}
      >
        <span className="fm-row-chevron">
          {isDir ? (expanded ? "▾" : "▸") : ""}
        </span>
        {isDir ? (
          <span style={{ fontSize: 14 }}>{expanded ? "📂" : "📁"}</span>
        ) : (
          <span
            className="fm-row-icon"
            style={{ backgroundColor: getFileColor(entry.name) }}
          />
        )}
        <span className="fm-row-name">{entry.name}</span>
        {loading && <span className="fm-spinner" />}
      </div>
      {expanded && children && children.length > 0 && (
        <div className="fm-row-children">
          {children.map((child) => (
            <TreeNode
              key={child.name}
              entry={child}
              hint={hint}
              path={fullPath}
              onError={onError}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface TreeProps {
  hint: string;
  entries: Entry[];
  onError: (msg: string) => void;
}

export function Tree({ hint, entries, onError }: TreeProps) {
  const sorted = sortEntries(entries);

  if (sorted.length === 0) {
    return <div className="fm-empty">Пустая папка</div>;
  }

  return (
    <div className="fm-tree">
      {sorted.map((entry) => (
        <TreeNode
          key={entry.name}
          entry={entry}
          hint={hint}
          path=""
          onError={onError}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Build and verify no errors**

```bash
npm run build
```

- [ ] **Step 3: Commit Tree component**

```bash
git add src/Tree.tsx
git commit -m "feat: Tree component with lazy loading"
```

---

### Task 6: Panel Component

**Files:**
- Create: `src/Panel.tsx`

**Interfaces:**
- Consumes: `Tree` from `./Tree.js`, `fetchRoot`, `fetchList`, `sortEntries` from `./api.js`
- Produces: `<Panel open={boolean} sidebarLeft={number} hint={string} onClose={fn} />`

- [ ] **Step 1: Create Panel.tsx**

```tsx
// src/Panel.tsx
import { useState, useEffect, useCallback } from "react";
import { fetchRoot, fetchList, sortEntries, type Entry } from "./api.js";
import { Tree } from "./Tree.js";

interface PanelProps {
  open: boolean;
  sidebarLeft: number;
  hint: string;
  onClose: () => void;
}

type Status = "loading" | "ready" | "error" | "no-workspace";

export function Panel({ open, sidebarLeft, hint, onClose }: PanelProps) {
  const [status, setStatus] = useState<Status>("loading");
  const [rootName, setRootName] = useState("");
  const [rootPath, setRootPath] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState("");

  const loadRoot = useCallback(async () => {
    if (!hint) {
      setStatus("no-workspace");
      return;
    }

    setStatus("loading");
    setError("");

    try {
      const rootRes = await fetchRoot(hint);
      setRootPath(rootRes.root);
      setRootName(rootRes.name);

      const listRes = await fetchList(hint, "");
      setEntries(sortEntries(listRes.entries));
      setStatus("ready");
    } catch (err: any) {
      setError(err.message);
      setStatus("error");
    }
  }, [hint]);

  // Load on mount and when hint changes
  useEffect(() => {
    loadRoot();
  }, [loadRoot]);

  const handleRefresh = useCallback(() => {
    loadRoot();
  }, [loadRoot]);

  const handleError = useCallback((msg: string) => {
    // Show inline error for individual folder failures
    console.warn("[filemanager]", msg);
  }, []);

  return (
    <div
      className={`fm-panel${open ? " fm-panel--open" : ""}`}
      style={{ left: sidebarLeft }}
    >
      <div className="fm-header">
        <span className="fm-header-title" title={rootPath}>
          {rootName || "Файлы"}
        </span>
        <button
          className="fm-header-btn"
          onClick={handleRefresh}
          title="Обновить"
        >
          ↻
        </button>
        <button className="fm-header-btn" onClick={onClose} title="Закрыть">
          ✕
        </button>
      </div>

      {status === "loading" && (
        <div className="fm-loading">
          <span className="fm-spinner" /> Загрузка…
        </div>
      )}

      {status === "error" && (
        <div className="fm-error">
          <div>Ошибка: {error}</div>
          <button onClick={handleRefresh}>Повторить</button>
        </div>
      )}

      {status === "no-workspace" && (
        <div className="fm-empty">Нет воркспейса</div>
      )}

      {status === "ready" && (
        <Tree hint={hint} entries={entries} onError={handleError} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build and verify no errors**

```bash
npm run build
```

- [ ] **Step 3: Commit Panel component**

```bash
git add src/Panel.tsx
git commit -m "feat: Panel component with header and tree"
```

---

### Task 7: ToggleTab Component

**Files:**
- Create: `src/ToggleTab.tsx`

**Interfaces:**
- Consumes: nothing
- Produces: `<ToggleTab open={boolean} onToggle={fn} sidebarLeftRef={ref} />` — tracks sidebar width via ResizeObserver

- [ ] **Step 1: Create ToggleTab.tsx**

```tsx
// src/ToggleTab.tsx
import { useRef, useEffect, useState, useCallback } from "react";

interface ToggleTabProps {
  open: boolean;
  onToggle: () => void;
  onSidebarLeft: (left: number) => void;
}

export function ToggleTab({ open, onToggle, onSidebarLeft }: ToggleTabProps) {
  const [left, setLeft] = useState(0);
  const tabRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Find sidebar column by structure:
    // Our overlay is in the grid frame; sidebar is first column
    const findSidebarColumn = (): HTMLElement | null => {
      const el = tabRef.current;
      if (!el) return null;

      // Walk up to find the grid frame (parent of overlay layer)
      let frame = el.parentElement;
      while (frame && !frame.querySelector("[data-slot-layer]")) {
        frame = frame.parentElement;
      }
      if (!frame) return null;

      // First child of frame is typically sidebar column
      const firstChild = frame.firstElementChild as HTMLElement | null;
      if (firstChild && firstChild !== el.parentElement) {
        return firstChild;
      }
      return null;
    };

    const sidebar = findSidebarColumn();
    if (!sidebar) {
      // Fallback: left edge
      setLeft(0);
      onSidebarLeft(0);
      return;
    }

    const updatePosition = () => {
      const rect = sidebar.getBoundingClientRect();
      const newLeft = rect.right;
      setLeft(newLeft);
      onSidebarLeft(newLeft);
    };

    updatePosition();

    const observer = new ResizeObserver(updatePosition);
    observer.observe(sidebar);

    return () => observer.disconnect();
  }, [onSidebarLeft]);

  // When panel is open, tab moves to panel's right edge
  const tabLeft = open ? left + 300 : left;
  const verticalOffset = Math.round(window.innerHeight / 3);

  return (
    <div
      ref={tabRef}
      className="fm-toggle"
      style={{ left: tabLeft, top: verticalOffset }}
      onClick={onToggle}
      title={open ? "Закрыть панель" : "Открыть файлы"}
    >
      {open ? "◀" : "▶"}
    </div>
  );
}
```

- [ ] **Step 2: Build and verify no errors**

```bash
npm run build
```

- [ ] **Step 3: Commit ToggleTab component**

```bash
git add src/ToggleTab.tsx
git commit -m "feat: ToggleTab with ResizeObserver sidebar tracking"
```

---

### Task 8: Client Entry (client.tsx)

**Files:**
- Modify: `src/client.tsx`

**Interfaces:**
- Consumes: `CSS_STRING` from `./styles.js`, `createStore`, `toggle`, `close` from `./store.js`, `ToggleTab`, `Panel`
- Produces: `apply(ctx)` that registers two components in `shell.overlay`

- [ ] **Step 1: Implement client apply**

```tsx
// src/client.tsx
import { useState, useEffect, useSyncExternalStore } from "react";
import { CSS_STRING } from "./styles.js";
import { createStore, toggle, close, type FileManagerStore } from "./store.js";
import { ToggleTab } from "./ToggleTab.js";
import { Panel } from "./Panel.js";

const CSS_TAG_ID = "dsh-filemanager-css";

function injectCss(css: string): void {
  if (document.getElementById(CSS_TAG_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_TAG_ID;
  style.textContent = css;
  document.head.appendChild(style);
}

// Shared store instance (created once per client lifecycle)
let sharedStore: FileManagerStore | null = null;

function getStore(): FileManagerStore {
  if (!sharedStore) {
    sharedStore = createStore();
  }
  return sharedStore;
}

// Hook to use store in components
function useStore(): { open: boolean; toggle: () => void; close: () => void } {
  const store = getStore();
  const open = useSyncExternalStore(
    store.subscribe,
    () => store.getState().open
  );
  return {
    open,
    toggle: () => toggle(store),
    close: () => close(store),
  };
}

// Compute workspace state from DSH context
interface WorkspaceState {
  status: "loading" | "ready" | "empty";
  hint?: string;
}

function computeWorkspaceState(workspaces: any, sessions: any): WorkspaceState {
  const list = workspaces?.list;
  if (list === undefined) return { status: "ready" };
  
  const s = list.getSnapshot();
  if (!s || s.state === "loading" || s.baselinesReady !== true) {
    return { status: "loading" };
  }
  
  const items = s.items;
  if (!Array.isArray(items) || items.length === 0) {
    return { status: "empty" };
  }

  // Find workspace for current session
  let current: any;
  try {
    const sesSnap = sessions?.list?.getSnapshot();
    const curId = sesSnap?.current;
    if (curId !== undefined) {
      current = items.find(
        (w: any) => Array.isArray(w.sessionIds) && w.sessionIds.includes(curId)
      );
    }
  } catch {}

  const chosen = current ?? items.find((w: any) => w.workspaceId === s.recentWorkspaceId) ?? items[0];
  return typeof chosen?.path === "string" 
    ? { status: "ready", hint: chosen.path } 
    : { status: "ready" };
}

// Main component that wraps ToggleTab + Panel
function FileManager({ workspaces, sessions }: any) {
  const { open, toggle: doToggle, close: doClose } = useStore();
  const [sidebarLeft, setSidebarLeft] = useState(0);
  const [ws, setWs] = useState<WorkspaceState>(() => 
    computeWorkspaceState(workspaces, sessions)
  );

  // Subscribe to workspace/session changes
  useEffect(() => {
    const update = () => setWs(computeWorkspaceState(workspaces, sessions));
    const offs: Array<() => void> = [];
    
    if (workspaces?.list !== undefined) {
      offs.push(workspaces.list.subscribe(update));
    }
    if (sessions?.list !== undefined) {
      offs.push(sessions.list.subscribe(update));
    }
    
    update();
    return () => offs.forEach(off => off());
  }, [workspaces?.list, sessions?.list]);

  const hint = ws.hint ?? "";

  return (
    <>
      <ToggleTab
        open={open}
        onToggle={doToggle}
        onSidebarLeft={setSidebarLeft}
      />
      <Panel
        open={open}
        sidebarLeft={sidebarLeft}
        hint={hint}
        onClose={doClose}
      />
    </>
  );
}

export function apply(ctx: any): void {
  // Inject CSS
  injectCss(CSS_STRING);

  // Register into shell.overlay slot
  ctx.slots.inject("shell.overlay", () => {
    const dispose = ctx.slots.register(
      {
        name: "shell.overlay",
        id: "filemanager",
        order: 50,
        inject: () => ({
          workspaces: ctx.workspaces,
          sessions: ctx.sessions,
        }),
      },
      FileManager
    );

    return dispose;
  });
}
```

- [ ] **Step 2: Build and verify no errors**

```bash
npm run build
```

- [ ] **Step 3: Verify lib/client.js has ModuleLoader wrapper**

```bash
head -5 lib/client.js
```

Expected: `window.__ModuleLoader__.load({...`

- [ ] **Step 4: Commit client entry**

```bash
git add src/client.tsx
git commit -m "feat: client entry with shell.overlay registration"
```

---

### Task 9: Integration and Installation

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: built plugin
- Produces: Working plugin installed in DSH web profile

- [ ] **Step 1: Create README.md**

```markdown
# dsh-filemanager

Workspace file tree panel for DeepSeek Harness Web GUI.

A toggle tab at the sidebar edge opens a panel showing the directory tree of the current session's workspace. View-only: click on a file does nothing.

## Features

- Toggle tab tracks sidebar width (ResizeObserver)
- Lazy directory loading on expand
- Refresh button reloads entire tree
- Filters `node_modules` and `.git`; shows dotfiles
- Uses DSH theme tokens (auto dark/light)

## Installation

1. Build the plugin:
   ```bash
   npm install
   npm run build
   ```

2. Add to DSH web profile:
   ```bash
   dsh plugin --profile web add /path/to/dsh-filemanager-plugin
   ```

3. Add to `~/.dsh/profiles/web/cordis.patch.yml`:
   ```yaml
   - insert:
       - id: filemanager
         name: 'dsh-filemanager'
   ```

4. Restart `dsh web` and refresh the browser.

## Removing old plugin

If you have `dsh-file-explorer` installed:

```bash
dsh plugin --profile web remove dsh-file-explorer
```

And remove its entry from `cordis.patch.yml`.
```

- [ ] **Step 2: Run full test suite**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 3: Build final artifacts**

```bash
npm run build
ls -la lib/
```

Expected: `lib/index.js` and `lib/client.js` present.

- [ ] **Step 4: Remove old plugin from profile**

```bash
# Edit ~/.dsh/profiles/web/cordis.patch.yml
# Remove the dsh-file-explorer insert block

# Edit ~/.dsh/profiles/web/package.json  
# Remove "dsh-file-explorer" from dependencies

# Reinstall profile dependencies
cd ~/.dsh/profiles/web && pnpm install
```

- [ ] **Step 5: Install new plugin**

```bash
dsh plugin --profile web add /Volumes/Maxon/dsh-default/dsh-filemanager-plugin
```

- [ ] **Step 6: Add to cordis.patch.yml**

Add to `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
# dsh-filemanager: workspace file tree panel
- insert:
    - id: filemanager
      name: 'dsh-filemanager'
```

- [ ] **Step 7: Restart dsh web and verify**

User restarts `dsh web`, refreshes browser at http://127.0.0.1:3080.

Manual checklist:
- [ ] Toggle tab visible at sidebar edge
- [ ] Click opens panel with file tree
- [ ] Directories expand on click (lazy load)
- [ ] Refresh button works
- [ ] Close button works
- [ ] State persists across page reload
- [ ] Both themes look correct
- [ ] Old dsh-file-explorer panel gone

- [ ] **Step 8: Commit README and final state**

```bash
git add README.md
git commit -m "docs: README with installation instructions"
```

---

## Summary

| Task | Description | Key Deliverable |
|------|-------------|-----------------|
| 1 | Project Scaffolding | package.json, tsconfig, build.mjs |
| 2 | fs-api.ts (TDD) | HTTP handler with root/list endpoints |
| 3 | Host Entry | index.ts with webServer registration |
| 4 | Client Infrastructure | styles, store, api modules |
| 5 | Tree Component | Recursive tree with lazy loading |
| 6 | Panel Component | Header + tree container |
| 7 | ToggleTab Component | ResizeObserver sidebar tracking |
| 8 | Client Entry | client.tsx with slot registration |
| 9 | Integration | README, installation, manual testing |