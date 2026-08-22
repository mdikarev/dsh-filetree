// test/git-status.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  getGitStatusBadge,
  getEntryGitTone,
  getDirectoryGitStatus,
  type Entry,
} from "../src/api.js";

describe("getGitStatusBadge", () => {
  it("returns badge letters for file statuses", () => {
    assert.strictEqual(getGitStatusBadge("modified"), "M");
    assert.strictEqual(getGitStatusBadge("added"), "A");
    assert.strictEqual(getGitStatusBadge("deleted"), "D");
    assert.strictEqual(getGitStatusBadge("untracked"), "?");
    assert.strictEqual(getGitStatusBadge("ignored"), "I");
  });

  it("returns null for entries without git status", () => {
    assert.strictEqual(getGitStatusBadge(undefined), null);
  });
});

describe("getEntryGitTone", () => {
  it("treats ignored entries as muted", () => {
    assert.strictEqual(getEntryGitTone({ name: "dist", kind: "dir", gitStatus: "ignored" }), "ignored");
  });

  it("treats modified and added entries as tracked changes", () => {
    assert.strictEqual(getEntryGitTone({ name: "index.ts", kind: "file", gitStatus: "modified" }), "changed");
    assert.strictEqual(getEntryGitTone({ name: "new.ts", kind: "file", gitStatus: "added" }), "changed");
  });

  it("treats directories with changed descendants as tracked changes", () => {
    assert.strictEqual(
      getEntryGitTone({ name: "src", kind: "dir", gitStatusSummary: ["modified"] }),
      "changed",
    );
  });

  it("treats directories with untracked descendants separately", () => {
    assert.strictEqual(
      getEntryGitTone({ name: "drafts", kind: "dir", gitStatusSummary: ["untracked"] }),
      "untracked",
    );
  });

  it("treats ignored-only directories as ignored", () => {
    assert.strictEqual(
      getEntryGitTone({ name: "node_modules", kind: "dir", gitStatusSummary: ["ignored"] }),
      "ignored",
    );
  });

  it("treats untracked entries separately", () => {
    assert.strictEqual(getEntryGitTone({ name: "draft.md", kind: "file", gitStatus: "untracked" }), "untracked");
  });
});

describe("getDirectoryGitStatus", () => {
  it("prefers tracked changes over untracked and ignored descendants", () => {
    const entry: Entry = {
      name: "src",
      kind: "dir",
      gitStatusSummary: ["ignored", "untracked", "modified"],
    };
    assert.strictEqual(getDirectoryGitStatus(entry), "modified");
  });

  it("returns untracked when there are no tracked changes", () => {
    const entry: Entry = {
      name: "notes",
      kind: "dir",
      gitStatusSummary: ["ignored", "untracked"],
    };
    assert.strictEqual(getDirectoryGitStatus(entry), "untracked");
  });

  it("returns ignored when descendants are ignored only", () => {
    const entry: Entry = {
      name: "dist",
      kind: "dir",
      gitStatusSummary: ["ignored"],
    };
    assert.strictEqual(getDirectoryGitStatus(entry), "ignored");
  });

  it("returns direct git status when provided on a directory", () => {
    const entry: Entry = {
      name: "src",
      kind: "dir",
      gitStatus: "added",
    };
    assert.strictEqual(getDirectoryGitStatus(entry), "added");
  });

  it("returns null when directory has no git status signal", () => {
    const entry: Entry = {
      name: "docs",
      kind: "dir",
    };
    assert.strictEqual(getDirectoryGitStatus(entry), null);
  });
});
