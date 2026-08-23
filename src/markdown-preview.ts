import { marked } from "marked";
import DOMPurify from "dompurify";

interface MarkdownRenderOptions { filePath: string; workspaceHint: string }
interface MarkdownRenderResult { html: string; blockedExternalImages: number; unavailableLocalImages: number }
const READ_PATH = "/filemanager-fs/read";

export function isMarkdownFile(name: string): boolean { return name.toLowerCase().endsWith(".md"); }

function isUnsafeUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("#")) return false;
  if (trimmed.startsWith("//") || trimmed.startsWith("/")) return true;
  try {
    const parsed = new URL(trimmed, "https://workspace.invalid/");
    return parsed.origin !== "https://workspace.invalid" || (parsed.protocol !== "https:" && parsed.protocol !== "http:");
  } catch { return true; }
}
function isExternalUrl(value: string): boolean {
  try { const p = new URL(value.trim()); return p.protocol === "http:" || p.protocol === "https:"; } catch { return false; }
}

export function workspaceResourceUrl(hint: string, markdownPath: string, resource: string): string | null {
  const normalizedMarkdown = markdownPath.replaceAll("\\", "/");
  let decodedMarkdown: string;
  try { decodedMarkdown = decodeURIComponent(normalizedMarkdown); } catch { return null; }
  if (!decodedMarkdown || decodedMarkdown.includes("\\") || decodedMarkdown.startsWith("/") || decodedMarkdown.startsWith("//") || /^[A-Za-z]:\//.test(decodedMarkdown) || decodedMarkdown.split("/").includes("..")) return null;
  const raw = resource.trim();
  if (!raw || isUnsafeUrl(raw) || isExternalUrl(raw)) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(raw); } catch { return null; }
  if (decoded.includes("\\") || decoded.startsWith("/") || decoded.startsWith("//")) return null;
  if (decoded.split("/").includes("..")) return null;
  const directory = decodedMarkdown.includes("/") ? decodedMarkdown.slice(0, decodedMarkdown.lastIndexOf("/")) : "";
  const combined = [directory, decoded].filter(Boolean).join("/");
  if (combined === ".." || combined.startsWith("../") || combined.includes("/../")) return null;
  return READ_PATH + "?" + new URLSearchParams({ hint, path: combined }).toString();
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&amp;/gi, "&").replace(/&(?:#x([0-9a-f]+)|#([0-9]+));?/gi, (_match, hex, decimal) => {
    const code = Number.parseInt(hex ?? decimal, hex ? 16 : 10);
    const valid = Number.isInteger(code) && code >= 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
    return valid ? String.fromCodePoint(code) : _match;
  }).replace(/&(colon|tab|newline);/gi, (_match, name) => ({ colon: ":", tab: "\t", newline: "\n" }[name.toLowerCase()] ?? _match));
}
function fallbackSanitize(html: string): string {
  const dangerous = (value: string): boolean => {
    try {
      const normalized = decodeHtmlEntities(value).replace(/[\u0000-\u0020]/g, "");
      const protocol = new URL(normalized, "https://workspace.invalid/").protocol;
      return protocol !== "http:" && protocol !== "https:" && protocol !== "mailto:";
    } catch { return true; }
  };
  return html.replace(/<\/?(script|style|iframe|object|embed|form|svg|math)[^>]*>/gi, "")
    .replace(/ on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, (_m, a, b, c) => dangerous(a ?? b ?? c ?? "") ? "" : _m);
}
function sanitize(html: string): string {
  const purifier = DOMPurify as unknown as { sanitize?: (value: string, config?: unknown) => string };
  if (typeof purifier.sanitize === "function" && typeof window !== "undefined" && window.document) {
    return purifier.sanitize(html, { ALLOWED_TAGS: ["p","br","hr","h1","h2","h3","h4","h5","h6","ul","ol","li","blockquote","pre","code","em","strong","del","table","thead","tbody","tr","th","td","a","img"], ALLOWED_ATTR: ["href","src","alt","title","class","target","rel"], ALLOW_DATA_ATTR: false });
  }
  return fallbackSanitize(html);
}

export function renderMarkdown(source: string, options: MarkdownRenderOptions): MarkdownRenderResult {
  let blockedExternalImages = 0;
  let unavailableLocalImages = 0;
  let html = marked.parse(source, { gfm: true, breaks: false, html: false }) as string;
  html = html.replace(/<img\b([^>]*?)\bsrc=(['"])(.*?)\2([^>]*)>/gi, (_full, before, quote, src, after) => {
    if (isExternalUrl(src) || isUnsafeUrl(src)) { blockedExternalImages += 1; return ""; }
    unavailableLocalImages += 1;
    return "";
  });
  html = html.replace(/<a\b([^>]*?)\bhref=(['"])(.*?)\2([^>]*)>/gi, (_full, before, quote, href, after) => {
    const decoded = decodeHtmlEntities(href);
    if (isExternalUrl(decoded) || decoded.startsWith("//")) {
      return "<a" + before + "href=" + quote + href + quote + after + " target=\"_blank\" rel=\"noreferrer noopener\">";
    }
    if (workspaceResourceUrl(options.workspaceHint, options.filePath, decoded) || decoded.startsWith("#")) {
      return decoded.startsWith("#") ? _full : "<a" + before + "href=\"#\" title=\"Workspace link unavailable in preview\"" + after + ">";
    }
    return "<a" + before + "href=\"#\"" + after + ">";
  });
  html = sanitize(html);
  return { html, blockedExternalImages, unavailableLocalImages };
}
