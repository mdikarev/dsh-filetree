// Maps the DSH workspace/session snapshots onto the file-tree hint.
// Pure: Node-test safe, no React.

export interface WorkspaceState {
  status: "loading" | "ready" | "empty";
  hint?: string;
}

type WorkspaceRow = {
  workspaceId?: string;
  path?: string;
  sessionIds?: string[];
};

type WorkspaceListSnapshot = {
  state?: string;
  phase?: string;
  baselinesReady?: boolean;
  recentWorkspaceId?: string;
  items?: WorkspaceRow[];
};

type SessionListSnapshot = {
  current?: string;
  phase?: string;
};

function listIsReady(snapshot: WorkspaceListSnapshot): boolean {
  // dsh 0.1.2+: `phase` is the monotone arrival flag. `state` can be
  // "loading" during a follow reconnect while items stay visible
  // (handleCarrierFailure) — dropping the hint there retriggers Panel's
  // loadRoot spinner forever.
  if (snapshot.phase !== undefined) return snapshot.phase === "ready";
  if (snapshot.state === "loading") return false;
  return snapshot.baselinesReady === true;
}

function rowWithPath(items: WorkspaceRow[], path: string | undefined): WorkspaceRow | undefined {
  if (path === undefined) return undefined;
  return items.find((workspace) => workspace.path === path);
}

/**
 * Resolve which workspace path the file tree should show.
 * @param workspaces - DSH `ctx.workspaces` (needs `.list.getSnapshot()`).
 * @param sessions - DSH `ctx.sessions` (needs `.list.getSnapshot()`).
 * @param previousHint - last shown path; kept across session-list flaps so
 *   Panel does not restart `loadRoot` with a spinner.
 */
export function computeWorkspaceState(
  workspaces: unknown,
  sessions: unknown,
  previousHint?: string,
): WorkspaceState {
  const list = (workspaces as { list?: { getSnapshot?: () => WorkspaceListSnapshot } } | undefined)?.list;
  if (list === undefined) return { status: "ready" };

  let snapshot: WorkspaceListSnapshot;
  try {
    snapshot = list.getSnapshot?.() ?? {};
  } catch {
    return { status: "ready" };
  }

  if (!listIsReady(snapshot)) {
    return previousHint !== undefined && previousHint !== ""
      ? { status: "ready", hint: previousHint }
      : { status: "loading" };
  }

  const items = snapshot.items;
  if (!Array.isArray(items) || items.length === 0) return { status: "empty" };

  let sesSnap: SessionListSnapshot | undefined;
  try {
    sesSnap = (sessions as { list?: { getSnapshot?: () => SessionListSnapshot } } | undefined)
      ?.list?.getSnapshot?.();
  } catch {
    sesSnap = undefined;
  }

  // Same gate ConversationRoot uses: do not guess items[0] until the session
  // list has arrived, or the hint ping-pongs and the tree reloads forever.
  if (sesSnap?.phase === "pending") {
    return previousHint !== undefined && previousHint !== ""
      ? { status: "ready", hint: previousHint }
      : { status: "loading" };
  }

  let current: WorkspaceRow | undefined;
  const curId = sesSnap?.current;
  if (curId !== undefined) {
    current = items.find(
      (workspace) => Array.isArray(workspace.sessionIds) && workspace.sessionIds.includes(curId),
    );
  }

  const chosen =
    current ??
    rowWithPath(items, previousHint) ??
    items.find((workspace) => workspace.workspaceId === snapshot.recentWorkspaceId) ??
    items[0];
  return typeof chosen?.path === "string"
    ? { status: "ready", hint: chosen.path }
    : { status: "ready" };
}
