// test/live-refresh.test.ts
import { describe, it, afterEach } from "node:test";
import assert from "node:assert";
import {
  parentDirectory,
  affectedExpandedDirectories,
  createDebouncer,
  parseSseChange,
  type FileChange,
} from "../src/live-refresh.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn: () => boolean, timeoutMs = 1500, intervalMs = 5): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (fn()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await delay(intervalMs);
  }
}

describe("live refresh", () => {
  afterEach(() => {
    // Debouncer timers are owned by the tests; nothing to clean globally.
  });

  describe("parentDirectory", () => {
    it("preserves the root as an empty string", () => {
      assert.strictEqual(parentDirectory(""), "");
    });

    it("maps root-level files to the root", () => {
      assert.strictEqual(parentDirectory("README.md"), "");
      assert.strictEqual(parentDirectory("src"), "");
    });

    it("maps nested paths one level up", () => {
      assert.strictEqual(parentDirectory("src/Panel.tsx"), "src");
      assert.strictEqual(parentDirectory("src/components/Button.tsx"), "src/components");
      assert.strictEqual(parentDirectory("a/b/c/d.txt"), "a/b/c");
    });

    it("ignores trailing separators", () => {
      assert.strictEqual(parentDirectory("src/"), "");
      assert.strictEqual(parentDirectory("a/b/"), "a");
    });
  });

  describe("affectedExpandedDirectories", () => {
    it("returns the expanded parent of a changed file", () => {
      const changed = "src/Panel.tsx";
      const expanded = ["src", "test"];
      assert.deepStrictEqual(affectedExpandedDirectories(changed, expanded), ["src"]);
    });

    it("preserves the root as empty string for root-level changes", () => {
      const changed = "README.md";
      const expanded = ["", "src"];
      assert.deepStrictEqual(affectedExpandedDirectories(changed, expanded), [""]);
    });

    it("returns the innermost expanded directory for nested changes", () => {
      const changed = "src/components/Button.tsx";
      const expanded = ["", "src", "src/components"];
      assert.deepStrictEqual(affectedExpandedDirectories(changed, expanded), ["src/components"]);
    });

    it("ignores closed ancestors and unrelated directories", () => {
      const changed = "src/components/Button.tsx";
      assert.deepStrictEqual(affectedExpandedDirectories(changed, ["", "src"]), []);
      assert.deepStrictEqual(affectedExpandedDirectories(changed, ["test", "lib"]), []);
    });

    it("treats a directory rename as a change of its parent listing", () => {
      const changed = "src/old-name";
      const expanded = ["", "src", "src/old-name"];
      assert.deepStrictEqual(affectedExpandedDirectories(changed, expanded), ["src"]);
    });

    it("deduplicates repeated expanded paths", () => {
      const changed = "src/Panel.tsx";
      const expanded = ["src", "src", "test", "src"];
      assert.deepStrictEqual(affectedExpandedDirectories(changed, expanded), ["src"]);
    });

    it("preserves expanded-path order in the result", () => {
      const changed = "lib/util.ts";
      const expanded = ["test", "lib", "src", "lib"];
      assert.deepStrictEqual(affectedExpandedDirectories(changed, expanded), ["lib"]);
    });
  });

  describe("createDebouncer", () => {
    it("groups rapid pushes by path and flushes one batch", async () => {
      const batches: FileChange[][] = [];
      const debouncer = createDebouncer(30, (changes) => batches.push(changes));

      debouncer.push({ type: "changed", path: "src/a.ts", kind: "change" });
      debouncer.push({ type: "changed", path: "src/b.ts", kind: "change" });
      debouncer.push({ type: "changed", path: "src/a.ts", kind: "rename" });

      await waitFor(() => batches.length === 1);
      assert.deepStrictEqual(batches[0], [
        { type: "changed", path: "src/a.ts", kind: "rename" },
        { type: "changed", path: "src/b.ts", kind: "change" },
      ]);
    });

    it("flushes a separate batch for pushes after the window", async () => {
      const batches: FileChange[][] = [];
      const debouncer = createDebouncer(20, (changes) => batches.push(changes));

      debouncer.push({ type: "changed", path: "a.ts", kind: "change" });
      await waitFor(() => batches.length === 1);

      debouncer.push({ type: "changed", path: "b.ts", kind: "change" });
      await waitFor(() => batches.length === 2);

      assert.deepStrictEqual(batches[0], [{ type: "changed", path: "a.ts", kind: "change" }]);
      assert.deepStrictEqual(batches[1], [{ type: "changed", path: "b.ts", kind: "change" }]);
    });

    it("resets the window on each push", async () => {
      const batches: FileChange[][] = [];
      const debouncer = createDebouncer(40, (changes) => batches.push(changes));

      debouncer.push({ type: "changed", path: "a.ts", kind: "change" });
      await delay(20);
      debouncer.push({ type: "changed", path: "a.ts", kind: "rename" });
      await waitFor(() => batches.length === 1);

      assert.deepStrictEqual(batches[0], [{ type: "changed", path: "a.ts", kind: "rename" }]);
    });

    it("cancel discards pending changes and ignores later pushes", async () => {
      const batches: FileChange[][] = [];
      const debouncer = createDebouncer(30, (changes) => batches.push(changes));

      debouncer.push({ type: "changed", path: "a.ts", kind: "change" });
      debouncer.cancel();
      debouncer.push({ type: "changed", path: "b.ts", kind: "change" });

      await delay(80);
      assert.deepStrictEqual(batches, []);
    });

    it("cancel after a flush stops future batches", async () => {
      const batches: FileChange[][] = [];
      const debouncer = createDebouncer(20, (changes) => batches.push(changes));

      debouncer.push({ type: "changed", path: "a.ts", kind: "change" });
      await waitFor(() => batches.length === 1);

      debouncer.push({ type: "changed", path: "b.ts", kind: "change" });
      debouncer.cancel();
      await delay(60);
      assert.deepStrictEqual(batches, [[{ type: "changed", path: "a.ts", kind: "change" }]]);
    });
  });

  describe("parseSseChange", () => {
    it("parses a valid change payload", () => {
      assert.deepStrictEqual(
        parseSseChange('{"type":"changed","path":"src/Panel.tsx","kind":"change"}'),
        { type: "changed", path: "src/Panel.tsx", kind: "change" }
      );
    });

    it("parses a valid rename payload", () => {
      assert.deepStrictEqual(
        parseSseChange('{"type":"changed","path":"a.txt","kind":"rename"}'),
        { type: "changed", path: "a.txt", kind: "rename" }
      );
    });

    it("tolerates extra fields", () => {
      assert.deepStrictEqual(
        parseSseChange('{"type":"changed","path":"a.txt","kind":"change","extra":1}'),
        { type: "changed", path: "a.txt", kind: "change" }
      );
    });

    it("returns null for malformed JSON", () => {
      assert.strictEqual(parseSseChange("not json"), null);
      assert.strictEqual(parseSseChange(""), null);
      assert.strictEqual(parseSseChange("[1,2]"), null);
      assert.strictEqual(parseSseChange("null"), null);
    });

    it("returns null when fields are missing or mistyped", () => {
      assert.strictEqual(parseSseChange("{}"), null);
      assert.strictEqual(parseSseChange('{"type":"changed"}'), null);
      assert.strictEqual(parseSseChange('{"type":"changed","path":42,"kind":"change"}'), null);
      assert.strictEqual(parseSseChange('{"type":"changed","path":"a","kind":42}'), null);
    });

    it("returns null for a wrong type", () => {
      assert.strictEqual(
        parseSseChange('{"type":"other","path":"a","kind":"change"}'),
        null
      );
    });

    it("returns null for an invalid kind", () => {
      assert.strictEqual(
        parseSseChange('{"type":"changed","path":"a","kind":"delete"}'),
        null
      );
    });

    it("returns null for absolute paths", () => {
      assert.strictEqual(
        parseSseChange('{"type":"changed","path":"/etc/passwd","kind":"change"}'),
        null
      );
    });

    it("returns null for traversal paths", () => {
      assert.strictEqual(
        parseSseChange('{"type":"changed","path":"../outside","kind":"change"}'),
        null
      );
      assert.strictEqual(
        parseSseChange('{"type":"changed","path":"a/../../x","kind":"change"}'),
        null
      );
    });

    it("returns null for backslash and NUL paths", () => {
      const backslashPayload = JSON.stringify({ type: "changed", path: "a\\b", kind: "change" });
      const nulPayload = JSON.stringify({ type: "changed", path: "a\u0000b", kind: "change" });
      assert.strictEqual(parseSseChange(backslashPayload), null);
      assert.strictEqual(parseSseChange(nulPayload), null);
    });

    it("returns null for empty, dot and duplicate-separator paths", () => {
      assert.strictEqual(parseSseChange('{"type":"changed","path":"","kind":"change"}'), null);
      assert.strictEqual(parseSseChange('{"type":"changed","path":".","kind":"change"}'), null);
      assert.strictEqual(parseSseChange('{"type":"changed","path":"a/./b","kind":"change"}'), null);
      assert.strictEqual(parseSseChange('{"type":"changed","path":"a//b","kind":"change"}'), null);
      assert.strictEqual(parseSseChange('{"type":"changed","path":"a/","kind":"change"}'), null);
    });
  });
});
