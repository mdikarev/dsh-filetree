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
  assert.equal(html.includes("filemanager-fs/read"), false);
  assert.equal(html.includes("images/a.png"), false);
});

test("reports unavailable local images instead of emitting JSON read URLs", () => {
  const { html, unavailableLocalImages } = renderMarkdown("![local](images/a.png)", { filePath: "docs/README.md", workspaceHint: "/workspace" });
  assert.equal(unavailableLocalImages, 1);
  assert.equal(html.includes("filemanager-fs/read"), false);
});

test("adds safe attributes to external text links", () => {
  const { html } = renderMarkdown("[site](https://example.com)", { filePath: "README.md", workspaceHint: "/workspace" });
  assert.ok(html.includes('target="_blank"'));
  assert.ok(html.includes("noreferrer") && html.includes("noopener"));
});

test("safely represents protocol-relative and workspace-relative anchors", () => {
  const { html } = renderMarkdown("[cdn](//evil.example/x)\n\n[docs](guide/next.md)", { filePath: "docs/README.md", workspaceHint: "/workspace" });
  assert.match(html, /href="\/\/evil\.example\/x"[^>]*target="_blank"/);
  assert.match(html, /rel="noreferrer noopener"/);
  assert.equal(html.includes('href="guide/next.md"'), false);
  assert.match(html, /href="#"/);
});

test("neutralizes encoded and unsafe anchor schemes", () => {
  const { html } = renderMarkdown("[bad](java&#x73;cript:alert(1))\n\n[data](data:text/html,evil)", { filePath: "README.md", workspaceHint: "/workspace" });
  assert.equal(html.toLowerCase().includes("javascript:"), false);
  assert.equal(html.toLowerCase().includes("data:text"), false);
  assert.equal(html.includes('href="#"'), true);
});

test("constructs only workspace-relative resource URLs", () => {
  assert.equal(workspaceResourceUrl("/workspace", "docs/README.md", "images/logo.png"), "/filemanager-fs/read?hint=%2Fworkspace&path=docs%2Fimages%2Flogo.png");
  assert.equal(workspaceResourceUrl("/workspace", "docs/README.md", "../outside.png"), null);
  assert.equal(workspaceResourceUrl("/workspace", "docs/README.md", "https://example.com/x"), null);
  assert.equal(workspaceResourceUrl("/workspace", "docs/README.md", "javascript:alert(1)"), null);
});

test("rejects entity-obfuscated and malformed dangerous URL attributes", () => {
  const source = "[encoded](java&#x73;cript:alert(1))\n\n[malformed](<javascript:alert(1)>)";
  const { html } = renderMarkdown(source, { filePath: "README.md", workspaceHint: "/workspace" });
  assert.equal(html.toLowerCase().includes("href=\"javascript:"), false);
  assert.equal(html.toLowerCase().includes("href=\"java&#x73;cript:"), false);
  assert.doesNotThrow(() => renderMarkdown("[bad](java&#x110000;script:alert(1))", { filePath: "README.md", workspaceHint: "/workspace" }));
  assert.doesNotThrow(() => renderMarkdown("[bad](java&#55296;script:alert(1))", { filePath: "README.md", workspaceHint: "/workspace" }));
});

test("rejects absolute and traversal markdown paths", () => {
  assert.equal(workspaceResourceUrl("/workspace", "/absolute/README.md", "img.png"), null);
  assert.equal(workspaceResourceUrl("/workspace", "../outside/README.md", "img.png"), null);
  assert.equal(workspaceResourceUrl("/workspace", "docs/%2e%2e/README.md", "img.png"), null);
  assert.equal(workspaceResourceUrl("/workspace", "C:/outside/README.md", "img.png"), null);
  assert.equal(workspaceResourceUrl("/workspace", "docs/%5c%2e%2e%5coutside/README.md", "img.png"), null);
  assert.equal(workspaceResourceUrl("/workspace", "%2fabsolute/README.md", "img.png"), null);
});
