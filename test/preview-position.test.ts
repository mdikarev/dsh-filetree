import { describe, it } from "node:test";
import assert from "node:assert";
import { clampPosition } from "../src/preview-position.js";

describe("clampPosition", () => {
  it("keeps position unchanged when fully inside viewport", () => {
    const r = clampPosition(100, 80, 700, 500, 1920, 1080);
    assert.deepStrictEqual(r, { x: 100, y: 80 });
  });

  it("clamps x so the panel does not leave the right edge", () => {
    const r = clampPosition(1500, 80, 700, 500, 1920, 1080);
    assert.deepStrictEqual(r, { x: 1920 - 700, y: 80 });
  });

  it("clamps y so the panel does not leave the bottom edge", () => {
    const r = clampPosition(100, 900, 700, 500, 1920, 1080);
    assert.deepStrictEqual(r, { x: 100, y: 1080 - 500 });
  });

  it("clamps to zero when position is negative", () => {
    const r = clampPosition(-40, -30, 700, 500, 1920, 1080);
    assert.deepStrictEqual(r, { x: 0, y: 0 });
  });

  it("returns zero when panel is wider than the viewport", () => {
    const r = clampPosition(400, 10, 3000, 500, 1920, 1080);
    assert.deepStrictEqual(r, { x: 0, y: 10 });
  });

  it("returns zero when panel is taller than the viewport", () => {
    const r = clampPosition(100, 600, 700, 2000, 1920, 1080);
    assert.deepStrictEqual(r, { x: 100, y: 0 });
  });
});