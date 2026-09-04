// src/preview-kind.ts
import { isMarkdownFile } from "./markdown-preview.js";
import { isJsonFile } from "./json-view.js";

export type PreviewKind = "text" | "markdown" | "json" | "image";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"]);

export function isImageFileName(name: string): boolean {
  const baseName = name.split(/[\\/]/).pop() ?? name;
  const dot = baseName.lastIndexOf(".");
  if (dot < 1) return false;
  return IMAGE_EXTENSIONS.has(baseName.slice(dot + 1).toLowerCase());
}

export function classifyPreviewKind(name: string): PreviewKind {
  if (isImageFileName(name)) return "image";
  if (isMarkdownFile(name)) return "markdown";
  if (isJsonFile(name)) return "json";
  return "text";
}
