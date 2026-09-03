import { describe, it } from "node:test";
import assert from "node:assert";
import { treeNavStep } from "../src/tree-nav.js";

describe("treeNavStep", () => {
  it("moves one step and clamps at the ends", () => {
    assert.strictEqual(treeNavStep(2, 5, "ArrowDown"), 3);
    assert.strictEqual(treeNavStep(4, 5, "ArrowDown"), 4);
    assert.strictEqual(treeNavStep(0, 5, "ArrowUp"), 0);
    assert.strictEqual(treeNavStep(2, 5, "ArrowUp"), 1);
  });
  it("supports Home and End", () => {
    assert.strictEqual(treeNavStep(3, 7, "Home"), 0);
    assert.strictEqual(treeNavStep(0, 7, "End"), 6);
  });
  it("returns null for empty trees and unknown keys", () => {
    assert.strictEqual(treeNavStep(0, 0, "ArrowDown"), null);
    assert.strictEqual(treeNavStep(0, 3, "Enter" as any), null);
  });
});
