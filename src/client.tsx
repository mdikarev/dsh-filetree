// src/client.tsx
import { useState, useEffect, useSyncExternalStore } from "react";
import { CSS_STRING } from "./styles.js";
import { createStore, toggle, close, type FileManagerStore } from "./store.js";
import { ToggleTab } from "./ToggleTab.js";
import { Panel } from "./Panel.js";

// Services this client plugin depends on; the loader derives the plugin
// fiber's injection list from this module's `inject` export (package.json's
// dsh.client.inject only shapes the module graph, not service injection).
export const inject = ["slots", "workspaces", "sessions"];

const CSS_TAG_ID = "dsh-filemanager-css";

function injectCss(css: string): void {
  if (document.getElementById(CSS_TAG_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_TAG_ID;
  style.textContent = css;
  document.head.appendChild(style);
}

// Shared store instance (created once per client lifecycle)
let sharedStore: FileManagerStore | null = null;

function getStore(): FileManagerStore {
  if (!sharedStore) {
    sharedStore = createStore();
  }
  return sharedStore;
}

// Hook to use store in components
function useStore(): { open: boolean; toggle: () => void; close: () => void } {
  const store = getStore();
  const open = useSyncExternalStore(
    store.subscribe,
    () => store.getState().open
  );
  return {
    open,
    toggle: () => toggle(store),
    close: () => close(store),
  };
}

// Compute workspace state from DSH context
interface WorkspaceState {
  status: "loading" | "ready" | "empty";
  hint?: string;
}

function computeWorkspaceState(workspaces: any, sessions: any): WorkspaceState {
  const list = workspaces?.list;
  if (list === undefined) return { status: "ready" };
  
  const s = list.getSnapshot();
  if (!s || s.state === "loading" || s.baselinesReady !== true) {
    return { status: "loading" };
  }
  
  const items = s.items;
  if (!Array.isArray(items) || items.length === 0) {
    return { status: "empty" };
  }

  // Find workspace for current session
  let current: any;
  try {
    const sesSnap = sessions?.list?.getSnapshot();
    const curId = sesSnap?.current;
    if (curId !== undefined) {
      current = items.find(
        (w: any) => Array.isArray(w.sessionIds) && w.sessionIds.includes(curId)
      );
    }
  } catch {}

  const chosen = current ?? items.find((w: any) => w.workspaceId === s.recentWorkspaceId) ?? items[0];
  return typeof chosen?.path === "string" 
    ? { status: "ready", hint: chosen.path } 
    : { status: "ready" };
}

// Main component that wraps ToggleTab + Panel
function FileManager({ workspaces, sessions }: any) {
  const { open, toggle: doToggle, close: doClose } = useStore();
  const [sidebarLeft, setSidebarLeft] = useState(0);
  const [ws, setWs] = useState<WorkspaceState>(() => 
    computeWorkspaceState(workspaces, sessions)
  );

  // Subscribe to workspace/session changes
  useEffect(() => {
    const update = () => setWs(computeWorkspaceState(workspaces, sessions));
    const offs: Array<() => void> = [];
    
    if (workspaces?.list !== undefined) {
      offs.push(workspaces.list.subscribe(update));
    }
    if (sessions?.list !== undefined) {
      offs.push(sessions.list.subscribe(update));
    }
    
    update();
    return () => offs.forEach(off => off());
  }, [workspaces?.list, sessions?.list]);

  const hint = ws.hint ?? "";

  return (
    <>
      <ToggleTab
        open={open}
        onToggle={doToggle}
        onSidebarLeft={setSidebarLeft}
      />
      <Panel
        open={open}
        sidebarLeft={sidebarLeft}
        hint={hint}
        onClose={doClose}
      />
    </>
  );
}

export function apply(ctx: any): void {
  // Inject CSS
  injectCss(CSS_STRING);

  // Register into shell.overlay slot
  ctx.slots.inject("shell.overlay", () => {
    const dispose = ctx.slots.register(
      {
        name: "shell.overlay",
        id: "filemanager",
        order: 50,
        inject: () => ({
          workspaces: ctx.workspaces,
          sessions: ctx.sessions,
        }),
      },
      FileManager
    );

    return dispose;
  });
}
