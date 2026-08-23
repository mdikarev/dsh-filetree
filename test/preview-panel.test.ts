import test from "node:test";
import assert from "node:assert/strict";
import { getPreviewPresentation } from "../src/Panel.tsx";

test("uses rendered markdown only for markdown files in rendered mode", () => {
  const result = getPreviewPresentation("README.MD", "# Hello", false, "rendered", "/workspace");
  assert.equal(result.kind, "rendered");
  assert.match(result.html ?? "", /<h1>Hello<\/h1>/);
});

test("keeps source presentation when source mode is selected", () => {
  const result = getPreviewPresentation("README.md", "# Hello", false, "source", "/workspace");
  assert.equal(result.kind, "source");
  assert.equal(result.content, "# Hello");
  assert.equal(result.error, undefined);
});

test("uses highlighted source for non-markdown files regardless of mode", () => {
  const result = getPreviewPresentation("main.ts", "const value = 1;", false, "rendered", "/workspace");
  assert.equal(result.kind, "highlighted-source");
});
