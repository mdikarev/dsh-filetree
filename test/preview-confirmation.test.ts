// test/preview-confirmation.test.ts
// Task 5 pure presentation tests: the changed-preview confirmation state
// machine. The coordinator delivers debounced file changes; these helpers
// distinguish the current preview identity (preview path) from unrelated
// changes and drive the banner's show / dismiss / refresh-clear transitions.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  reduceChangedPreview,
  dismissChangedPreview,
  clearChangedPreview,
} from "../src/Panel.tsx";
import type { FileChange } from "../src/live-refresh.js";

function change(path: string, kind: "rename" | "change" = "change"): FileChange {
  return { type: "changed", path, kind };
}

describe("changed preview confirmation", () => {
  describe("reduceChangedPreview", () => {
    it("ignores changes for files unrelated to the current preview", () => {
      const state = reduceChangedPreview(
        { kind: "idle" },
        [change("src/a.ts"), change("README.md")],
        "src/b.ts"
      );
      assert.deepStrictEqual(state, { kind: "idle" });
    });

    it("shows the banner for a change matching the current preview path", () => {
      const state = reduceChangedPreview({ kind: "idle" }, [change("src/a.ts")], "src/a.ts");
      assert.deepStrictEqual(state, { kind: "changed", path: "src/a.ts", changeKind: "change" });
    });

    it("shows the banner for delete/move (rename) events of the preview file", () => {
      const state = reduceChangedPreview({ kind: "idle" }, [change("src/a.ts", "rename")], "src/a.ts");
      assert.deepStrictEqual(state, { kind: "changed", path: "src/a.ts", changeKind: "rename" });
    });

    it("picks the matching change out of a mixed batch", () => {
      const state = reduceChangedPreview(
        { kind: "idle" },
        [change("b.ts"), change("a.ts"), change("c.ts")],
        "a.ts"
      );
      assert.deepStrictEqual(state, { kind: "changed", path: "a.ts", changeKind: "change" });
    });

    it("does not duplicate the banner for repeated events of the already-changed file", () => {
      const state = reduceChangedPreview(
        { kind: "changed", path: "a.ts", changeKind: "change" },
        [change("a.ts")],
        "a.ts"
      );
      assert.deepStrictEqual(state, { kind: "changed", path: "a.ts", changeKind: "change" });
    });

    it("keeps the banner while unrelated files change", () => {
      const state = reduceChangedPreview(
        { kind: "changed", path: "a.ts", changeKind: "change" },
        [change("b.ts")],
        "a.ts"
      );
      assert.deepStrictEqual(state, { kind: "changed", path: "a.ts", changeKind: "change" });
    });

    it("re-shows the banner for a new event after dismiss", () => {
      const state = reduceChangedPreview({ kind: "dismissed", path: "a.ts" }, [change("a.ts")], "a.ts");
      assert.deepStrictEqual(state, { kind: "changed", path: "a.ts", changeKind: "change" });
    });

    it("keeps the dismissed state while unrelated files change", () => {
      const state = reduceChangedPreview({ kind: "dismissed", path: "a.ts" }, [change("b.ts")], "a.ts");
      assert.deepStrictEqual(state, { kind: "dismissed", path: "a.ts" });
    });

    it("does not show a banner when no preview is open", () => {
      assert.deepStrictEqual(reduceChangedPreview({ kind: "idle" }, [change("a.ts")], null), {
        kind: "idle",
      });
    });

    it("clears a stale banner when the preview path changes to another file", () => {
      assert.deepStrictEqual(
        reduceChangedPreview({ kind: "changed", path: "a.ts", changeKind: "change" }, [], "b.ts"),
        { kind: "idle" }
      );
    });

    it("clears a stale banner when the preview closes", () => {
      assert.deepStrictEqual(
        reduceChangedPreview({ kind: "changed", path: "a.ts", changeKind: "change" }, [change("a.ts")], null),
        { kind: "idle" }
      );
    });
  });

  describe("dismissChangedPreview", () => {
    it("hides the banner and remembers the dismissed file", () => {
      assert.deepStrictEqual(
        dismissChangedPreview({ kind: "changed", path: "a.ts", changeKind: "change" }),
        { kind: "dismissed", path: "a.ts" }
      );
    });

    it("is a no-op when no banner is showing", () => {
      assert.deepStrictEqual(dismissChangedPreview({ kind: "idle" }), { kind: "idle" });
      assert.deepStrictEqual(dismissChangedPreview({ kind: "dismissed", path: "a.ts" }), {
        kind: "dismissed",
        path: "a.ts",
      });
    });
  });

  describe("clearChangedPreview", () => {
    it("resets to idle after a successful refresh", () => {
      assert.deepStrictEqual(clearChangedPreview(), { kind: "idle" });
    });
  });
});
