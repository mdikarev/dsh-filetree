import test from "node:test";
import assert from "node:assert/strict";
import { detectLanguage, highlightSource } from "../src/syntax-highlighting.js";
import { CSS_STRING } from "../src/styles.js";

test("detects supported language from filename extension", () => {
  assert.equal(detectLanguage("src/example.ts", "const answer = 42;"), "typescript");
  assert.equal(detectLanguage("script.py", `print("hi")`), "python");
  assert.equal(detectLanguage("main.rs", "fn main() {}"), "rust");
});

test("detects a supported language from a shebang when extension is absent", () => {
  assert.equal(detectLanguage("deploy", "#!/usr/bin/env python3\nprint(1)"), "python");
});

test("returns plain text for unsupported files", () => {
  assert.equal(detectLanguage("notes.txt", "const notHighlighted = true;"), null);
  const result = highlightSource("notes.txt", "<unsafe>");
  assert.deepEqual(result, { language: null, highlighted: false, html: null });
});

test("highlights supported source and escapes source content", () => {
  const result = highlightSource("example.ts", "const answer = 42;\n// comment");
  assert.equal(result.language, "typescript");
  assert.equal(result.highlighted, true);
  assert.match(result.html ?? "", /hljs-keyword/);
  assert.match(result.html ?? "", /hljs-comment/);
});

test("disables highlighting for truncated content", () => {
  const result = highlightSource("example.ts", "const answer = 42;", true);
  assert.deepEqual(result, { language: "typescript", highlighted: false, html: null });
});

test("defines colors for the token classes emitted by highlight.js", () => {
  for (const token of ["keyword", "string", "number", "comment", "title", "function", "params", "property", "built_in", "variable", "type", "attr", "punctuation", "operator", "meta", "doctag"]) {
    assert.match(CSS_STRING, new RegExp(`\\.hljs-${token}`));
  }
});

test("detects json and highlights it", () => {
  assert.equal(detectLanguage("config.json", "{}"), "json");
  const source = JSON.stringify({ a: [1, true], b: "x" }, null, 2);
  const { highlighted, html } = highlightSource("config.json", source);
  assert.equal(highlighted, true);
  assert.ok(html && html.includes("hljs"));
  assert.ok(html && html.includes("1"));
});
