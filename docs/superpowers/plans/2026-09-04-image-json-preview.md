# Image Preview (standalone + in-Markdown) & JSON Pretty View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users preview image files in the dock (fit + zoom) and inside rendered Markdown, and format `.json` files with a Raw/Formatted toggle.

**Architecture:** A new header-gated `/cap` endpoint mints an unguessable per-workspace token; a new `/raw` endpoint (the only header-less route) serves image bytes to URLs carrying that token, so plain `<img>` tags work. On the client, a preview-kind classifier routes files to dedicated viewers behind the existing dock: an image view (fit/zoom, dims), a reworked Markdown renderer that emits raw URLs for safe workspace-local images, and a JSON Raw/Formatted mode reusing the highlighted-source presentation.

**Tech Stack:** TypeScript, Node >= 20 (node:crypto, fs streams), React 18 (host), node:test + tsx. No new runtime dependencies.

**Spec:** docs/superpowers/specs/2026-09-04-image-json-preview-design.md

## Global Constraints

- Read-only invariant: `/raw` only reads; git untouched; no workspace writes by the plugin.
- Header gate: `/root`, `/list`, `/read`, `/events`, `/cap` require `x-dsh-filemanager: 1`. Only `/raw` skips the header and instead requires a valid, unexpired capability token for that hint (query param `cap`). Cross-site pages must not be able to reach images (list stays header-gated).
- Capability tokens: 32 random bytes hex (`node:crypto` `randomBytes`), per-hint store, TTL 8 h by default, rotated on each `issueFor`, constant-time comparison.
- Byte limits: raster ≤ 20 MB, SVG ≤ 2 MB (`MAX_IMAGE_BYTES`, `MAX_SVG_BYTES`); text `/read` cap (5 MB) unchanged; JSON pretty attempted only when `!truncated && length <= 1_000_000`; zoom clamped 0.1–8× (step 1.25).
- Image responses: `content-type` by magic bytes, `content-length`, `cache-control: no-store`, `x-content-type-options: nosniff`; SVG additionally `content-security-policy: sandbox`.
- Containment for `/raw`: same realpath + `isInside` rules as `/read` (symlink-safe).
- UI copy: all new strings added to both en (source of truth) and ru dictionaries in `src/l10n.ts`; `ru` stays `Record<L10nKey, string>`. Removing a key means removing it from both dictionaries.
- CSS only via `src/styles.ts` (CSS_STRING) with DSH tokens; dark theme via `body[data-ds-dark-theme]`.
- A11y L1: toolbar buttons are real `<button>`s with localized `aria-label`s; toggles keep `aria-pressed`; Esc still closes the dock; image zoom never hijacks plain wheel scroll (Ctrl+wheel only).
- Gate before every commit: `npm run typecheck && npm test && npm run build` all green (suite currently 304+ tests).
- Module imports use the repo's ESM style (`import ... from "./x.js"`) so tsx/tsc resolve them.

## File Structure

- Create: `src/capabilities.ts` — capability issuer (pure, injectable clock/token)
- Create: `src/image-types.ts` — magic-byte detection + SVG sniff + byte caps (pure)
- Create: `test/capabilities.test.ts`, `test/image-types.test.ts`, `test/raw-api.test.ts`
- Modify: `src/fs-api.ts` — `/cap` + `/raw` actions, header-gate restructure
- Create: `src/preview-kind.ts`, `test/preview-kind.test.ts` — kind classifier
- Modify: `src/preview-api.ts` — `fetchCap`
- Create: `src/caps.ts`, `test/caps.test.ts` — memoized cap cache
- Create: `src/raw-url.ts` — `buildRawFileUrl` (pure)
- Modify: `src/syntax-highlighting.ts` (+ tests) — register `json` in hljs
- Modify: `src/markdown-preview.ts` (+ tests) — `resourceUrl` render hook, raw image URLs
- Create: `src/json-view.ts`, `test/json-view.test.ts`
- Modify: `src/store.ts` — per-workspace `jsonMode`
- Create: `src/image-view.ts`, `test/image-view.test.ts` — pure zoom logic
- Create: `src/ImageView.tsx` — image viewer component (toolbar + stage + dims)
- Modify: `src/l10n.ts` — new/removed keys (en + ru)
- Modify: `src/Panel.tsx` — kind dispatch, image open/refresh flow, md image wiring, JSON mode UI, note rendering
- Modify: `src/styles.ts` — `.fm-image-*` styles
- Modify (final task): `README.md` features/API, `CHANGELOG.md`
- Task 1 touches `docs/canon/**` via the canon-write skill, plus `docs/canon/future_plans/INDEX.md`, `docs/superpowers/plans/2026-09-02-maturity-roadmap.md`

---

### Task 1: Living canon update (canon-first, repo rule) + roadmap/future-plans sync

**Files:**
- Modify: `docs/canon/OVERVIEW.md`, `docs/canon/ARCHITECTURE.md`, `docs/canon/GLOSSARY.md` (via canon-write skill — see Step 1)
- Modify: `docs/canon/future_plans/p1-image-preview-support.md` (status → absorbed)
- Modify: `docs/canon/future_plans/INDEX.md`
- Modify: `docs/superpowers/plans/2026-09-02-maturity-roadmap.md`
- Modify: `docs/superpowers/specs/2026-09-04-image-json-preview-design.md` (status: draft → approved)

**Interfaces:**
- Consumes: the design spec (decisions D1–D7, security notes).
- Produces: living canon that describes the `/cap` and `/raw` endpoints and the new preview kinds, so later tasks implement against canon (repo rule: application code follows canon).

- [ ] **Step 1: Load the canon-write skill and follow it**

Run (or have the orchestrator run, if a subagent executes this task): load the `canon-write` skill first. Coding agents must not edit `docs/canon/**` directly — every canon edit in this task goes through the canon-write workflow (its templates live under `docs/canon/templates/`).

- [ ] **Step 2: Update living canon content**

Reflect, in the canon's own structure and language:
- **OVERVIEW scope (in):** image preview of `png/jpg/jpeg/gif/webp/avif/svg` from the tree in the existing dock (fit + zoom + open original), workspace-local relative images rendered inline inside Markdown preview, JSON Raw/Formatted mode for `.json`. Out of scope stays: image editing, thumbnails, `.jsonc`, collapsible JSON.
- **OVERVIEW success signals:** image opens in dock with zoom controls; local md images render; external md images still blocked; JSON pretty default when valid and < 1 MB; invalid/over-cap falls back to raw with a note.
- **ARCHITECTURE public interfaces:** `GET /filemanager-fs/cap?hint=` (header-gated, returns `{cap}`, 8 h TTL, rotation) and `GET /filemanager-fs/raw?hint=&path=&cap=` (header-less, capability-checked; magic-byte content-type; limits 20 MB raster / 2 MB svg; `no-store`/`nosniff`; svg + `content-security-policy: sandbox`). Note the header-gate restructure: only `raw` bypasses the header.
- **ARCHITECTURE key flows:** image preview open flow (classify → ensure cap → build raw URL → ImageView), Markdown local image flow (resourceUrl builder → sanitized `<img src="/filemanager-fs/raw?...">`, container-level error handling hides failed workspace images), JSON pretty flow (formatJson decisions).
- **GLOSSARY:** capability token, preview kind.
- **future_plans:** `p1-image-preview-support.md` → status absorbed (pattern of p2/p3); `INDEX.md` row 1 status → absorbed.

- [ ] **Step 3: Sync roadmap and spec status**

Edit `docs/superpowers/plans/2026-09-02-maturity-roadmap.md`: add the post-0.2.0 cycle row (7) — image preview (standalone + md) + JSON pretty view — status `in progress — spec+plan 2026-09-04`, dependencies: none. Edit the spec header status to `approved (2026-09-04)`.

- [ ] **Step 4: Commit**

Run: `npm run typecheck && npm test && npm run build` (docs only; must stay green — nothing to break).
Commit:

```bash
git add docs/canon docs/superpowers
git commit -m "docs(canon): image preview + JSON pretty view — canon, future-plans p1 absorbed, roadmap cycle row"
```

- [ ] **Step 5: STOP — user go-ahead gate (repo canon-first rule)**

After this commit, the orchestrator pauses and asks the user for the explicit go-ahead before Task 2 starts. Do not run Task 2 without it.

---

### Task 2: Server capability issuer (pure module) + unit tests

**Files:**
- Create: `src/capabilities.ts`
- Test: `test/capabilities.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Task 4 and by tests):

```ts
export const DEFAULT_CAP_TTL_MS: number; // 8 * 60 * 60 * 1000
export interface CapabilityIssuer {
  issueFor(hint: string): string;
  isValid(hint: string, token: string): boolean;
}
export interface CapabilityIssuerOptions {
  now?: () => number;        // default Date.now
  randomToken?: () => string; // default randomBytes(32).toString("hex")
  ttlMs?: number;             // default DEFAULT_CAP_TTL_MS
}
export function createCapabilityIssuer(options?: CapabilityIssuerOptions): CapabilityIssuer;
```

- [ ] **Step 1: Write the failing tests**

Create `test/capabilities.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCapabilityIssuer, DEFAULT_CAP_TTL_MS } from "../src/capabilities.js";

