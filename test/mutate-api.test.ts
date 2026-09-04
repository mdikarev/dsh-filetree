import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fetchDeleteInfo, fetchDelete } from "../src/mutate-api.js";

type FetchArgs = [string, RequestInit?];
let captured: FetchArgs[] = [];

afterEach(() => { captured = []; });

function mockFetch(status: number, body: unknown) {
  (globalThis as any).fetch = async (input: any, init?: RequestInit) => {
    captured.push([String(input), init ?? {}]);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
}

describe("mutate-api", () => {
  it("fetchDeleteInfo hits the action with the header and parses the body", async () => {
    mockFetch(200, { kind: "file", name: "a.txt", path: "a.txt", isRoot: false, uncommitted: true });
    const info = await fetchDeleteInfo("/ws", "a.txt");
    assert.equal(info.kind, "file");
    assert.equal(info.uncommitted, true);
    const [url, init] = captured[0] as FetchArgs;
    assert.ok(url.includes("/filemanager-fs/delete-info"));
    assert.equal((init.headers as Record<string, string>)["x-dsh-filemanager"], "1");
  });

  it("fetchDelete posts and parses success", async () => {
    mockFetch(200, { deleted: true, path: "a.txt" });
    const res = await fetchDelete("/ws", "a.txt");
    assert.equal(res.deleted, true);
    const [url, init] = captured[0] as FetchArgs;
    assert.ok(url.includes("/filemanager-fs/delete"));
    assert.equal((init as RequestInit).method, "POST");
  });

  it("throws the server error message on failure", async () => {
    mockFetch(403, { error: "cannot delete workspace root" });
    await assert.rejects(() => fetchDelete("/ws", ""), /cannot delete workspace root/);
  });
});
