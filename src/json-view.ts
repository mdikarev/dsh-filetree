// src/json-view.ts

export type JsonViewMode = "raw" | "pretty";
export const JSON_PRETTY_MAX_CHARS = 1_000_000;

export function isJsonFile(name: string): boolean {
  return name.toLowerCase().endsWith(".json");
}

export interface JsonDisplay {
  text: string;
  note: "parse" | "too-large" | null;
}

export function formatJson(content: string, mode: JsonViewMode, truncated: boolean): JsonDisplay {
  if (mode === "raw") return { text: content, note: null };
  if (truncated) return { text: content, note: null };
  if (content.length > JSON_PRETTY_MAX_CHARS) {
    return { text: content, note: "too-large" };
  }
  try {
    return { text: JSON.stringify(JSON.parse(content), null, 2), note: null };
  } catch {
    return { text: content, note: "parse" };
  }
}
