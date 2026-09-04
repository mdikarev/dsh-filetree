// src/client.tsx
import { useState, useEffect, useSyncExternalStore } from "react";
import { CSS_STRING } from "./styles.js";
import { createStore, toggle, close, type FileManagerStore } from "./store.js";
import { ToggleTab } from "./ToggleTab.js";
import { Panel } from "./Panel.js";
import { attachBrowserLocaleSync } from "./l10n.js";

// Services this client plugin depends on; the loader derives the plugin
// fiber's injection list from this module's `inject` export (package.json's
// dsh.client.inject only shapes the module graph, not service injection).
export const inject = ["slots", "workspaces", "sessions"];

import {
  DRAG_MIME,
  hasDragTypes,
  parseDragPayload,
  buildDragMention,
  installDragDropListeners,
} from "./drag-drop.js";
import { computeWorkspaceState, type WorkspaceState } from "./workspace-state.js";

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

// Main component that wraps ToggleTab + Panel
function FileManager({ workspaces, sessions }: any) {
  const { open, toggle: doToggle, close: doClose } = useStore();
  const store = getStore();
  const [sidebarLeft, setSidebarLeft] = useState(0);
  const [ws, setWs] = useState<WorkspaceState>(() => 
    computeWorkspaceState(workspaces, sessions)
  );

  // Subscribe to workspace/session changes
  useEffect(() => {
    const update = () => {
      setWs((prev) => {
        const next = computeWorkspaceState(workspaces, sessions, prev.hint);
        if (next.status === prev.status && next.hint === prev.hint) return prev;
        return next;
      });
    };
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
        store={store}
      />
    </>
  );
}

export function apply(ctx: any): void {
  // Inject CSS
  injectCss(CSS_STRING);

  // Keep the locale in sync across tabs (fm-locale storage events).
  attachBrowserLocaleSync();

  // Drag-and-drop of tree rows into the composer: only our custom MIME and a
  // drop target inside the composer card trigger anything; OS file drags and
  // unrelated drags pass through untouched (the composer's own image drop
  // zone reacts only to `Files` types).
  const disposeDragDrop = installDragDropListeners({
    mentionOf: (dt) => {
      if (!hasDragTypes(Array.from(dt.types))) return undefined;
      const payload = parseDragPayload(dt.getData(DRAG_MIME));
      if (!payload) return undefined;
      return buildDragMention(payload.path, payload.kind);
    },
    composerCard: (target) =>
      target instanceof Element ? target.closest("[data-composer-card]") : null,
  });
  ctx.effect?.(() => disposeDragDrop, "dsh-filemanager: drag-drop into composer");

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
