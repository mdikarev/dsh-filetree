import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectImageType, looksLikeSvg, MAX_IMAGE_BYTES, MAX_SVG_BYTES } from "../src/image-types.js";

const h = (hex: string) => new Uint8Array(Buffer.from(hex, "hex"));
const enc = (s: string) => new TextEncoder().encode(s);

describe("detectImageType", () => {
  it("detects png", () => {
    assert.deepEqual(detectImageType(h("89504e470d0a1a0a0000000d49484452")), { kind: "raster", mime: "image/png" });
  });
  it("detects jpeg", () => {
    assert.deepEqual(detectImageType(h("ffd8ffe000104a4649460001")), { kind: "raster", mime: "image/jpeg" });
  });
  it("detects gif (87a and 89a)", () => {
    assert.deepEqual(detectImageType(enc("GIF87a")), { kind: "raster", mime: "image/gif" });
    assert.deepEqual(detectImageType(enc("GIF89a rest")), { kind: "raster", mime: "image/gif" });
  });
  it("detects webp (RIFF....WEBP)", () => {
    const buf = new Uint8Array(12);
    buf.set(enc("RIFF"), 0);
    buf.set(enc("WEBP"), 8);
    assert.deepEqual(detectImageType(buf), { kind: "raster", mime: "image/webp" });
  });
  it("detects avif via ftyp brand", () => {
    const buf = new Uint8Array(12);
    buf.set(enc("....ftypavif"), 0);
    assert.deepEqual(detectImageType(buf), { kind: "raster", mime: "image/avif" });
  });
  it("returns null for unknown bytes and empty input", () => {
    assert.equal(detectImageType(enc("plain text!!")), null);
    assert.equal(detectImageType(new Uint8Array(0)), null);
  });
});

describe("looksLikeSvg", () => {
  it("accepts an svg document", () => {
    assert.equal(looksLikeSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'), true);
  });
  it("accepts xml-declared svg", () => {
    assert.equal(looksLikeSvg('<?xml version="1.0"?><svg viewBox="0 0 1 1"></svg>'), true);
  });
  it("accepts prefixed svg elements", () => {
    assert.equal(looksLikeSvg('<svg:svg xmlns:svg="x"></svg:svg>'), true);
  });
  it("rejects plain text and html", () => {
    assert.equal(looksLikeSvg("hello world"), false);
    assert.equal(looksLikeSvg("<!DOCTYPE html><html></html>"), false);
  });
});

describe("limits", () => {
  it("exposes raster 20MB and svg 2MB caps", () => {
    assert.equal(MAX_IMAGE_BYTES, 20 * 1024 * 1024);
    assert.equal(MAX_SVG_BYTES, 2 * 1024 * 1024);
  });
});
