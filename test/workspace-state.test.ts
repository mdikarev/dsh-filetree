import { describe, it } from "node:test";
import assert from "node:assert";
import { computeWorkspaceState } from "../src/workspace-state.ts";

function listOf(snapshot: unknown) {
  return { list: { getSnapshot: () => snapshot } };
}

describe("computeWorkspaceState", () => {
  it("treats dsh 0.1.2 phase:ready as ready even without baselinesReady", () => {
    const workspaces = listOf({
      state: "idle",
      phase: "ready",
      items: [
        {
          workspaceId: "ws-1",
          path: "/Volumes/Maxon/private-eye/private-eye",
          sessionIds: ["session-a"],
        },
      ],
    });
    const sessions = listOf({ current: "session-a" });
    assert.deepStrictEqual(computeWorkspaceState(workspaces, sessions), {
      status: "ready",
      hint: "/Volumes/Maxon/private-eye/private-eye",
    });
  });

  it("stays loading while phase is pending", () => {
    const workspaces = listOf({
      state: "idle",
      phase: "pending",
      items: [{ workspaceId: "ws-1", path: "/ws", sessionIds: [] }],
    });
    assert.deepStrictEqual(computeWorkspaceState(workspaces, undefined), { status: "loading" });
  });

  it("keeps the last hint while the workspace list flaps back to pending", () => {
    const workspaces = listOf({
      state: "loading",
      phase: "pending",
      items: [],
    });
    assert.deepStrictEqual(
      computeWorkspaceState(workspaces, undefined, "/ws"),
      { status: "ready", hint: "/ws" },
    );
  });

  it("still honors the legacy baselinesReady flag when phase is absent", () => {
    const notReady = listOf({
      state: "idle",
      items: [{ workspaceId: "ws-1", path: "/ws", sessionIds: [] }],
    });
    assert.deepStrictEqual(computeWorkspaceState(notReady, undefined), { status: "loading" });

    const ready = listOf({
      state: "idle",
      baselinesReady: true,
      items: [{ workspaceId: "ws-1", path: "/ws", sessionIds: [] }],
    });
    assert.deepStrictEqual(computeWorkspaceState(ready, undefined), {
      status: "ready",
      hint: "/ws",
    });
  });

  it("follows the current session's workspace when switching", () => {
    const workspaces = listOf({
      phase: "ready",
      items: [
        { workspaceId: "a", path: "/ws/a", sessionIds: ["s-a"] },
        { workspaceId: "b", path: "/ws/b", sessionIds: ["s-b"] },
      ],
    });
    assert.strictEqual(
      computeWorkspaceState(workspaces, listOf({ current: "s-b" })).hint,
      "/ws/b",
    );
  });

  it("keeps the hint while phase is ready even if state is loading", () => {
    const workspaces = listOf({
      state: "loading",
      phase: "ready",
      items: [{ workspaceId: "ws-1", path: "/ws", sessionIds: ["s-a"] }],
    });
    assert.deepStrictEqual(
      computeWorkspaceState(workspaces, listOf({ current: "s-a", phase: "ready" })),
      { status: "ready", hint: "/ws" },
    );
  });

  it("does not guess items[0] while the session list is pending", () => {
    const workspaces = listOf({
      phase: "ready",
      items: [
        { workspaceId: "a", path: "/ws/a", sessionIds: ["s-a"] },
        { workspaceId: "b", path: "/ws/b", sessionIds: ["s-b"] },
      ],
    });
    assert.deepStrictEqual(
      computeWorkspaceState(workspaces, listOf({ phase: "pending" })),
      { status: "loading" },
    );
    assert.deepStrictEqual(
      computeWorkspaceState(workspaces, listOf({ phase: "pending" }), "/ws/b"),
      { status: "ready", hint: "/ws/b" },
    );
  });

  it("keeps the previous hint when current session is briefly unset", () => {
    const workspaces = listOf({
      phase: "ready",
      items: [
        { workspaceId: "a", path: "/ws/a", sessionIds: ["s-a"] },
        { workspaceId: "b", path: "/ws/b", sessionIds: ["s-b"] },
      ],
    });
    assert.strictEqual(
      computeWorkspaceState(workspaces, listOf({ phase: "ready" }), "/ws/b").hint,
      "/ws/b",
    );
  });
it("follows the main-view Session when dsh >= 0.2 drops `current` (switching workspaces)", () => {
    const workspaces = listOf({
      phase: "ready",
      items: [
        { workspaceId: "a", path: "/ws/a", sessionIds: ["s-a"] },
        { workspaceId: "b", path: "/ws/b", sessionIds: ["s-b"] },
      ],
    });
    // dsh 0.2: no `current`; the main view retains the displayed Session.
    const sessions = listOf({
      phase: "ready",
      ids: ["s-a", "s-b"],
      byId: {
        "s-a": { id: "s-a", retainedBy: { mainView: 0 }, updatedAt: 1 },
        "s-b": { id: "s-b", retainedBy: { mainView: 1 }, updatedAt: 2 },
      },
    });
    assert.deepStrictEqual(computeWorkspaceState(workspaces, sessions, "/ws/a"), {
      status: "ready",
      hint: "/ws/b",
    });
  });

  it("keeps the previous hint when no Session is retained by the main view", () => {
    const workspaces = listOf({
      phase: "ready",
      items: [
        { workspaceId: "a", path: "/ws/a", sessionIds: ["s-a"] },
        { workspaceId: "b", path: "/ws/b", sessionIds: ["s-b"] },
      ],
    });
    const sessions = listOf({
      phase: "ready",
      byId: {
        "s-a": { id: "s-a", retainedBy: {}, updatedAt: 1 },
        "s-b": { id: "s-b", retainedBy: {}, updatedAt: 2 },
      },
    });
    assert.strictEqual(computeWorkspaceState(workspaces, sessions, "/ws/a").hint, "/ws/a");
  });

  it("falls back to the most recently updated Workspace when dsh >= 0.2 has no recentWorkspaceId", () => {
    const workspaces = listOf({
      phase: "ready",
      items: [
        { workspaceId: "a", path: "/ws/a", sessionIds: ["s-a"], createdAt: "2026-01-01T00:00:00.000Z" },
        { workspaceId: "b", path: "/ws/b", sessionIds: ["s-b"], createdAt: "2026-01-02T00:00:00.000Z" },
      ],
    });
    const sessions = listOf({
      phase: "ready",
      byId: {
        "s-a": { id: "s-a", retainedBy: {}, updatedAt: 10 },
        "s-b": { id: "s-b", retainedBy: {}, updatedAt: 20 },
      },
    });
    assert.strictEqual(computeWorkspaceState(workspaces, sessions).hint, "/ws/b");
  });
});