describe("capability issuer", () => {
  it("issues a token per hint that validates", () => {
    const cap = createCapabilityIssuer({ randomToken: () => "tok1" });
    const t = cap.issueFor("/ws/a");
    assert.ok(t.length > 0);
    assert.equal(cap.isValid("/ws/a", t), true);
  });
  it("scopes tokens to their hint", () => {
    const cap = createCapabilityIssuer({ randomToken: () => "tok1" });
    const t = cap.issueFor("/ws/a");
    assert.equal(cap.isValid("/ws/b", t), false);
    assert.equal(cap.isValid("/ws/a", "tok2"), false);
  });
  it("rotates on every issueFor: only the newest token is valid", () => {
    const cap = createCapabilityIssuer({ randomToken: () => "rot1" });
    cap.issueFor("/ws/a");
    const fresh = cap.issueFor("/ws/a");
    assert.equal(cap.isValid("/ws/a", "rot1"), false);
    assert.equal(cap.isValid("/ws/a", fresh), true);
  });
  it("expires tokens after ttlMs", () => {
    let now = 1_000_000;
    const cap = createCapabilityIssuer({ now: () => now, ttlMs: 100, randomToken: () => "tok" });
    const t = cap.issueFor("/ws/a");
    assert.equal(cap.isValid("/ws/a", t), true);
    now += 101;
    assert.equal(cap.isValid("/ws/a", t), false);
  });
  it("defaults ttl to 8 hours", () => {
    assert.equal(DEFAULT_CAP_TTL_MS, 8 * 60 * 60 * 1000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/capabilities.test.ts`
Expected: FAIL — cannot find module `../src/capabilities.js`.

- [ ] **Step 3: Write the module**

Create `src/capabilities.ts`:

```ts
// src/capabilities.ts
import { randomBytes, timingSafeEqual } from "node:crypto";

export const DEFAULT_CAP_TTL_MS = 8 * 60 * 60 * 1000;

export interface CapabilityIssuer {
  issueFor(hint: string): string;
  isValid(hint: string, token: string): boolean;
}

export interface CapabilityIssuerOptions {
  now?: () => number;
  randomToken?: () => string;
  ttlMs?: number;
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length > 0 && ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function createCapabilityIssuer(options: CapabilityIssuerOptions = {}): CapabilityIssuer {
  const now = options.now ?? Date.now;
  const randomToken = options.randomToken ?? (() => randomBytes(32).toString("hex"));
  const ttlMs = options.ttlMs ?? DEFAULT_CAP_TTL_MS;
  const store = new Map<string, { token: string; expiresAt: number }>();

  return {
    issueFor(hint: string): string {
      const token = randomToken();
      store.set(hint, { token, expiresAt: now() + ttlMs });
      return token;
    },
    isValid(hint: string, token: string): boolean {
      const entry = store.get(hint);
      if (!entry) return false;
      if (now() >= entry.expiresAt) {
        store.delete(hint);
        return false;
      }
      return constantTimeEqual(entry.token, token);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test test/capabilities.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

Run: `npm run typecheck && npm test && npm run build`
Commit:

```bash
git add src/capabilities.ts test/capabilities.test.ts
git commit -m "feat(fs-api): capability issuer module for image preview tokens"
```

---

### Task 3: Image type detection (pure) + unit tests

**Files:**
- Create: `src/image-types.ts`
- Test: `test/image-types.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Task 4; the client classifier in Task 8 is a separate, extension-based helper):

```ts
export type ImageKind = "raster" | "svg";
export interface DetectedImage { kind: ImageKind; mime: string }
export const MAX_IMAGE_BYTES: number; // 20 * 1024 * 1024
export const MAX_SVG_BYTES: number;   // 2 * 1024 * 1024
// The first 32 bytes are enough for png/jpeg/gif/webp/avif:
export function detectImageType(header: Uint8Array): DetectedImage | null;
// SVG is text; the caller reads up to 4096 bytes (latin1) and probes:
export function looksLikeSvg(sample: string): boolean;
```

- [ ] **Step 1: Write the failing tests**

Create `test/image-types.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectImageType, looksLikeSvg, MAX_IMAGE_BYTES, MAX_SVG_BYTES } from "../src/image-types.js";

const h = (hex: string) => new Uint8Array(Buffer.from(hex, "hex"));
const enc = (s: string) => new TextEncoder().encode(s);

describe("detectImageType", () => {
  it("detects png", () => {
    assert.deepEqual(detectImageType(h("89504e470d0a1a0a0000000d49484452")), { kind: "raster", mime: "image/png" });
  });
  it("detects jpeg", () => {
    assert.deepEqual(detectImageType(h("ffd8ffe000104a4649460001")), { kind: "raster", mime: "image/jpeg" });
  });
  it("detects gif (87a and 89a)", () => {
    assert.deepEqual(detectImageType(enc("GIF87a")), { kind: "raster", mime: "image/gif" });
    assert.deepEqual(detectImageType(enc("GIF89a rest")), { kind: "raster", mime: "image/gif" });
  });
  it("detects webp (RIFF....WEBP)", () => {
    const buf = new Uint8Array(12);
    buf.set(enc("RIFF"), 0);
    buf.set(enc("WEBP"), 8);
    assert.deepEqual(detectImageType(buf), { kind: "raster", mime: "image/webp" });
  });
  it("detects avif via ftyp brand", () => {
    const buf = new Uint8Array(12);
    buf.set(enc("....ftypavif"), 0);
    assert.deepEqual(detectImageType(buf), { kind: "raster", mime: "image/avif" });
  });
  it("returns null for unknown bytes and empty input", () => {
    assert.equal(detectImageType(enc("plain text!!")), null);
    assert.equal(detectImageType(new Uint8Array(0)), null);
  });
});

describe("looksLikeSvg", () => {
  it("accepts an svg document", () => {
    assert.equal(looksLikeSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'), true);
  });
  it("accepts xml-declared svg", () => {
    assert.equal(looksLikeSvg('<?xml version="1.0"?><svg viewBox="0 0 1 1"></svg>'), true);
  });
  it("accepts prefixed svg elements", () => {
    assert.equal(looksLikeSvg('<svg:svg xmlns:svg="x"></svg:svg>'), true);
  });
  it("rejects plain text and html", () => {
    assert.equal(looksLikeSvg("hello world"), false);
    assert.equal(looksLikeSvg("<!DOCTYPE html><html></html>"), false);
  });
});

describe("limits", () => {
  it("exposes raster 20MB and svg 2MB caps", () => {
    assert.equal(MAX_IMAGE_BYTES, 20 * 1024 * 1024);
    assert.equal(MAX_SVG_BYTES, 2 * 1024 * 1024);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/image-types.test.ts`
Expected: FAIL — cannot find module `../src/image-types.js`.

- [ ] **Step 3: Write the module**

Create `src/image-types.ts`:

```ts
// src/image-types.ts
// Server-side detection of image content types. Raster types are detected from
// magic bytes in the first 32 bytes; SVG is a text format probed separately.

export type ImageKind = "raster" | "svg";
export interface DetectedImage { kind: ImageKind; mime: string }

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_SVG_BYTES = 2 * 1024 * 1024;
export const SVG_PROBE_BYTES = 4096;

function asciiAt(bytes: Uint8Array, offset: number, expected: string): boolean {
  for (let i = 0; i < expected.length; i += 1) {
    if (bytes[offset + i] !== expected.charCodeAt(i)) return false;
  }
  return true;
}

export function detectImageType(header: Uint8Array): DetectedImage | null {
  const b = (i: number): number => header[i] ?? -1;
  if (b(0) === 0x89 && asciiAt(header, 1, "PNG") && b(4) === 0x0d && b(5) === 0x0a && b(6) === 0x1a && b(7) === 0x0a) {
    return { kind: "raster", mime: "image/png" };
  }
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) {
    return { kind: "raster", mime: "image/jpeg" };
  }
  if (asciiAt(header, 0, "GIF87a") || asciiAt(header, 0, "GIF89a")) {
    return { kind: "raster", mime: "image/gif" };
  }
  if (asciiAt(header, 0, "RIFF") && asciiAt(header, 8, "WEBP")) {
    return { kind: "raster", mime: "image/webp" };
  }
  if (asciiAt(header, 4, "ftyp")) {
    const brand = String.fromCharCode(b(8), b(9), b(10), b(11));
    if (brand === "avif" || brand === "avis") {
      return { kind: "raster", mime: "image/avif" };
    }
  }
  return null;
}

export function looksLikeSvg(sample: string): boolean {
  const window = sample.slice(0, SVG_PROBE_BYTES);
  return /<(?:[a-zA-Z0-9_-]+:)?svg[\s>]/.test(window);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test test/image-types.test.ts`
Expected: PASS.

- [ ] **Step 5: Full gate + commit**

Run: `npm run typecheck && npm test && npm run build`
Commit:

```bash
git add src/image-types.ts test/image-types.test.ts
git commit -m "feat(fs-api): magic-byte image type detection and size caps"
```

---

### Task 4: Server `/cap` and `/raw` routes + integration tests

**Files:**
- Modify: `src/fs-api.ts`
- Test: `test/raw-api.test.ts` (new; duplicates the small http request helper — the helper in fs-api.test.ts is file-local)

**Interfaces:**
- Consumes: `createCapabilityIssuer`/capabilities module (Task 2), `detectImageType`/`looksLikeSvg`/caps (Task 3), existing `send`/`isInside`/`resolveRoot`.
- Produces: HTTP endpoints `GET /filemanager-fs/cap?hint=` → `{cap}`, and `GET /filemanager-fs/raw?hint=&path=&cap=` streaming image bytes; `CreateHandlerOptions.capabilities? : CapabilityIssuer` (test injection).

- [ ] **Step 1: Write the failing integration tests**

Create `test/raw-api.test.ts`:

```ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createGitStatusCache } from "../src/git-status-cache.js";
import { createHandler } from "../src/fs-api.js";
import { createCapabilityIssuer } from "../src/capabilities.js";

function request(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  path: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => { await handler(req, res); });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      fetch("http://127.0.0.1:" + addr.port + path, { headers })
        .then(async (res) => {
          const body = Buffer.from(await res.arrayBuffer());
          server.close();
          resolve({ status: res.status, headers: res.headers, body });
        })
        .catch((err) => { server.close(); reject(err); });
    });
  });
}

const PNG_HEADER = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
const hdr = { "x-dsh-filemanager": "1" };

describe("GET /filemanager-fs/cap", () => {
  let dir: string; let handler: ReturnType<typeof createHandler>;
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "raw-api-test-"));
    handler = createHandler(dir, { gitStatusCache: createGitStatusCache({ ttlMs: 0, collect: async () => new Map() }) });
  });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it("mints a cap only with the header", async () => {
    const ok = await request(handler, "/filemanager-fs/cap?hint=" + encodeURIComponent(dir), hdr);
    assert.equal(ok.status, 200);
    const cap = JSON.parse(ok.body.toString()) as { cap: string };
    assert.ok(typeof cap.cap === "string" && cap.cap.length >= 32);
    const denied = await request(handler, "/filemanager-fs/cap?hint=" + encodeURIComponent(dir));
    assert.equal(denied.status, 403);
  });
});

describe("GET /filemanager-fs/raw", () => {
  let dir: string; let handler: ReturnType<typeof createHandler>;
  let cap: string;
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "raw-api-test-"));
    handler = createHandler(dir, { gitStatusCache: createGitStatusCache({ ttlMs: 0, collect: async () => new Map() }) });
    const r = await request(handler, "/filemanager-fs/cap?hint=" + encodeURIComponent(dir), hdr);
    cap = (JSON.parse(r.body.toString()) as { cap: string }).cap;
    await writeFile(join(dir, "pic.png"), Buffer.concat([PNG_HEADER, Buffer.alloc(64)]));
    await writeFile(join(dir, "pic.svg"), SVG);
    await writeFile(join(dir, "note.txt"), "hello");
  });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it("serves raster bytes without the header when cap is valid", async () => {
    const res = await request(handler, "/filemanager-fs/raw?hint=" + encodeURIComponent(dir) + "&path=pic.png&cap=" + encodeURIComponent(cap));
    assert.equal(res.status, 200);
    assert.equal(res.headers["content-type"], "image/png");
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.equal(res.headers["cache-control"], "no-store");
    assert.deepEqual(res.body, Buffer.concat([PNG_HEADER, Buffer.alloc(64)]));
  });

  it("serves svg with a sandbox CSP header", async () => {
    const res = await request(handler, "/filemanager-fs/raw?hint=" + encodeURIComponent(dir) + "&path=pic.svg&cap=" + encodeURIComponent(cap));
    assert.equal(res.status, 200);
    assert.equal(res.headers["content-type"], "image/svg+xml");
    assert.equal(res.headers["content-security-policy"], "sandbox");
  });

  it("rejects a missing or wrong cap with 403 even with the header", async () => {
    const missing = await request(handler, "/filemanager-fs/raw?hint=" + encodeURIComponent(dir) + "&path=pic.png", hdr);
    assert.equal(missing.status, 403);
    const wrong = await request(handler, "/filemanager-fs/raw?hint=" + encodeURIComponent(dir) + "&path=pic.png&cap=deadbeef");
    assert.equal(wrong.status, 403);
  });

  it("rejects an expired cap (injected issuer)", async () => {
    let now = 1_000;
    const injectable = createHandler(dir, {
      capabilities: createCapabilityIssuer({ now: () => now, ttlMs: 50, randomToken: () => "tok" }),
      gitStatusCache: createGitStatusCache({ ttlMs: 0, collect: async () => new Map() }),
    });
    const minted = await request(injectable, "/filemanager-fs/cap?hint=" + encodeURIComponent(dir), hdr);
    const c = (JSON.parse(minted.body.toString()) as { cap: string }).cap;
    now += 51;
    const res = await request(injectable, "/filemanager-fs/raw?hint=" + encodeURIComponent(dir) + "&path=pic.png&cap=" + encodeURIComponent(c));
    assert.equal(res.status, 403);
  });

  it("rejects traversal (403) and missing files (404)", async () => {
    const trav = await request(handler, "/filemanager-fs/raw?hint=" + encodeURIComponent(dir) + "&path=../secret&cap=" + encodeURIComponent(cap));
    assert.equal(trav.status, 403);
    const miss = await request(handler, "/filemanager-fs/raw?hint=" + encodeURIComponent(dir) + "&path=nope.png&cap=" + encodeURIComponent(cap));
    assert.equal(miss.status, 404);
  });

  it("returns 415 for non-image files", async () => {
    const res = await request(handler, "/filemanager-fs/raw?hint=" + encodeURIComponent(dir) + "&path=note.txt&cap=" + encodeURIComponent(cap));
    assert.equal(res.status, 415);
  });

  it("returns 413 for an svg over the 2MB cap", async () => {
    await writeFile(join(dir, "big.svg"), "<svg>" + "x".repeat(2 * 1024 * 1024));
    const res = await request(handler, "/filemanager-fs/raw?hint=" + encodeURIComponent(dir) + "&path=big.svg&cap=" + encodeURIComponent(cap));
    assert.equal(res.status, 413);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/raw-api.test.ts`
Expected: FAIL — `cap`/raw routes not implemented (404 unknown action).

- [ ] **Step 3: Implement the routes in src/fs-api.ts**

Modify imports at the top of `src/fs-api.ts`:

```ts
import { readdir, stat, realpath, lstat, open } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { resolve, sep, basename, join } from "node:path";
import { createEventsHandler } from "./fs-events.js";
import { createGitStatusCache, type SnapshotCache } from "./git-status-cache.js";
import { createCapabilityIssuer, type CapabilityIssuer } from "./capabilities.js";
import { detectImageType, looksLikeSvg, MAX_IMAGE_BYTES, MAX_SVG_BYTES } from "./image-types.js";
```

Add `capabilities?` to `CreateHandlerOptions`:

```ts
export interface CreateHandlerOptions {
  /** Override the per-handler git-status cache (tests inject spies). */
  gitStatusCache?: GitStatusCache;
  /** Override the capability issuer (tests inject expiry/rotation). */
  capabilities?: CapabilityIssuer;
}
```

Add a module-level helper above `createHandler`:

```ts
async function serveRawImage(
  res: ServerResponse,
  root: string,
  hint: string,
  capabilities: CapabilityIssuer,
  params: { path: string | null; cap: string | null },
): Promise<void> {
  const cap = params.cap;
  if (!cap || !capabilities.isValid(hint, cap)) {
    return send(res, 403, { error: "invalid or expired capability" });
  }
  const relPath = params.path ?? "";
  const target = resolve(root, relPath);
  if (!isInside(root, target)) {
    return send(res, 403, { error: "path escapes workspace" });
  }
  const realTarget = await realpath(target).catch(() => null);
  if (!realTarget) {
    return send(res, 404, { error: "not found" });
  }
  if (!isInside(root, realTarget)) {
    return send(res, 403, { error: "path escapes workspace" });
  }
  const st = await stat(realTarget);
  if (!st.isFile()) {
    return send(res, 400, { error: "not a file" });
  }

  const fh = await open(realTarget, "r");
  let detected: ReturnType<typeof detectImageType> = null;
  try {
    const headerSize = Math.min(st.size, 32);
    const header = Buffer.alloc(headerSize);
    if (headerSize > 0) await fh.read(header, 0, headerSize, 0);
    detected = detectImageType(header);
    if (!detected && st.size <= MAX_SVG_BYTES) {
      const sampleSize = Math.min(st.size, 4096);
      const sample = Buffer.alloc(sampleSize);
      if (sampleSize > 0) await fh.read(sample, 0, sampleSize, 0);
      if (looksLikeSvg(sample.toString("latin1"))) {
        detected = { kind: "svg", mime: "image/svg+xml" };
      }
    }
  } finally {
    await fh.close();
  }

  if (!detected) {
    return send(res, 415, { error: "unsupported content type" });
  }
  if (detected.kind === "svg" && st.size > MAX_SVG_BYTES) {
    return send(res, 413, { error: "image too large" });
  }
  if (detected.kind === "raster" && st.size > MAX_IMAGE_BYTES) {
    return send(res, 413, { error: "image too large" });
  }

  res.writeHead(200, {
    "content-type": detected.mime,
    "content-length": String(st.size),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...(detected.kind === "svg" ? { "content-security-policy": "sandbox" } : {}),
  });
  const stream = createReadStream(realTarget);
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}
```

Modify `createHandler` — replace the header gate and add the two actions. Current code reads:

```ts
export function createHandler(defaultRoot: string, options: CreateHandlerOptions = {}) {
  const gitCache =
    options.gitStatusCache ??
    createGitStatusCache<GitEntry>({ collect: runGitStatus });
  const eventsHandler = createEventsHandler(defaultRoot, gitCache);
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
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
```

Replace with:

```ts
export function createHandler(defaultRoot: string, options: CreateHandlerOptions = {}) {
  const gitCache =
    options.gitStatusCache ??
    createGitStatusCache<GitEntry>({ collect: runGitStatus });
  const eventsHandler = createEventsHandler(defaultRoot, gitCache);
  const capabilities = options.capabilities ?? createCapabilityIssuer();
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);

      if (parts[0] !== "filemanager-fs" || parts.length < 2) {
        return send(res, 404, { error: "not found" });
      }

      const action = parts[1];
      // /raw is the only action reachable without the header: plain <img>
      // tags cannot send headers, so /raw authenticates with a capability
      // token instead. Every other action keeps the header gate.
      if (action !== "raw" && req.headers["x-dsh-filemanager"] !== "1") {
        return send(res, 403, { error: "missing x-dsh-filemanager header" });
      }

      const hint = url.searchParams.get("hint");
      const effectiveHint = hint && hint.length > 0 ? hint : defaultRoot;
      const root = await resolveRoot(hint, defaultRoot);
```

Add `case "cap":` and `case "raw":` to the switch, right after `case "root":`:

```ts
        case "cap":
          return send(res, 200, { cap: capabilities.issueFor(effectiveHint) });

        case "raw":
          return serveRawImage(res, root, effectiveHint, capabilities, {
            path: url.searchParams.get("path"),
            cap: url.searchParams.get("cap"),
          });
```

Notes:
- `isInside` checks happen inside `serveRawImage`; the capability check runs first so bad tokens never probe the filesystem.
- `root` was already resolved from `hint`; the raw path is relative to it, mirroring `/read`.
- Existing `/read`, `/list`, `/root`, `/events` behaviors and error bodies are unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test test/raw-api.test.ts`
Expected: PASS (all `/cap` and `/raw` tests).

- [ ] **Step 5: Full gate + commit**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green — including the pre-existing `test/fs-api.test.ts` header-gate tests (their routes still require the header).
Commit:

```bash
git add src/fs-api.ts test/raw-api.test.ts
git commit -m "feat(fs-api): /cap capability minting and /raw image serving endpoints"
```

---

### Task 5: Register `json` in the hljs language set

**Files:**
- Modify: `src/syntax-highlighting.ts`
- Test: `test/syntax-highlighting.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `SupportedLanguage` now includes `"json"`; `detectLanguage("x.json", ...)` returns `"json"`; `highlightSource` highlights valid JSON. Used by Tasks 8/11 for the JSON pretty view.

- [ ] **Step 1: Add failing tests**

Append to `test/syntax-highlighting.test.ts` (match the file's existing import style — it imports from `../src/syntax-highlighting.js`):

```ts
test("detects json and highlights it", () => {
  assert.equal(detectLanguage("config.json", "{}"), "json");
  const source = JSON.stringify({ a: [1, true], b: "x" }, null, 2);
  const { highlighted, html } = highlightSource("config.json", source);
  assert.equal(highlighted, true);
  assert.ok(html && html.includes("hljs"));
  assert.ok(html && html.includes("1"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/syntax-highlighting.test.ts`
Expected: FAIL — `detectLanguage("config.json") === null` and `highlighted === false`.

- [ ] **Step 3: Implement**

In `src/syntax-highlighting.ts`:

```ts
import json from "highlight.js/lib/languages/json";

export type SupportedLanguage =
  | "typescript" | "javascript" | "python" | "go" | "csharp" | "rust" | "json";
```

Add `json: "json"` to `LANGUAGE_ALIASES`, and include `json` in the registration loop:

```ts
const LANGUAGE_ALIASES: Record<string, SupportedLanguage> = {
  // ...existing entries...
  json: "json",
};

for (const [language, definition] of Object.entries({ typescript, javascript, python, go, csharp, rust, json })) {
  hljs.registerLanguage(language, definition);
}
```

- [ ] **Step 4: Run tests + gate + commit**

Run: `npx tsx --test test/syntax-highlighting.test.ts`, then `npm run typecheck && npm test && npm run build`.
Commit:

```bash
git add src/syntax-highlighting.ts test/syntax-highlighting.test.ts
git commit -m "feat(preview): register json in highlight.js language set"
```

---

### Task 6: Client cap fetch + memoized cache + raw URL builder

**Files:**
- Modify: `src/preview-api.ts` (`fetchCap`)
- Create: `src/caps.ts`, `test/caps.test.ts`
- Create: `src/raw-url.ts`

**Interfaces:**
- Consumes: existing `fetchJson` helper in `preview-api.ts`.
- Produces:

```ts
// preview-api.ts
export function fetchCap(hint: string): Promise<string>;

// caps.ts — memoized per-hint cache, injectable fetcher for tests
export interface CapCache { getCap(hint: string): Promise<string>; invalidate(hint: string): void; }
export function createCapCache(fetch: (hint: string) => Promise<string>): CapCache;
export const capCache: CapCache; // app instance backed by fetchCap

// raw-url.ts — pure; version bumps the URL so <img> re-requests after a refresh
export function buildRawFileUrl(hint: string, path: string, cap: string, version?: number): string;
```

- [ ] **Step 1: Write the failing tests**

Create `test/caps.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCapCache } from "../src/caps.js";
import { buildRawFileUrl } from "../src/raw-url.js";

describe("capCache", () => {
  it("fetches once per hint and reuses the resolved value", async () => {
    let calls = 0;
    const cache = createCapCache(async () => { calls += 1; return "cap-" + calls; });
    const a = await cache.getCap("/ws");
    const b = await cache.getCap("/ws");
    assert.equal(a, "cap-1");
    assert.equal(b, "cap-1");
    assert.equal(calls, 1);
  });
  it("keeps per-hint entries separate", async () => {
    let n = 0;
    const cache = createCapCache(async () => { n += 1; return "t" + n; });
    const a = await cache.getCap("/a");
    const b = await cache.getCap("/b");
    assert.equal(a, "t1");
    assert.equal(b, "t2");
  });
  it("invalidate forces a refetch", async () => {
    let n = 0;
    const cache = createCapCache(async () => { n += 1; return "t" + n; });
    assert.equal(await cache.getCap("/ws"), "t1");
    cache.invalidate("/ws");
    assert.equal(await cache.getCap("/ws"), "t2");
  });
  it("clears the rejected promise so a retry can succeed", async () => {
    let fail = true;
    const cache = createCapCache(async () => {
      if (fail) throw new Error("boom");
      return "ok";
    });
    await assert.rejects(() => cache.getCap("/ws"), /boom/);
    fail = false;
    assert.equal(await cache.getCap("/ws"), "ok");
  });
});

describe("buildRawFileUrl", () => {
  it("encodes hint, path and cap", () => {
    const url = buildRawFileUrl("/ws a", "dir/pic x.png", "tok/+=");
    assert.equal(url, "/filemanager-fs/raw?hint=%2Fws%20a&path=dir%2Fpic%20x.png&cap=tok%2F%2B%3D");
  });
  it("appends a version query when given", () => {
    const url = buildRawFileUrl("/ws", "pic.png", "cap", 3);
    assert.ok(url.endsWith("&v=3"));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test test/caps.test.ts`
Expected: FAIL — cannot find modules `../src/caps.js` / `../src/raw-url.js`.

- [ ] **Step 3: Implement**

Add to `src/preview-api.ts` (after `fetchFile`):

```ts
export interface CapResponse {
  cap: string;
}

export function fetchCap(hint: string): Promise<string> {
  const url = "/filemanager-fs/cap?hint=" + encodeURIComponent(hint);
  return fetchJson<CapResponse>(url).then((data) => data.cap);
}
```

Create `src/raw-url.ts`:

```ts
// src/raw-url.ts

export function buildRawFileUrl(hint: string, path: string, cap: string, version = 0): string {
  const params = new URLSearchParams({ hint, path, cap });
  if (version > 0) params.set("v", String(version));
  return "/filemanager-fs/raw?" + params.toString();
}
```

Create `src/caps.ts`:

```ts
// src/caps.ts
import { fetchCap } from "./preview-api.js";

export interface CapCache {
  getCap(hint: string): Promise<string>;
  invalidate(hint: string): void;
}

export function createCapCache(fetch: (hint: string) => Promise<string>): CapCache {
  const entries = new Map<string, Promise<string>>();
  return {
    getCap(hint: string): Promise<string> {
      let promise = entries.get(hint);
      if (!promise) {
        promise = fetch(hint).catch((error) => {
          entries.delete(hint);
          throw error;
        });
        entries.set(hint, promise);
      }
      return promise;
    },
    invalidate(hint: string): void {
      entries.delete(hint);
    },
  };
}

export const capCache: CapCache = createCapCache(fetchCap);
```

- [ ] **Step 4: Run tests + gate + commit**

Run: `npx tsx --test test/caps.test.ts`, then `npm run typecheck && npm test && npm run build`.
Commit:

```bash
git add src/preview-api.ts src/caps.ts src/raw-url.ts test/caps.test.ts
git commit -m "feat(preview): fetchCap client, memoized cap cache, raw URL builder"
```

---

### Task 7: Markdown renders workspace-local images via raw URLs

**Files:**
- Modify: `src/markdown-preview.ts`
- Test: `test/markdown-preview.test.ts`

**Interfaces:**
- Consumes: `buildRawFileUrl` (Task 6).
- Produces:

```ts
export interface MarkdownRenderOptions {
  filePath: string;
  workspaceHint: string;
  /** When provided, safe workspace-local image resources are emitted as
   *  <img src="...">; absent → local images stay stripped. */
  resourceUrl?: (resource: string) => string | null;
}
export interface MarkdownRenderResult {
  html: string;
  blockedExternalImages: number;
  // NOTE: unavailableLocalImages is removed this cycle.
}
// Pure; shares the containment checks with workspaceResourceUrl:
export function rawMarkdownImageUrl(hint: string, markdownPath: string, resource: string, cap: string): string | null;
```

`workspaceResourceUrl` keeps its exact exported signature and semantics; its validation core is extracted so both builders reuse it.

- [ ] **Step 1: Update the tests (red)**

In `test/markdown-preview.test.ts`:
- Import `rawMarkdownImageUrl`.
- Replace the test `"reports unavailable local images instead of emitting JSON read URLs"` with:

```ts
test("emits raw URLs for safe local images when resourceUrl is provided", () => {
  const { html, blockedExternalImages } = renderMarkdown("![local](images/a.png)", {
    filePath: "docs/README.md",
    workspaceHint: "/workspace",
    resourceUrl: (resource) => rawMarkdownImageUrl("/workspace", "docs/README.md", resource, "cap123"),
  });
  assert.equal(blockedExternalImages, 0);
  assert.ok(html.includes("/filemanager-fs/raw?"));
  assert.ok(html.includes("cap123"));
  assert.ok(html.includes('alt="local"'));
});
```

- Update `"removes external images and counts them"` (the old assertion `html.includes("images/a.png") === false` no longer holds once a builder emits local images):

```ts
test("removes external images and counts them; local images render via resourceUrl", () => {
  const source = ["![remote](https://example.com/a.png)", "", "![local](images/a.png)"].join(String.fromCharCode(10));
  const { html, blockedExternalImages } = renderMarkdown(source, {
    filePath: "docs/README.md",
    workspaceHint: "/workspace",
    resourceUrl: (resource) => rawMarkdownImageUrl("/workspace", "docs/README.md", resource, "cap123"),
  });
  assert.equal(blockedExternalImages, 1);
  assert.equal(html.includes("example.com"), false);
  assert.ok(html.includes("/filemanager-fs/raw?"));
});
```

- Add builder path-safety tests:

```ts
test("rawMarkdownImageUrl applies the same containment checks as workspaceResourceUrl", () => {
  assert.equal(rawMarkdownImageUrl("/ws", "README.md", "../etc/passwd", "c"), null);
  assert.equal(rawMarkdownImageUrl("/ws", "README.md", "http://evil/x.png", "c"), null);
  assert.equal(rawMarkdownImageUrl("/ws", "README.md", "a/../../b.png", "c"), null);
  assert.ok(rawMarkdownImageUrl("/ws", "docs/guide.md", "img/x.png", "c")?.includes("path=docs%2Fimg%2Fx.png"));
  assert.ok(rawMarkdownImageUrl("/ws", "docs/guide.md", "./img/x.png", "c")?.includes("path=docs%2Fimg%2Fx.png"));
});
```

Delete any remaining destructure of `unavailableLocalImages`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test test/markdown-preview.test.ts`
Expected: FAIL — module has no export `rawMarkdownImageUrl`; `unavailableLocalImages` still in the result.

- [ ] **Step 3: Implement**

In `src/markdown-preview.ts`:

- Import `buildRawFileUrl` from `./raw-url.js`.
- Extract the validation core and add the raw builder:

```ts
function resolveWorkspaceResource(markdownPath: string, resource: string): string | null {
  const normalizedMarkdown = markdownPath.replaceAll("\\", "/");
  let decodedMarkdown: string;
  try { decodedMarkdown = decodeURIComponent(normalizedMarkdown); } catch { return null; }
  if (!decodedMarkdown || decodedMarkdown.includes("\\") || decodedMarkdown.startsWith("/") || decodedMarkdown.startsWith("//") || /^[A-Za-z]:\//.test(decodedMarkdown) || decodedMarkdown.split("/").includes("..")) return null;
  const raw = resource.trim();
  if (!raw || isUnsafeUrl(raw) || isExternalUrl(raw)) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(raw); } catch { return null; }
  if (decoded.includes("\\") || decoded.startsWith("/") || decoded.startsWith("//")) return null;
  if (decoded.split("/").includes("..")) return null;
  const directory = decodedMarkdown.includes("/") ? decodedMarkdown.slice(0, decodedMarkdown.lastIndexOf("/")) : "";
  const combined = [directory, decoded].filter(Boolean).join("/");
  if (combined === ".." || combined.startsWith("../") || combined.includes("/../")) return null;
  return combined;
}

export function workspaceResourceUrl(hint: string, markdownPath: string, resource: string): string | null {
  const combined = resolveWorkspaceResource(markdownPath, resource);
  if (!combined) return null;
  return READ_PATH + "?" + new URLSearchParams({ hint, path: combined }).toString();
}

export function rawMarkdownImageUrl(hint: string, markdownPath: string, resource: string, cap: string): string | null {
  const combined = resolveWorkspaceResource(markdownPath, resource);
  if (!combined) return null;
  return buildRawFileUrl(hint, combined, cap);
}
```

- Update the result type and the `<img>` rewriter. Replace the img block:

```ts
  html = html.replace(/<img\b([^>]*?)\bsrc=(['"])(.*?)\2([^>]*)>/gi, (_full, before, quote, src, after) => {
    if (isExternalUrl(src) || isUnsafeUrl(src)) { blockedExternalImages += 1; return ""; }
    unavailableLocalImages += 1;
    return "";
  });
```

with:

```ts
  html = html.replace(/<img\b([^>]*?)\bsrc=(['"])(.*?)\2([^>]*)>/gi, (_full, before, quote, src, after) => {
    if (isExternalUrl(src) || isUnsafeUrl(src)) { blockedExternalImages += 1; return ""; }
    if (options.resourceUrl) {
      const url = options.resourceUrl(src.trim());
      if (url) return '<img' + before + 'src="' + url + '"' + after + '>';
    }
    return "";
  });
```

- Remove `unavailableLocalImages` from `MarkdownRenderResult`, stop incrementing it, and return only `{ html, blockedExternalImages }`.
- Keep the `sanitize()` config unchanged. In Step 4 verify the absolute path `/filemanager-fs/raw?...` (no scheme) survives DOMPurify; only if a test proves it is stripped, extend the DOMPurify config with an `ALLOWED_URI_REGEXP` matching `^\\/filemanager-fs\\/raw\\?`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test test/markdown-preview.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

Run: `npm run typecheck && npm test && npm run build`
Commit:

```bash
git add src/markdown-preview.ts test/markdown-preview.test.ts
git commit -m "feat(preview): render workspace-local markdown images via capability raw URLs"
```

---

### Task 8: JSON format decisions + preview-kind classifier (pure, tested)

**Files:**
- Create: `src/json-view.ts`, `test/json-view.test.ts`
- Create: `src/preview-kind.ts`, `test/preview-kind.test.ts`

**Interfaces:**
- Consumes: `isMarkdownFile` (markdown-preview).
- Produces:

```ts
// json-view.ts
export type JsonViewMode = "raw" | "pretty";
export const JSON_PRETTY_MAX_CHARS: number; // 1_000_000
export function isJsonFile(name: string): boolean;
export interface JsonDisplay { text: string; note: "parse" | "too-large" | null; }
export function formatJson(content: string, mode: JsonViewMode, truncated: boolean): JsonDisplay;

// preview-kind.ts
export type PreviewKind = "text" | "markdown" | "json" | "image";
export function isImageFileName(name: string): boolean;
export function classifyPreviewKind(name: string): PreviewKind; // image > markdown > json > text
```

- [ ] **Step 1: Write the failing tests**

Create `test/json-view.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isJsonFile, formatJson, JSON_PRETTY_MAX_CHARS } from "../src/json-view.js";

describe("isJsonFile", () => {
  it("matches .json case-insensitively", () => {
    assert.equal(isJsonFile("config.json"), true);
    assert.equal(isJsonFile("a.JSON"), true);
    assert.equal(isJsonFile("config.jsonc"), false);
    assert.equal(isJsonFile("package.json.orig"), false);
  });
});

describe("formatJson", () => {
  const pretty = (content: string) => formatJson(content, "pretty", false);
  it("formats valid json with two-space indent", () => {
    const { text, note } = pretty('{"b":1,"a":[true,null]}');
    assert.equal(text, '{\n  "b": 1,\n  "a": [\n    true,\n    null\n  ]\n}');
    assert.equal(note, null);
  });
  it("keeps raw mode untouched", () => {
    const { text, note } = formatJson('{"a":1}', "raw", false);
    assert.equal(text, '{"a":1}');
    assert.equal(note, null);
  });
  it("falls back to raw with a parse note on invalid json", () => {
    const { text, note } = pretty("{ nope");
    assert.equal(text, "{ nope");
    assert.equal(note, "parse");
  });
  it("falls back to raw with a too-large note over the cap", () => {
    const big = '{"pad":"' + "x".repeat(JSON_PRETTY_MAX_CHARS) + '"}';
    const { text, note } = pretty(big);
    assert.equal(text, big);
    assert.equal(note, "too-large");
  });
  it("does not attempt pretty on truncated files", () => {
    const { note } = formatJson('{"a":1}', "pretty", true);
    assert.equal(note, null);
  });
});
```

Create `test/preview-kind.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyPreviewKind, isImageFileName } from "../src/preview-kind.js";

describe("classifyPreviewKind", () => {
  it("classifies image extensions", () => {
    for (const name of ["a.png", "b.JPG", "c.webp", "d.svg", "e.gif", "f.avif", "g.jpeg"]) {
      assert.equal(classifyPreviewKind(name), "image", name);
    }
    assert.equal(isImageFileName("a.txt"), false);
  });
  it("gives image precedence over md/json names ending in image extensions", () => {
    assert.equal(classifyPreviewKind("x.md.png"), "image");
  });
  it("classifies markdown, json and text", () => {
    assert.equal(classifyPreviewKind("README.md"), "markdown");
    assert.equal(classifyPreviewKind("a.JSON"), "json");
    assert.equal(classifyPreviewKind("main.ts"), "text");
    assert.equal(classifyPreviewKind("noext"), "text");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test test/json-view.test.ts test/preview-kind.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement**

Create `src/json-view.ts`:

```ts
// src/json-view.ts

export type JsonViewMode = "raw" | "pretty";
export const JSON_PRETTY_MAX_CHARS = 1_000_000;

export function isJsonFile(name: string): boolean {
  return name.toLowerCase().endsWith(".json");
}

export interface JsonDisplay {
  text: string;
  note: "parse" | "too-large" | null;
}

export function formatJson(content: string, mode: JsonViewMode, truncated: boolean): JsonDisplay {
  if (mode === "raw") return { text: content, note: null };
  if (truncated) return { text: content, note: null };
  if (content.length > JSON_PRETTY_MAX_CHARS) {
    return { text: content, note: "too-large" };
  }
  try {
    return { text: JSON.stringify(JSON.parse(content), null, 2), note: null };
  } catch {
    return { text: content, note: "parse" };
  }
}
```

Create `src/preview-kind.ts`:

```ts
// src/preview-kind.ts
import { isMarkdownFile } from "./markdown-preview.js";
import { isJsonFile } from "./json-view.js";

export type PreviewKind = "text" | "markdown" | "json" | "image";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"]);

export function isImageFileName(name: string): boolean {
  const baseName = name.split(/[\\/]/).pop() ?? name;
  const dot = baseName.lastIndexOf(".");
  if (dot < 1) return false;
  return IMAGE_EXTENSIONS.has(baseName.slice(dot + 1).toLowerCase());
}

export function classifyPreviewKind(name: string): PreviewKind {
  if (isImageFileName(name)) return "image";
  if (isMarkdownFile(name)) return "markdown";
  if (isJsonFile(name)) return "json";
  return "text";
}
```

- [ ] **Step 4: Run tests + gate + commit**

Run: `npx tsx --test test/json-view.test.ts test/preview-kind.test.ts`, then `npm run typecheck && npm test && npm run build`.
Commit:

```bash
git add src/json-view.ts src/preview-kind.ts test/json-view.test.ts test/preview-kind.test.ts
git commit -m "feat(preview): json format decisions and preview-kind classifier"
```

---

### Task 9: Per-workspace `jsonMode` in the store

**Files:**
- Modify: `src/store.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:

```ts
export type JsonMode = "raw" | "pretty";
// FileManagerState gains: jsonMode: JsonMode;  (default "pretty")
// FileManagerStore gains: setJsonMode(mode: JsonMode): void;
// localStorage key prefix: "dsh-filemanager-json-mode:"
// Default when nothing stored: "pretty"; loaded in setWorkspace like previewMode.
```

- [ ] **Step 1: Implement (mirror previewMode exactly)**

In `src/store.ts`:

```ts
const LS_JSON_MODE_PREFIX = "dsh-filemanager-json-mode:";
export type JsonMode = "raw" | "pretty";
```

Add `jsonMode: JsonMode` to `FileManagerState` and `setJsonMode(mode: JsonMode): void` to `FileManagerStore`. Add load/save helpers after the previewMode ones:

```ts
function getJsonModeKey(workspaceHint: string): string {
  return LS_JSON_MODE_PREFIX + encodeURIComponent(workspaceHint);
}
function loadJsonMode(workspaceHint: string | null): JsonMode {
  if (!workspaceHint) return "pretty";
  try {
    return localStorage.getItem(getJsonModeKey(workspaceHint)) === "raw" ? "raw" : "pretty";
  } catch {
    return "pretty";
  }
}
function saveJsonMode(workspaceHint: string | null, mode: JsonMode): void {
  if (!workspaceHint) return;
  try { localStorage.setItem(getJsonModeKey(workspaceHint), mode); } catch {}
}
```

Wire it: initial state `jsonMode: "pretty"`; in `setWorkspace` add `jsonMode: loadJsonMode(workspaceHint)` to the new state; add `setJsonMode` mirroring `setPreviewMode` (save + notify listeners).

- [ ] **Step 2: Gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: green (no dedicated store unit file; typecheck + full-suite regression cover it).

- [ ] **Step 3: Commit**

```bash
git add src/store.ts
git commit -m "feat(preview): per-workspace json raw/pretty mode in store"
```

---

### Task 10: Image viewer — pure zoom logic, component, styles, l10n keys, Panel image flow

**Files:**
- Create: `src/image-view.ts`, `test/image-view.test.ts`
- Create: `src/ImageView.tsx`
- Modify: `src/l10n.ts` (add image keys, remove `localImagesUnavailable` from en+ru)
- Modify: `src/styles.ts`
- Modify: `src/Panel.tsx` (image open flow, image refresh, hint effect, image body)

**Interfaces:**
- Consumes: `buildRawFileUrl` (T6), `capCache` (T6), `classifyPreviewKind` (T8), `useL10n` (existing).
- Produces:

```ts
// image-view.ts — pure zoom state
export const ZOOM_MIN = 0.1; export const ZOOM_MAX = 8; export const ZOOM_STEP = 1.25;
export type ZoomMode = "fit" | "custom";
export interface ZoomState { mode: ZoomMode; scale: number }
export const initialZoom: ZoomState; // { mode: "fit", scale: 1 }
export function zoomIn(state: ZoomState): ZoomState;
export function zoomOut(state: ZoomState): ZoomState;
export function setFitZoom(): ZoomState;
export function toggleZoom(state: ZoomState): ZoomState; // fit -> custom 100%; custom -> fit

// ImageView.tsx
export interface ImageViewProps { src: string; onRetry: () => void; }
export function ImageView(props: ImageViewProps): JSX.Element;
```

New l10n keys (both dictionaries): `zoomIn`, `zoomOut`, `zoomFit`, `zoomOriginal`, `imageToolbar`, `openOriginal`, `imageLoadFailed`, `imageTooLarge`. Remove: `localImagesUnavailable`.

- [ ] **Step 1: Write the failing zoom tests**

Create `test/image-view.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { initialZoom, zoomIn, zoomOut, setFitZoom, toggleZoom, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP } from "../src/image-view.js";

describe("zoom state", () => {
  it("starts fitted", () => {
    assert.deepEqual(initialZoom, { mode: "fit", scale: 1 });
  });
  it("zoomIn from fit enters custom at ZOOM_STEP", () => {
    const z = zoomIn(initialZoom);
    assert.equal(z.mode, "custom");
    assert.equal(z.scale, ZOOM_STEP);
  });
  it("zoomIn/zoomOut multiply and clamp between ZOOM_MIN and ZOOM_MAX", () => {
    let z = zoomIn(zoomIn(initialZoom));
    assert.equal(z.scale, ZOOM_STEP * ZOOM_STEP);
    for (let i = 0; i < 30; i += 1) z = zoomIn(z);
    assert.equal(z.scale, ZOOM_MAX);
    for (let i = 0; i < 60; i += 1) z = zoomOut(z);
    assert.equal(z.scale, ZOOM_MIN);
  });
  it("zoomOut from fit stays fit", () => {
    assert.deepEqual(zoomOut(initialZoom), initialZoom);
  });
  it("setFitZoom resets", () => {
    assert.deepEqual(setFitZoom(), initialZoom);
  });
  it("toggleZoom switches fit <-> custom 100%", () => {
    const custom = toggleZoom(initialZoom);
    assert.deepEqual(custom, { mode: "custom", scale: 1 });
    assert.deepEqual(toggleZoom(custom), initialZoom);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test test/image-view.test.ts`
Expected: FAIL — cannot find module `../src/image-view.js`.

- [ ] **Step 3: Implement src/image-view.ts**

```ts
// src/image-view.ts

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 8;
export const ZOOM_STEP = 1.25;

export type ZoomMode = "fit" | "custom";
export interface ZoomState {
  mode: ZoomMode;
  scale: number;
}

export const initialZoom: ZoomState = { mode: "fit", scale: 1 };

function clampScale(scale: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale));
}

export function zoomIn(state: ZoomState): ZoomState {
  if (state.mode === "fit") return { mode: "custom", scale: ZOOM_STEP };
  return { mode: "custom", scale: clampScale(state.scale * ZOOM_STEP) };
}

export function zoomOut(state: ZoomState): ZoomState {
  if (state.mode === "fit") return state;
  return { mode: "custom", scale: clampScale(state.scale / ZOOM_STEP) };
}

export function setFitZoom(): ZoomState {
  return initialZoom;
}

export function toggleZoom(state: ZoomState): ZoomState {
  return state.mode === "fit" ? { mode: "custom", scale: 1 } : initialZoom;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --test test/image-view.test.ts`
Expected: PASS.

- [ ] **Step 5: Add l10n keys (en + ru), remove localImagesUnavailable**

In `src/l10n.ts` add to `en`:

```ts
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  zoomFit: "Fit to panel",
  zoomOriginal: "Actual size (100%)",
  imageToolbar: "Image tools",
  openOriginal: "Open original in a new tab",
  imageLoadFailed: "Image failed to load.",
  imageTooLarge: "Very large image — zoomed out; open the original for details.",
```

Remove `localImagesUnavailable` from `en`. Mirror in `ru`:

```ts
  zoomIn: "Приблизить",
  zoomOut: "Отдалить",
  zoomFit: "По размеру панели",
  zoomOriginal: "Реальный размер (100%)",
  imageToolbar: "Инструменты изображения",
  openOriginal: "Открыть оригинал в новой вкладке",
  imageLoadFailed: "Не удалось загрузить изображение.",
  imageTooLarge: "Очень большое изображение — уменьшено; для деталей откройте оригинал.",
```

Remove `localImagesUnavailable` from `ru` too (Record<L10nKey, string> enforces full-key parity). Grep the tests for `localImagesUnavailable` first — the current suite has no references, so only the dictionaries change.

- [ ] **Step 6: Add styles**

In `src/styles.ts`, before the `.fm-modal-pre` rules, add:

```css
.fm-image-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.fm-image-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--fm-border);
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  flex-wrap: wrap;
}
.fm-image-toolbar button {
  background: none;
  border: 1px solid var(--fm-border);
  border-radius: 6px;
  padding: 2px 8px;
  cursor: pointer;
  color: inherit;
  font-size: 12px;
}
.fm-image-toolbar button:hover { background: var(--fm-hover); }
.fm-image-toolbar button.is-active {
  border-color: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-brand-primary);
}
.fm-image-dims {
  margin-left: auto;
  white-space: nowrap;
}
.fm-image-stage {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px;
  background: repeating-conic-gradient(var(--fm-surface-muted) 0% 25%, var(--fm-surface) 0% 50%) 50% / 20px 20px;
}
.fm-image-stage img {
  max-width: 100%;
  max-height: 100%;
  user-select: none;
}
.fm-image-stage img.fm-image--custom {
  max-width: none;
  max-height: none;
  transform-origin: center center;
}
.fm-image-error {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
  padding: 12px;
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
}
```

- [ ] **Step 7: Create src/ImageView.tsx**

```tsx
// src/ImageView.tsx
import { useCallback, useEffect, useState } from "react";
import { useL10n } from "./use-l10n.js";
import { initialZoom, setFitZoom, toggleZoom, zoomIn, zoomOut, type ZoomState } from "./image-view.js";

const TOO_LARGE_PIXELS = 40_000_000;

export interface ImageViewProps {
  src: string;
  onRetry: () => void;
}

export function ImageView({ src, onRetry }: ImageViewProps) {
  const { t } = useL10n();
  const [zoom, setZoom] = useState<ZoomState>(initialZoom);
  const [failed, setFailed] = useState(false);
  const [tooLarge, setTooLarge] = useState(false);
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    setZoom(initialZoom);
    setFailed(false);
    setTooLarge(false);
    setDims(null);
  }, [src]);

  const handleLoad = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    setDims({ width: img.naturalWidth, height: img.naturalHeight });
    setTooLarge(img.naturalWidth * img.naturalHeight > TOO_LARGE_PIXELS);
    setFailed(false);
  }, []);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    setZoom((current) => (event.deltaY < 0 ? zoomIn(current) : zoomOut(current)));
  }, []);

  const imgStyle: React.CSSProperties =
    zoom.mode === "custom"
      ? { transform: "scale(" + zoom.scale + ")", width: dims ? dims.width : undefined }
      : {};

  return (
    <div className="fm-image-view">
      <div className="fm-image-toolbar" role="toolbar" aria-label={t("imageToolbar")}>
        <button type="button" aria-label={t("zoomOut")} title={t("zoomOut")} onClick={() => setZoom(zoomOut)}>−</button>
        <button type="button" aria-label={t("zoomIn")} title={t("zoomIn")} onClick={() => setZoom(zoomIn)}>+</button>
        <button
          type="button"
          className={zoom.mode === "fit" ? "is-active" : ""}
          aria-pressed={zoom.mode === "fit"}
          onClick={() => setZoom(setFitZoom)}
        >
          {t("zoomFit")}
        </button>
        <button
          type="button"
          className={zoom.mode === "custom" && zoom.scale === 1 ? "is-active" : ""}
          aria-pressed={zoom.mode === "custom" && zoom.scale === 1}
          onClick={() => setZoom(toggleZoom)}
        >
          {t("zoomOriginal")}
        </button>
        <button type="button" onClick={() => window.open(src, "_blank", "noopener,noreferrer")}>
          {t("openOriginal")}
        </button>
        {dims && (
          <span className="fm-image-dims">{dims.width} × {dims.height}</span>
        )}
      </div>
      <div className="fm-image-stage" onWheel={handleWheel} onDoubleClick={() => setZoom(toggleZoom)}>
        {failed ? (
          <div className="fm-image-error" role="alert">
            <span>{t("imageLoadFailed")}</span>
            <button type="button" onClick={onRetry}>{t("retry")}</button>
          </div>
        ) : (
          <img
            src={src}
            alt=""
            draggable={false}
            className={zoom.mode === "custom" ? "fm-image--custom" : undefined}
            style={imgStyle}
            onLoad={handleLoad}
            onError={() => setFailed(true)}
          />
        )}
        {!failed && tooLarge && (
          <div className="fm-preview-warning" role="status">{t("imageTooLarge")}</div>
        )}
      </div>
    </div>
  );
}
```

Note: passing a pure state-returning function to setZoom works (React calls the updater with the current state). JSON keys are added in Task 11; do not reference them in this task.

- [ ] **Step 8: Wire the image flow into Panel.tsx**

1. Add imports:

```ts
import { classifyPreviewKind } from "./preview-kind.js";
import { buildRawFileUrl } from "./raw-url.js";
import { capCache } from "./caps.js";
import { ImageView } from "./ImageView.js";
import { formatJson, type JsonDisplay } from "./json-view.js";
```

2. Add state next to the other preview states:

```ts
const [imageCap, setImageCap] = useState<string | null>(null);
const [imageVersion, setImageVersion] = useState(0);
```

3. Derive the kind each render (near `const markdownFile = ...`):

```ts
const previewKind = classifyPreviewKind(previewTitle);
const isImage = previewKind === "image";
const isJson = previewKind === "json";
```

4. Read `jsonMode` from the store (same pattern as `previewMode`):

```ts
const jsonMode = useSyncExternalStore(store.subscribe, () => store.getState().jsonMode);
```

5. Replace `handleOpenFile` so images skip `fetchFile` and resolve a capability instead; markdown fetches one best-effort:

```ts
const handleOpenFile = useCallback(async (fullPath: string, entry: Entry) => {
  if (!hint) return;
  const layout = store.getState().previewLayout;
  setPreviewPos(layout ? { x: layout.x, y: layout.y } : null);
  setPreviewSize(layout ? { width: layout.width, height: layout.height } : null);
  setPreviewTitle(entry.name);
  setPreviewPath(fullPath);
  setPreviewOpen(true);
  setPreviewLoading(true);
  setPreviewError("");
  setPreviewContent("");
  setPreviewTruncated(false);
  setChangedPreview({ kind: "idle" });
  setImageVersion(0);

  const kind = classifyPreviewKind(entry.name);
  try {
    if (kind === "image") {
      const cap = await capCache.getCap(hint);
      setImageCap(cap);
      return;
    }
    const res = await fetchFile(hint, fullPath);
    setPreviewContent(res.content);
    setPreviewTruncated(Boolean(res.truncated));
    if (kind === "markdown") {
      capCache.getCap(hint).then(setImageCap).catch(() => {});
    }
  } catch (err: any) {
    setPreviewError(err?.message ?? String(err));
  } finally {
    setPreviewLoading(false);
  }
}, [hint, store]);
```

6. Image refresh on Update — replace `handleRefreshChangedPreview`:

```ts
const handleRefreshChangedPreview = useCallback(async () => {
  if (!hint || !previewPath) return;
  if (classifyPreviewKind(previewTitle) === "image") {
    setImageVersion((v) => v + 1);
    setChangedPreview({ kind: "idle" });
    return;
  }
  setPreviewLoading(true);
  try {
    const res = await fetchFile(hint, previewPath);
    setPreviewContent(res.content);
    setPreviewTruncated(Boolean(res.truncated));
    setPreviewError("");
    setChangedPreview({ kind: "idle" });
  } catch (err: any) {
    setPreviewError(err?.message ?? String(err));
  } finally {
    setPreviewLoading(false);
  }
}, [hint, previewPath, previewTitle]);
```

7. When the hint changes with an image open, invalidate + refetch the cap and bump the version:

```ts
useEffect(() => {
  if (!hint || !previewOpen || classifyPreviewKind(previewTitle) !== "image") return;
  setImageCap(null);
  setImageVersion((v) => v + 1);
  capCache.invalidate(hint);
  capCache.getCap(hint).then(setImageCap).catch((err: any) => setPreviewError(err?.message ?? String(err)));
}, [hint, previewOpen, previewTitle]);
```

8. Compute the display content and presentation (only for non-image kinds):

```ts
const jsonDisplay: JsonDisplay | null = isJson ? formatJson(previewContent, jsonMode, previewTruncated) : null;
const displayContent = isJson && jsonDisplay ? jsonDisplay.text : previewContent;
const previewPresentation = isImage
  ? null
  : getPreviewPresentation(previewPath || previewTitle, displayContent, previewTruncated, previewMode, hint);
```

9. Body JSX: add the image branch and guard the text/md/json branch with `!isImage`; delete the md warning block that referenced `previewPresentation.unavailableLocalImages`; add the JSON notes block:

```tsx
{!previewLoading && !previewError && isImage && imageCap && (
  <ImageView
    src={buildRawFileUrl(hint, previewPath, imageCap, imageVersion)}
    onRetry={() => setImageVersion((v) => v + 1)}
  />
)}
{!previewLoading && !previewError && isJson && jsonDisplay?.note === "parse" && (
  <div className="fm-preview-warning" role="status">{t("jsonParseNote")}</div>
)}
{!previewLoading && !previewError && isJson && jsonDisplay?.note === "too-large" && (
  <div className="fm-preview-warning" role="status">{t("jsonTooLargeNote")}</div>
)}
```

Note: the JSON note keys are added in Task 11 Step 0 — if you execute tasks out of order, add the keys here (they must exist for typecheck to pass).

- [ ] **Step 9: Gate + commit**

Run: `npm run typecheck && npm test && npm run build`.
Expected: green. (The markdown `resourceUrl` wiring lands in Task 11; until then md renders without local images — same as before this cycle — so the suite stays green.)
Commit:

```bash
git add src/image-view.ts src/ImageView.tsx src/l10n.ts src/styles.ts src/Panel.tsx test/image-view.test.ts
git commit -m "feat(preview): image viewer in the dock (fit, zoom, open original, dims)"
```

---

### Task 11: Panel — JSON mode UI, markdown image wiring, final integration

**Files:**
- Modify: `src/Panel.tsx`, `src/l10n.ts`

**Interfaces:**
- Consumes: `store.jsonMode`/setJsonMode (T9), `rawMarkdownImageUrl` (T7), `imageCap` state (T10), formatJson notes (T8).
- Produces: complete dock behavior — JSON Raw/Formatted toggle, JSON pretty notes, md local images rendered via cap raw URLs, toolbar/group a11y.

- [ ] **Step 0: Add the JSON + remaining l10n keys**

In `src/l10n.ts` (en) add: `jsonMode: "JSON mode"`, `rawMode: "Raw"`, `prettyMode: "Formatted"`, `jsonParseNote: "Invalid JSON — showing the raw source."`, `jsonTooLargeNote: "File too large to format — showing the raw source."`. Mirror in ru: `jsonMode: "Режим JSON"`, `rawMode: "Исходник"`, `prettyMode: "Форматированный"`, `jsonParseNote: "Некорректный JSON — показан исходный текст."`, `jsonTooLargeNote: "Файл слишком велик для форматирования — показан исходный текст."`.

- [ ] **Step 1: Markdown — provide the resourceUrl builder when rendering**

Extend `getPreviewPresentation` with an optional cap param and pass a builder to `renderMarkdown`:

```ts
export function getPreviewPresentation(
  fileName: string,
  content: string,
  truncated: boolean,
  mode: "source" | "rendered",
  workspaceHint: string,
  imageCapForMarkdown?: string | null,
): PreviewPresentation {
  const highlighted = highlightSource(fileName, content, truncated);
  if (!isMarkdownFile(fileName) || mode === "source") {
    return highlighted.highlighted
      ? { kind: "highlighted-source", content, html: highlighted.html }
      : { kind: "source", content };
  }
  try {
    const resourceUrl = imageCapForMarkdown
      ? (resource: string) => rawMarkdownImageUrl(workspaceHint, fileName, resource, imageCapForMarkdown)
      : undefined;
    return { kind: "rendered", ...renderMarkdown(content, { filePath: fileName, workspaceHint, resourceUrl }) };
  } catch (error) {
    return { kind: "source", content, error: error instanceof Error ? error.message : String(error) };
  }
}
```

Import `rawMarkdownImageUrl` from `./markdown-preview.js`. Update the call site (from Task 10 step 8.8) to pass `imageCap` as the sixth argument. Drop `unavailableLocalImages` from the `rendered` variant of `PreviewPresentation` (already gone from renderMarkdown).

- [ ] **Step 2: JSON toggle in the header**

Next to the markdown toggle group add (guarded by `isJson`):

```tsx
{isJson && (
  <div className="fm-preview-toggle" role="group" aria-label={t("jsonMode")}>
    <button type="button" className={jsonMode === "raw" ? "is-active" : ""} aria-pressed={jsonMode === "raw"} onClick={() => store.setJsonMode("raw")}>{t("rawMode")}</button>
    <button type="button" className={jsonMode === "pretty" ? "is-active" : ""} aria-pressed={jsonMode === "pretty"} onClick={() => store.setJsonMode("pretty")}>{t("prettyMode")}</button>
  </div>
)}
```

- [ ] **Step 3: Hide failed workspace md images**

On the `.fm-markdown-content` container div (the one rendering `dangerouslySetInnerHTML`) add a capture-phase error handler that hides only failed images:

```tsx
onErrorCapture={(event) => {
  const target = event.target as HTMLElement;
  if (target instanceof HTMLImageElement && target.closest(".fm-markdown-content")) {
    target.style.display = "none";
  }
}}
```

- [ ] **Step 4: Manual smoke (documented for the reviewer)**

After `npm run build`, in the DSH web GUI with the plugin loaded:
1. Click a png/webp/svg in the tree → image fits the dock; zoom buttons + Ctrl+wheel scale; double-click toggles 100%/fit; Open original opens the raw URL in a new tab (svg sandboxed).
2. Open an .md referencing a local relative image → it renders; an external image stays absent; an intentionally broken local path is hidden without crashing.
3. Open a .json → Formatted by default; Raw/Formatted persists per workspace; invalid JSON shows raw + note.
4. Edit the previewed file on disk → banner appears; Update reloads image/json/markdown correctly.

- [ ] **Step 5: Gate + commit**

Run: `npm run typecheck && npm test && npm run build`
Commit:

```bash
git add src/Panel.tsx src/l10n.ts
git commit -m "feat(preview): JSON raw/pretty toggle UI and markdown local-image wiring"
```

---

### Task 12: Docs wrap-up — README and CHANGELOG

**Files:**
- Modify: `README.md`, `CHANGELOG.md`

- [ ] **Step 1: Update README**

- Features: add image preview (fit + zoom, open original) and JSON Formatted mode; note that local relative images render inside the Markdown preview.
- Server API section: add `GET /filemanager-fs/cap` (mints a per-workspace capability token; header-gated) and `GET /filemanager-fs/raw` (serves image bytes to capability URLs — the only endpoint reachable without the header, enabling `<img>`).
- Remove any sentence implying local md images are unavailable.

- [ ] **Step 2: Update CHANGELOG under [Unreleased]**

```markdown
## [Unreleased]

### Added

- Image preview in the file dock: raster (png/jpeg/gif/webp/avif) and svg
  files open fitted with zoom controls (buttons, Ctrl+wheel, double-click),
  dimensions in the toolbar and "open original in a new tab"; SVG responses
  are served with a sandbox CSP
- Workspace-local relative images now render inside the Markdown preview;
  external images remain blocked
- JSON files get a Raw/Formatted toggle (Formatted default for valid JSON
  under 1 MB; invalid or oversized files fall back to raw with a note)
- Server capability endpoint `GET /filemanager-fs/cap` and image endpoint
  `GET /filemanager-fs/raw` (byte caps 20 MB raster / 2 MB svg;
  nosniff/no-store)

### Security

- Image bytes are served only to URLs carrying an unguessable, expiring
  per-workspace capability token; all other endpoints keep the
  `x-dsh-filemanager` header gate
```

- [ ] **Step 3: Full gate + commit**

Run: `npm run typecheck && npm test && npm run build`
Commit:

```bash
git add README.md CHANGELOG.md
git commit -m "docs: README + CHANGELOG for image preview and JSON pretty view"
```

---

## Self-Review Notes (from the planner)

- **Spec coverage:** D1 (scope) → Tasks 7 + 10/11; D2 (transport) → Tasks 2/4/6; D3 (formats/limits) → Tasks 3/4; D4 (dock UX fit+zoom) → Task 10; D5 (md local images) → Tasks 7 + 11; D6 (json pretty) → Tasks 5/8/9/11; D7 (invariants) → Global Constraints + Task 12; Security notes → Task 4 headers/tests; l10n/a11y → Tasks 10/11; canon updates → Task 1; out-of-scope list untouched.
- **Type consistency:** `CapabilityIssuer`/`createCapabilityIssuer` only in T2/T4; `detectImageType`/`looksLikeSvg` only in T3/T4; `fetchCap`/`capCache`/`buildRawFileUrl` defined in T6, consumed by T7/T10/T11; `formatJson`/`JsonViewMode` in T8 consumed by T10/T11; `classifyPreviewKind` in T8 consumed by T10/T11; `ZoomState` helpers only in T10; `store.setJsonMode` in T9 consumed by T11; `rawMarkdownImageUrl` in T7 consumed by T11.

