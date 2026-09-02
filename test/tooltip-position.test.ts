// test/tooltip-position.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { computeTooltipPlacement, TOOLTIP_GAP } from "../src/tooltip.js";

const viewport = { width: 1920, height: 1080 };

describe("computeTooltipPlacement", () => {
  it("places the tooltip right-below the cursor when there is room", () => {
    const p = computeTooltipPlacement({ x: 100, y: 200 }, { width: 120, height: 28 }, viewport);
    assert.strictEqual(p.x, 100 + TOOLTIP_GAP);
    assert.strictEqual(p.y, 200 + TOOLTIP_GAP);
    assert.strictEqual(p.flippedX, false);
    assert.strictEqual(p.flippedY, false);
  });

  it("does not flip when the bubble exactly fits", () => {
    const w = 1800;
    const p = computeTooltipPlacement({ x: 100, y: 200 }, { width: w, height: 28 }, { width: 1920, height: 1080 });
    assert.strictEqual(p.x, 100 + TOOLTIP_GAP);
    assert.strictEqual(p.flippedX, false);
  });

  it("flips left when the bubble would overflow the right edge", () => {
    const size = { width: 200, height: 28 };
    const p = computeTooltipPlacement({ x: 1850, y: 200 }, size, viewport);
    assert.strictEqual(p.flippedX, true);
    assert.strictEqual(p.x, 1850 - TOOLTIP_GAP - size.width);
    assert.ok(p.x + size.width <= viewport.width);
  });

  it("flips above when the bubble would overflow the bottom edge", () => {
    const size = { width: 120, height: 28 };
    const p = computeTooltipPlacement({ x: 100, y: 1060 }, size, viewport);
    assert.strictEqual(p.flippedY, true);
    assert.strictEqual(p.y, 1060 - TOOLTIP_GAP - size.height);
    assert.ok(p.y >= 0);
  });

  it("clamps inside the viewport when the bubble is larger than it", () => {
    const p = computeTooltipPlacement(
      { x: 2000, y: 2000 },
      { width: 3000, height: 28 },
      { width: 1024, height: 768 }
    );
    assert.strictEqual(p.x, 0);
    assert.ok(p.x + p.y >= 0);
  });

  it("clamps to the top-left for negative overflow after flip", () => {
    const size = { width: 400, height: 30 };
    const p = computeTooltipPlacement({ x: 30, y: 30 }, size, viewport);
    assert.ok(p.x >= 0);
    assert.ok(p.y >= 0);
    assert.ok(p.x + size.width <= viewport.width);
  });

  it("respects a custom gap", () => {
    const p = computeTooltipPlacement({ x: 50, y: 50 }, { width: 100, height: 20 }, viewport, 24);
    assert.strictEqual(p.x, 74);
    assert.strictEqual(p.y, 74);
  });
});
