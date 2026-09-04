import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isJsonFile, formatJson, JSON_PRETTY_MAX_CHARS } from "../src/json-view.js";

describe("isJsonFile", () => {
  it("matches .json case-insensitively", () => {
    assert.equal(isJsonFile("config.json"), true);
    assert.equal(isJsonFile("a.JSON"), true);
    assert.equal(isJsonFile("config.jsonc"), false);
    assert.equal(isJsonFile("package.json.orig"), false);
  });
});

describe("formatJson", () => {
  const pretty = (content: string) => formatJson(content, "pretty", false);
  it("formats valid json with two-space indent", () => {
    const { text, note } = pretty('{"b":1,"a":[true,null]}');
    assert.equal(text, '{\n  "b": 1,\n  "a": [\n    true,\n    null\n  ]\n}');
    assert.equal(note, null);
  });
  it("keeps raw mode untouched", () => {
    const { text, note } = formatJson('{"a":1}', "raw", false);
    assert.equal(text, '{"a":1}');
    assert.equal(note, null);
  });
  it("falls back to raw with a parse note on invalid json", () => {
    const { text, note } = pretty("{ nope");
    assert.equal(text, "{ nope");
    assert.equal(note, "parse");
  });
  it("falls back to raw with a too-large note over the cap", () => {
    const big = '{"pad":"' + "x".repeat(JSON_PRETTY_MAX_CHARS) + '"}';
    const { text, note } = pretty(big);
    assert.equal(text, big);
    assert.equal(note, "too-large");
  });
  it("does not attempt pretty on truncated files", () => {
    const { note } = formatJson('{"a":1}', "pretty", true);
    assert.equal(note, null);
  });
});
