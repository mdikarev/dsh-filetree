import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDeleteDialogModel, isPreviewAffected, type DeleteInfo } from "../src/delete-flow.js";

const info = (partial: Partial<DeleteInfo>): DeleteInfo => ({
  kind: "file", name: "a.txt", path: "a.txt", isRoot: false, uncommitted: false, ...partial,
});

describe("buildDeleteDialogModel", () => {
  it("blocks root and missing entries", () => {
    assert.equal(buildDeleteDialogModel(info({ isRoot: true })).blocked, true);
    assert.equal(buildDeleteDialogModel(info({ kind: "missing" })).blocked, true);
    assert.equal(buildDeleteDialogModel(info({})).blocked, false);
  });
  it("carries dir-ness and the uncommitted flag", () => {
    const m = buildDeleteDialogModel(info({ kind: "dir", uncommitted: true }));
    assert.equal(m.isDir, true);
    assert.equal(m.uncommitted, true);
  });
});

describe("isPreviewAffected", () => {
  it("matches the deleted path and anything under a deleted directory", () => {
    assert.equal(isPreviewAffected("docs", null), false);
    assert.equal(isPreviewAffected("docs", "docs"), true);
    assert.equal(isPreviewAffected("docs", "docs/a/b.md"), true);
    assert.equal(isPreviewAffected("docs", "docs2/a.md"), false);
    assert.equal(isPreviewAffected("a.txt", "b.txt"), false);
  });
});
