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
  /** ISO-8601 creation instant; used as the recent-workspace tiebreaker. */
  createdAt?: string;
};

type SessionRow = {
  id?: string;
  /** Local ownership counts; the main view retains the displayed Session. */
  retainedBy?: Record<string, number>;
  updatedAt?: number;
};

type WorkspaceListSnapshot = {
  state?: string;
  phase?: string;
  baselinesReady?: boolean;
  recentWorkspaceId?: string;
  items?: WorkspaceRow[];
};

type SessionListSnapshot = {
  /** dsh <= 0.1.x exposed the selected Session here. */
  current?: string;
  phase?: string;
  /**
   * dsh >= 0.2 removed `current` from the Session list snapshot. The displayed
   * Session is the row the main view retains (`retainedBy.mainView > 0`).
   */
  byId?: Record<string, SessionRow>;
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
 * The Session the main view currently displays.
 * dsh <= 0.1.x exposed it as `current`; dsh >= 0.2 exposes rows in `byId`
 * and marks the displayed one with `retainedBy.mainView > 0` (the same
 * mechanism DocumentTitle uses).
 */
function selectedSessionId(snapshot: SessionListSnapshot | undefined): string | undefined {
  if (snapshot === undefined) return undefined;
  if (typeof snapshot.current === "string") return snapshot.current;
  const byId = snapshot.byId;
  if (byId === undefined) return undefined;
  for (const row of Object.values(byId)) {
    if (row && (row.retainedBy?.mainView ?? 0) > 0 && typeof row.id === "string") {
      return row.id;
    }
  }
  return undefined;
}

/**
 * Workspace path with the most recently updated Session (mirrors DSH's
 * recentWorkspace): dsh >= 0.2 dropped `recentWorkspaceId` from the list
 * snapshot, so derive it from Session `updatedAt` rows, falling back to the
 * Workspace creation instant.
 */
function recentWorkspacePath(
  items: WorkspaceRow[],
  snapshot: SessionListSnapshot | undefined,
): string | undefined {
  const byId = snapshot?.byId;
  if (byId === undefined) return undefined;
  let selectedPath: string | undefined;
  let selectedTime = Number.NEGATIVE_INFINITY;
  for (const workspace of items) {
    let latest = Number.NEGATIVE_INFINITY;
    for (const id of workspace.sessionIds ?? []) {
      const row = byId[id];
      if (row && typeof row.updatedAt === "number") latest = Math.max(latest, row.updatedAt);
    }
    if (latest === Number.NEGATIVE_INFINITY && typeof workspace.createdAt === "string") {
      const created = Date.parse(workspace.createdAt);
      if (!Number.isNaN(created)) latest = created;
    }
    if (selectedPath === undefined || latest > selectedTime) {
      selectedPath = workspace.path;
      selectedTime = latest;
    }
  }
  return selectedPath;
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
  const curId = selectedSessionId(sesSnap);
  if (curId !== undefined) {
    current = items.find(
      (workspace) => Array.isArray(workspace.sessionIds) && workspace.sessionIds.includes(curId),
    );
  }

  const chosen =
    current ??
    rowWithPath(items, previousHint) ??
    rowWithPath(items, recentWorkspacePath(items, sesSnap)) ??
    items.find((workspace) => workspace.workspaceId === snapshot.recentWorkspaceId) ??
    items[0];
  return typeof chosen?.path === "string"
    ? { status: "ready", hint: chosen.path }
    : { status: "ready" };
}
