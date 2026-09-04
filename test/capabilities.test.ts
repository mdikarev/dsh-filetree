import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCapabilityIssuer, DEFAULT_CAP_TTL_MS } from "../src/capabilities.js";

describe("capability issuer", () => {
  it("issues a token per hint that validates", () => {
    const cap = createCapabilityIssuer({ randomToken: () => "tok1" });
    const t = cap.issueFor("/ws/a");
    assert.ok(t.length > 0);
    assert.equal(cap.isValid("/ws/a", t), true);
  });
  it("scopes tokens to their hint", () => {
    const cap = createCapabilityIssuer({ randomToken: () => "tok1" });
    const t = cap.issueFor("/ws/a");
    assert.equal(cap.isValid("/ws/b", t), false);
    assert.equal(cap.isValid("/ws/a", "tok2"), false);
  });
  it("rotates on every issueFor: only the newest token is valid", () => {
    let i = 0;
    const cap = createCapabilityIssuer({ randomToken: () => (i += 1) === 1 ? "old" : "new" });
    cap.issueFor("/ws/a");
    const fresh = cap.issueFor("/ws/a");
    assert.equal(cap.isValid("/ws/a", "old"), false);
    assert.equal(cap.isValid("/ws/a", fresh), true);
  });
  it("expires tokens after ttlMs", () => {
    let now = 1_000_000;
    const cap = createCapabilityIssuer({ now: () => now, ttlMs: 100, randomToken: () => "tok" });
    const t = cap.issueFor("/ws/a");
    assert.equal(cap.isValid("/ws/a", t), true);
    now += 101;
    assert.equal(cap.isValid("/ws/a", t), false);
  });
  it("defaults ttl to 8 hours", () => {
    assert.equal(DEFAULT_CAP_TTL_MS, 8 * 60 * 60 * 1000);
  });
});
