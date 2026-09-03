import { describe, it } from "node:test";
import assert from "node:assert";
import {
  detectLocale,
  getMessage,
  getLocale,
  setLocale,
  subscribeLocale,
  type Locale,
} from "../src/l10n.js";

// Import both dictionaries indirectly through getMessage: en is
// default so en keys are the source; completeness of ru is enforced
// by the Record<L10nKey, string> type in l10n.ts (compile-time).

describe("detectLocale", () => {
  it("prefers an explicit stored locale", () => {
    assert.strictEqual(detectLocale("en-US", "ru"), "ru");
    assert.strictEqual(detectLocale("ru", "en"), "en");
  });
  it("falls back to en for unknown navigator languages", () => {
    assert.strictEqual(detectLocale("fr-FR", null), "en");
    assert.strictEqual(detectLocale("", null), "en");
  });
  it("selects ru for ru navigator languages", () => {
    assert.strictEqual(detectLocale("ru-RU", null), "ru");
    assert.strictEqual(detectLocale("RU", null), "ru");
  });
  it("selects en for en navigator languages", () => {
    assert.strictEqual(detectLocale("en-GB", null), "en");
  });
});

describe("getMessage", () => {
  it("returns the en string by default", () => {
    assert.strictEqual(getMessage("en", "refresh"), "Refresh");
    assert.strictEqual(getMessage("en", "emptyFolder"), "Empty folder");
  });
  it("returns the ru string for ru", () => {
    assert.strictEqual(getMessage("ru", "refresh"), "Обновить");
    assert.strictEqual(getMessage("ru", "emptyFolder"), "Пустая папка");
  });
});

describe("locale store", () => {
  it("defaults to en and notifies subscribers on setLocale", () => {
    assert.strictEqual(getLocale(), "en");
    let seen: Locale | null = null;
    const off = subscribeLocale(() => { seen = getLocale(); });
    setLocale("ru");
    assert.strictEqual(seen, "ru");
    assert.strictEqual(getLocale(), "ru");
    off();
    setLocale("en");
    assert.strictEqual(getLocale(), "en");
  });
});
