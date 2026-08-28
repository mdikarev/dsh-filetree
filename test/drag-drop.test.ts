// test/drag-drop.test.ts
// Pure drag-and-drop helpers: @-mention grammar for dropped tree rows,
// drag payload encoding, draft insertion composition, and drop guards.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DRAG_MIME,
  buildDragMention,
  encodeDragPayload,
  parseDragPayload,
  composeInsert,
  hasDragTypes,
  isInsertablePhase,
  insertMentionIntoInput,
} from "../src/drag-drop.js";

describe("buildDragMention", () => {
  it("prefixes a file path with @", () => {
    assert.equal(buildDragMention("src/Panel.tsx", "file"), "@src/Panel.tsx");
  });

  it("appends a trailing slash to a directory", () => {
    assert.equal(buildDragMention("src", "dir"), "@src/");
  });

  it("treats symlink kinds like their target kind", () => {
    assert.equal(buildDragMention("link", "symlink-file"), "@link");
    assert.equal(buildDragMention("linkdir", "symlink-dir"), "@linkdir/");
  });

  it("quotes paths with whitespace (closed quotes for files)", () => {
    assert.equal(buildDragMention("my file.ts", "file"), '@"my file.ts"');
  });

  it("quotes directories with whitespace including the trailing slash", () => {
    assert.equal(buildDragMention("my dir", "dir"), '@"my dir/"');
  });

  it("returns undefined for paths the grammar cannot represent", () => {
    assert.equal(buildDragMention('a"b.ts', "file"), undefined);
    assert.equal(buildDragMention("a\u0000b.ts", "file"), undefined);
    assert.equal(buildDragMention("a\u007fb.ts", "file"), undefined);
    assert.equal(buildDragMention("", "file"), undefined);
  });
});

describe("drag payload encoding", () => {
  it("encodes path and kind as JSON", () => {
    assert.equal(encodeDragPayload("src/Panel.tsx", "file"), '{"path":"src/Panel.tsx","kind":"file"}');
  });

  it("round-trips through parseDragPayload", () => {
    const payload = { path: "a b/c.ts", kind: "dir" as const };
    assert.deepEqual(parseDragPayload(encodeDragPayload(payload.path, payload.kind)), payload);
  });

  it("rejects malformed payloads", () => {
    assert.equal(parseDragPayload("not json"), null);
    assert.equal(parseDragPayload('{"path":"x"}'), null);
    assert.equal(parseDragPayload('{"path":"x","kind":"bogus"}'), null);
    assert.equal(parseDragPayload('{"path":42,"kind":"file"}'), null);
  });
});

describe("composeInsert", () => {
  it("inserts at the caret", () => {
    assert.deepEqual(composeInsert("hello", 2, 2, "@a"), {
      next: "he@allo",
      editRange: { start: 2, end: 2, insertedLength: 2 },
    });
  });

  it("inserts at the start", () => {
    assert.deepEqual(composeInsert("abc", 0, 0, "@x"), {
      next: "@xabc",
      editRange: { start: 0, end: 0, insertedLength: 2 },
    });
  });

  it("appends at the end", () => {
    assert.deepEqual(composeInsert("hello", 5, 5, "@z/"), {
      next: "hello@z/",
      editRange: { start: 5, end: 5, insertedLength: 3 },
    });
  });

  it("replaces a selection", () => {
    assert.deepEqual(composeInsert("hello", 1, 3, "@x"), {
      next: "h@xlo",
      editRange: { start: 1, end: 3, insertedLength: 2 },
    });
  });

  it("clamps out-of-range coordinates", () => {
    assert.deepEqual(composeInsert("ab", 99, 99, "@x"), {
      next: "ab@x",
      editRange: { start: 2, end: 2, insertedLength: 2 },
    });
  });
});

describe("drop guards", () => {
  it("hasDragTypes detects the custom MIME", () => {
    assert.equal(hasDragTypes([DRAG_MIME]), true);
    assert.equal(hasDragTypes([DRAG_MIME, "text/plain"]), true);
    assert.equal(hasDragTypes(["text/plain"]), false);
    assert.equal(hasDragTypes([]), false);
  });

  it("isInsertablePhase allows plain and claimed drafts", () => {
    assert.equal(isInsertablePhase("plain"), true);
    assert.equal(isInsertablePhase("claimed"), true);
    assert.equal(isInsertablePhase("submitting"), false);
    assert.equal(isInsertablePhase("adjudicating"), false);
    assert.equal(isInsertablePhase("bogus"), false);
  });
});

describe("insertMentionIntoInput", () => {
  it("writes through setDraft with the composed edit range", () => {
    const calls: Array<{ text: string; editRange: unknown }> = [];
    const caret = insertMentionIntoInput({
      setDraft: (text, editRange) => calls.push({ text, editRange }),
      draft: "hello",
      phase: "plain",
      selectionStart: 2,
      selectionEnd: 2,
      mention: "@a",
    });
    assert.equal(caret, 4);
    assert.deepEqual(calls, [
      { text: "he@allo", editRange: { start: 2, end: 2, insertedLength: 2 } },
    ]);
  });

  it("refuses insertion while submitting", () => {
    const calls: unknown[] = [];
    const caret = insertMentionIntoInput({
      setDraft: (text, editRange) => calls.push([text, editRange]),
      draft: "hello",
      phase: "submitting",
      selectionStart: 0,
      selectionEnd: 0,
      mention: "@a",
    });
    assert.equal(caret, null);
    assert.equal(calls.length, 0);
  });

  it("returns null for an unrepresentable mention", () => {
    const calls: unknown[] = [];
    const caret = insertMentionIntoInput({
      setDraft: (text, editRange) => calls.push([text, editRange]),
      draft: "hello",
      phase: "plain",
      selectionStart: 0,
      selectionEnd: 0,
      mention: "",
    });
    assert.equal(caret, null);
    assert.equal(calls.length, 0);
  });

  it("clamps a stale caret beyond the draft", () => {
    const calls: Array<{ text: string }> = [];
    const caret = insertMentionIntoInput({
      setDraft: (text) => calls.push({ text }),
      draft: "ab",
      phase: "plain",
      selectionStart: 99,
      selectionEnd: 99,
      mention: "@x",
    });
    assert.equal(caret, 4);
    assert.deepEqual(calls, [{ text: "ab@x" }]);
  });
});
