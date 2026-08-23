import test from "node:test";
import assert from "node:assert/strict";
import { isMarkdownFile, renderMarkdown, workspaceResourceUrl } from "../src/markdown-preview.ts";

test("recognizes markdown files case-insensitively", () => {
  assert.equal(isMarkdownFile("README.md"), true);
  assert.equal(isMarkdownFile("notes.MD"), true);
  assert.equal(isMarkdownFile("README.markdown"), false);
  assert.equal(isMarkdownFile("md"), false);
});

test("renders headings lists tables and fenced code", () => {
  const source = ["# Title", "", "- one", "- two", "", "| A | B |", "| --- | --- |", "| 1 | 2 |", "", "```ts", "const x = 1;", "```"].join(String.fromCharCode(10));
  const { html } = renderMarkdown(source, { filePath: "docs/README.md", workspaceHint: "/workspace" });
  assert.ok(html.includes("<h1>Title</h1>"));
  assert.ok(html.includes("<li>one</li>"));
  assert.ok(html.includes("<table>"));
  assert.ok(html.includes("const x = 1;"));
});

test("escapes raw HTML and blocks dangerous links", () => {
  const source = ["<script>alert(1)</script>", "", "[bad](javascript:alert(1))", "", "[also bad](data:text/html,evil)"].join(String.fromCharCode(10));
  const { html } = renderMarkdown(source, { filePath: "README.md", workspaceHint: "/workspace" });
  assert.equal(html.includes("<script"), false);
  assert.ok(html.includes("&lt;script&gt;") || !html.includes("<script"));
  assert.equal(html.toLowerCase().includes('href="javascript:'), false);
});

test("removes external images and counts them", () => {
  const source = ["![remote](https://example.com/a.png)", "", "![local](images/a.png)"].join(String.fromCharCode(10));
  const { html, blockedExternalImages } = renderMarkdown(source, { filePath: "docs/README.md", workspaceHint: "/workspace" });
  assert.equal(blockedExternalImages, 1);
  assert.equal(html.includes("example.com"), false);
  assert.ok(html.includes("filemanager-fs/read"));
});

test("adds safe attributes to external text links", () => {
  const { html } = renderMarkdown("[site](https://example.com)", { filePath: "README.md", workspaceHint: "/workspace" });
  assert.ok(html.includes('target="_blank"'));
  assert.ok(html.includes("noreferrer") && html.includes("noopener"));
});

test("constructs only workspace-relative resource URLs", () => {
  assert.equal(workspaceResourceUrl("/workspace", "docs/README.md", "images/logo.png"), "/filemanager-fs/read?hint=%2Fworkspace&path=docs%2Fimages%2Flogo.png");
  assert.equal(workspaceResourceUrl("/workspace", "docs/README.md", "../outside.png"), null);
  assert.equal(workspaceResourceUrl("/workspace", "docs/README.md", "https://example.com/x"), null);
  assert.equal(workspaceResourceUrl("/workspace", "docs/README.md", "javascript:alert(1)"), null);
});
