import hljs from "highlight.js/lib/core";
import typescript from "highlight.js/lib/languages/typescript";
import javascript from "highlight.js/lib/languages/javascript";
import python from "highlight.js/lib/languages/python";
import go from "highlight.js/lib/languages/go";
import csharp from "highlight.js/lib/languages/csharp";
import rust from "highlight.js/lib/languages/rust";

export type SupportedLanguage = "typescript" | "javascript" | "python" | "go" | "csharp" | "rust";

const MAX_HIGHLIGHT_CHARS = 5 * 1024 * 1024;

const LANGUAGE_ALIASES: Record<string, SupportedLanguage> = {
  ts: "typescript",
  tsx: "typescript",
  typescript: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  javascript: "javascript",
  py: "python",
  pyw: "python",
  python: "python",
  go: "go",
  cs: "csharp",
  csharp: "csharp",
  rs: "rust",
  rust: "rust",
};

for (const [language, definition] of Object.entries({ typescript, javascript, python, go, csharp, rust })) {
  hljs.registerLanguage(language, definition);
}

function languageFromShebang(content: string): SupportedLanguage | null {
  const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
  const match = firstLine.match(/^#!.*\b(env\s+)?(node|nodejs|python(?:3)?|go|dotnet|csharp|rustc)\b/i);
  if (!match) return null;
  const executable = match[2].toLowerCase();
  if (executable.startsWith("python")) return "python";
  if (executable === "node" || executable === "nodejs") return "javascript";
  if (executable === "dotnet" || executable === "csharp") return "csharp";
  if (executable === "rustc") return "rust";
  return executable as SupportedLanguage;
}

export function detectLanguage(fileName: string, content: string): SupportedLanguage | null {
  const baseName = fileName.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  const extension = baseName.includes(".") ? baseName.split(".").pop() ?? "" : "";
  const byExtension = LANGUAGE_ALIASES[extension];
  if (byExtension) return byExtension;

  const byName = LANGUAGE_ALIASES[baseName];
  return byName ?? languageFromShebang(content);
}

export interface HighlightResult {
  language: SupportedLanguage | null;
  highlighted: boolean;
  html: string | null;
}

export function highlightSource(fileName: string, content: string, truncated = false): HighlightResult {
  const language = detectLanguage(fileName, content);
  if (!language || truncated || content.length > MAX_HIGHLIGHT_CHARS) {
    return { language, highlighted: false, html: null };
  }

  try {
    return {
      language,
      highlighted: true,
      html: hljs.highlight(content, { language, ignoreIllegals: true }).value,
    };
  } catch {
    return { language, highlighted: false, html: null };
  }
}
