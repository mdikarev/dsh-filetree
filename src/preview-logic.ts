// src/preview-logic.ts
// Pure preview presentation helpers (no React/DOM): classifying a file's
// preview presentation (source / highlighted source / rendered markdown) and
// the changed-preview confirmation state machine. Kept out of Panel.tsx so
// the panel component stays about wiring state to UI, and the helpers stay
// unit-testable without a component tree.
import { isMarkdownFile, rawMarkdownImageUrl, renderMarkdown } from "./markdown-preview.js";
import { highlightSource } from "./syntax-highlighting.js";
import type { FileChange, FileChangeKind } from "./live-refresh.js";

export type PreviewPresentation =
  | { kind: "rendered"; html: string; blockedExternalImages: number }
  | { kind: "source" | "highlighted-source"; content: string; html?: string | null; error?: string };

export function getPreviewPresentation(
  fileName: string,
  content: string,
  truncated: boolean,
  mode: "source" | "rendered",
  workspaceHint: string,
  imageCapForMarkdown?: string | null,
): PreviewPresentation {
  const highlighted = highlightSource(fileName, content, truncated);
  if (!isMarkdownFile(fileName) || mode === "source") {
    return highlighted.highlighted
      ? { kind: "highlighted-source", content, html: highlighted.html }
      : { kind: "source", content };
  }
  try {
    const resourceUrl = imageCapForMarkdown
      ? (resource: string) => rawMarkdownImageUrl(workspaceHint, fileName, resource, imageCapForMarkdown)
      : undefined;
    return { kind: "rendered", ...renderMarkdown(content, { filePath: fileName, workspaceHint, resourceUrl }) };
  } catch (error) {
    return { kind: "source", content, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Pure confirmation state for the changed-preview banner. The coordinator's
 * change callback delivers debounced per-path changes; these helpers match
 * them against the current preview identity (the preview path; workspace
 * identity is already enforced by the coordinator's hint-keyed lifecycle)
 * and drive the banner's show / dismiss / refresh-clear transitions.
 */
export type ChangedPreviewState =
  | { kind: "idle" }
  | { kind: "changed"; path: string; changeKind: FileChangeKind }
  | { kind: "dismissed"; path: string };

export { type FileChangeKind };

/**
 * Reduce a change batch against the current preview path. Changes for other
 * files never show the banner; a matching event shows it (repeated events for
 * an already-shown file keep a single banner); a dismissed banner re-appears
 * only for a new event of the same file; a banner for a different file than
 * the current preview is stale and is cleared.
 */
export function reduceChangedPreview(
  state: ChangedPreviewState,
  changes: FileChange[],
  previewPath: string | null
): ChangedPreviewState {
  if (previewPath === null) return { kind: "idle" };
  if (state.kind !== "idle" && state.path !== previewPath) {
    state = { kind: "idle" };
  }
  const match = changes.find((change) => change.path === previewPath);
  if (!match) return state;
  if (state.kind === "changed" && state.path === match.path) return state;
  return { kind: "changed", path: match.path, changeKind: match.kind };
}

/** Hide the banner and remember the file until its next change event. */
export function dismissChangedPreview(state: ChangedPreviewState): ChangedPreviewState {
  return state.kind === "changed" ? { kind: "dismissed", path: state.path } : state;
}

/** Clear the banner after a successful refresh. */
export function clearChangedPreview(): ChangedPreviewState {
  return { kind: "idle" };
}
