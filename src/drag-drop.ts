// src/drag-drop.ts
// Drag-and-drop of tree rows into the DSH composer: @-mention grammar for the
// dropped path, drag payload encoding, draft insertion through the input
// machine's single write path, and the document-level drop listeners.
//
// The DSH web shell already treats `@path` in the prompt as a user-referenced
// file (host guidance: "Paths prefixed with @ are files explicitly referenced
// by the user"), so a drop inserts the same mention grammar the @-menu uses:
// `@src/Panel.tsx` for files, `@src/` for directories, `@"path with spaces"`
// quoted when whitespace is present. A drop is a FINAL insertion (no directory
// descent), so quotes are always closed — unlike the @-menu's open-quote
// completion form.

export const DRAG_MIME = "application/x-dsh-filemanager";
/** Class toggled on the composer card while our drag hovers it. */
export const DRAG_HINT_CLASS = "fm-drop-hint";

export type DragKind = "file" | "dir" | "symlink-file" | "symlink-dir";

export interface DragPayload {
  path: string;
  kind: DragKind;
}

export interface EditRange {
  start: number;
  end: number;
  insertedLength: number;
}

const DRAG_KINDS: readonly DragKind[] = ["file", "dir", "symlink-file", "symlink-dir"];

/** Characters the @-mention grammar cannot represent safely. */
const UNREPRESENTABLE = /[\u0000-\u001f\u007f-\u009f"]/u;

export function isDirKind(kind: DragKind): boolean {
  return kind === "dir" || kind === "symlink-dir";
}

/**
 * Build the DSH `@`-mention for a dropped tree row: `@path` (file),
 * `@path/` (directory), `@"path"` / `@"path/"` when the path has
 * whitespace. Returns `undefined` for paths the grammar cannot represent.
 */
export function buildDragMention(path: string, kind: DragKind): string | undefined {
  if (path.length === 0 || UNREPRESENTABLE.test(path)) return undefined;
  const withSlash = isDirKind(kind) ? path + "/" : path;
  if (!/\s/u.test(withSlash)) return "@" + withSlash;
  return '@"' + withSlash + '"';
}

export function encodeDragPayload(path: string, kind: DragKind): string {
  return JSON.stringify({ path, kind });
}

export function parseDragPayload(raw: string): DragPayload | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.path !== "string") return null;
    if (!DRAG_KINDS.includes(obj.kind as DragKind)) return null;
    return { path: obj.path, kind: obj.kind as DragKind };
  } catch {
    return null;
  }
}

/**
 * Compose the next draft for an insertion at [start, end): replace the
 * selection with `mention` and report the edit shape (previous-draft
 * coordinates) for the input machine's occurrence math.
 */
export function composeInsert(
  draft: string,
  start: number,
  end: number,
  mention: string
): { next: string; editRange: EditRange } {
  const s = Math.min(Math.max(0, start), draft.length);
  const e = Math.min(Math.max(s, end), draft.length);
  return {
    next: draft.slice(0, s) + mention + draft.slice(e),
    editRange: { start: s, end: e, insertedLength: mention.length },
  };
}

export function hasDragTypes(types: readonly string[]): boolean {
  return types.includes(DRAG_MIME);
}

/** Draft phases that accept a drop insertion ('submitting'/'adjudicating' refuse). */
export function isInsertablePhase(phase: string): boolean {
  return phase === "plain" || phase === "claimed";
}

/**
 * Insert `mention` into the composer draft through the caller's setDraft
 * (the input machine's single write path). Returns the caret offset after the
 * insertion, or `null` when the drop must be ignored (locked phase or empty
 * mention).
 */
export function insertMentionIntoInput(opts: {
  setDraft(text: string, editRange: EditRange): void;
  draft: string;
  phase: string;
  selectionStart: number;
  selectionEnd: number;
  mention: string;
}): number | null {
  if (!isInsertablePhase(opts.phase)) return null;
  if (opts.mention.length === 0) return null;
  const { next, editRange } = composeInsert(
    opts.draft,
    opts.selectionStart,
    opts.selectionEnd,
    opts.mention
  );
  opts.setDraft(next, editRange);
  return editRange.start + opts.mention.length;
}

/** Restore the caret on the next animation frame (mirrors the composer's own handlers). */
export function restoreCaretOnFrame(
  el: { setSelectionRange(start: number, end: number): void },
  caret: number
): void {
  const raf =
    typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : (cb: () => void) => setTimeout(cb, 0);
  raf(() => {
    try {
      el.setSelectionRange(caret, caret);
    } catch {
      // Element not focusable / detached — nothing to restore.
    }
  });
}

export interface DragDropHandlers {
  /** Mention for this drag's dataTransfer, or `undefined` when it is not ours. */
  mentionOf(dt: DataTransfer): string | undefined;
  /** The composer card under `target`, or `null` outside the composer. */
  composerCard(target: EventTarget | null): Element | null;
  /** Insert the mention (the caller owns session/shell/textarea resolution). */
  onDropMention(mention: string, card: Element, ev: DragEvent): void;
}

/**
 * Document-level capture listeners: allow the drop on the composer card and
 * insert the mention. Only our custom MIME triggers anything; OS file drags
 * and unrelated drags pass through untouched.
 */
export function installDragDropListeners(handlers: DragDropHandlers): () => void {
  let hintCard: Element | null = null;

  const clearHint = (): void => {
    if (hintCard) {
      hintCard.classList.remove(DRAG_HINT_CLASS);
      hintCard = null;
    }
  };

  const onDragOver = (ev: Event): void => {
    const dt = (ev as DragEvent).dataTransfer;
    if (!dt || handlers.mentionOf(dt) === undefined) return;
    const card = handlers.composerCard(ev.target);
    if (!card) return;
    ev.preventDefault();
    try {
      dt.dropEffect = "copy";
    } catch {
      // read-only dataTransfer — effect is cosmetic.
    }
    if (hintCard !== card) {
      clearHint();
      card.classList.add(DRAG_HINT_CLASS);
      hintCard = card;
    }
  };

  const onDrop = (ev: Event): void => {
    const dt = (ev as DragEvent).dataTransfer;
    if (!dt) return;
    const mention = handlers.mentionOf(dt);
    if (mention === undefined) return;
    const card = handlers.composerCard(ev.target);
    if (!card) return;
    ev.preventDefault();
    clearHint();
    handlers.onDropMention(mention, card, ev as DragEvent);
  };

  const onDragLeave = (ev: Event): void => {
    const dt = (ev as DragEvent).dataTransfer;
    if (dt && handlers.mentionOf(dt) !== undefined) clearHint();
  };

  const onDragEnd = (): void => clearHint();

  document.addEventListener("dragover", onDragOver, true);
  document.addEventListener("drop", onDrop, true);
  document.addEventListener("dragleave", onDragLeave, true);
  document.addEventListener("dragend", onDragEnd, true);

  return () => {
    document.removeEventListener("dragover", onDragOver, true);
    document.removeEventListener("drop", onDrop, true);
    document.removeEventListener("dragleave", onDragLeave, true);
    document.removeEventListener("dragend", onDragEnd, true);
    clearHint();
  };
}
