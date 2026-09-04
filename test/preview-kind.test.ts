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
