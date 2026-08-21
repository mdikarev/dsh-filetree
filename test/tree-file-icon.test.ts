// test/tree-file-icon.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { getFileIconVariant } from "../src/Tree.js";

describe("getFileIconVariant", () => {
  it("classifies code files", () => {
    assert.strictEqual(getFileIconVariant("index.ts"), "code");
    assert.strictEqual(getFileIconVariant("App.jsx"), "code");
    assert.strictEqual(getFileIconVariant("server.go"), "code");
    assert.strictEqual(getFileIconVariant("Program.cs"), "code");
    assert.strictEqual(getFileIconVariant("script.py"), "code");
    assert.strictEqual(getFileIconVariant("Main.java"), "code");
    assert.strictEqual(getFileIconVariant("app.kt"), "code");
    assert.strictEqual(getFileIconVariant("build.kts"), "code");
    assert.strictEqual(getFileIconVariant("lib.rs"), "code");
    assert.strictEqual(getFileIconVariant("index.php"), "code");
    assert.strictEqual(getFileIconVariant("script.rb"), "code");
    assert.strictEqual(getFileIconVariant("run.sh"), "code");
    assert.strictEqual(getFileIconVariant("profile.bash"), "code");
    assert.strictEqual(getFileIconVariant("aliases.zsh"), "code");
    assert.strictEqual(getFileIconVariant("App.swift"), "code");
    assert.strictEqual(getFileIconVariant("main.cpp"), "code");
    assert.strictEqual(getFileIconVariant("main.cc"), "code");
    assert.strictEqual(getFileIconVariant("main.c"), "code");
    assert.strictEqual(getFileIconVariant("main.h"), "code");
    assert.strictEqual(getFileIconVariant("main.hpp"), "code");
    assert.strictEqual(getFileIconVariant("schema.sql"), "code");
    assert.strictEqual(getFileIconVariant("index.html"), "code");
    assert.strictEqual(getFileIconVariant("styles.css"), "code");
    assert.strictEqual(getFileIconVariant("layout.xml"), "code");
    assert.strictEqual(getFileIconVariant("service.proto"), "code");
    assert.strictEqual(getFileIconVariant("query.graphql"), "code");
  });

  it("classifies data files", () => {
    assert.strictEqual(getFileIconVariant("package.json"), "data");
    assert.strictEqual(getFileIconVariant("config.yaml"), "data");
    assert.strictEqual(getFileIconVariant(".env"), "data");
  });

  it("classifies document files", () => {
    assert.strictEqual(getFileIconVariant("README.md"), "doc");
    assert.strictEqual(getFileIconVariant("notes.txt"), "doc");
  });

  it("classifies image files", () => {
    assert.strictEqual(getFileIconVariant("logo.svg"), "image");
    assert.strictEqual(getFileIconVariant("photo.webp"), "image");
  });

  it("falls back to default for unknown files", () => {
    assert.strictEqual(getFileIconVariant("archive.bin"), "default");
    assert.strictEqual(getFileIconVariant("Makefile"), "default");
  });

  it("classifies Dockerfile as special", () => {
    assert.strictEqual(getFileIconVariant("Dockerfile"), "special");
  });
});
