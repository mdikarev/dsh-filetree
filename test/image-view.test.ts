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
