// src/store.ts

const LS_KEY = "dsh-filemanager-open";
const LS_EXPANDED_PREFIX = "dsh-filemanager-expanded:";
const LS_PREVIEW_PREFIX = "dsh-filemanager-preview:";
const LS_PREVIEW_MODE_PREFIX = "dsh-filemanager-preview-mode:";

export type PreviewMode = "source" | "rendered";

export interface PreviewLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FileManagerState {
  open: boolean;
  expandedPaths: Set<string>;
  currentWorkspace: string | null;
  previewLayout: PreviewLayout | null;
  previewMode: PreviewMode;
}

export interface FileManagerStore {
  getState(): FileManagerState;
  setState(partial: Partial<FileManagerState>): void;
  subscribe(listener: () => void): () => void;
  togglePath(path: string): void;
  isExpanded(path: string): boolean;
  /** Snapshot of the currently expanded relative directories. */
  getExpandedPaths(): string[];
  /** Subscribe to expanded-path set changes only; returns an unsubscribe. */
  subscribeExpandedPaths(listener: () => void): () => void;
  /**
   * Remove stale expanded paths (e.g. directories deleted or renamed away on
   * disk). Persists through the existing per-workspace storage and notifies
   * expanded-path subscribers only when something was actually removed.
   */
  pruneExpandedPaths(paths: string[]): void;
  setWorkspace(workspaceHint: string): void;
  setPreviewLayout(layout: PreviewLayout | null): void;
  setPreviewMode(mode: PreviewMode): void;
}

function loadFromStorage(): boolean {
  try {
    return localStorage.getItem(LS_KEY) === "1";
  } catch {
    return false;
  }
}

function saveToStorage(open: boolean): void {
  try {
    localStorage.setItem(LS_KEY, open ? "1" : "0");
  } catch {}
}

function getWorkspaceKey(workspaceHint: string): string {
  // Используем hint (путь воркспейса) как уникальный ключ
  return `${LS_EXPANDED_PREFIX}${workspaceHint}`;
}

function loadExpandedPaths(workspaceHint: string | null): Set<string> {
  if (!workspaceHint) return new Set();
  
  try {
    const key = getWorkspaceKey(workspaceHint);
    const stored = localStorage.getItem(key);
    if (stored) {
      return new Set(JSON.parse(stored));
    }
  } catch {}
  return new Set();
}

function saveExpandedPaths(workspaceHint: string | null, paths: Set<string>): void {
  if (!workspaceHint) return;
  
  try {
    const key = getWorkspaceKey(workspaceHint);
    localStorage.setItem(key, JSON.stringify([...paths]));
  } catch {}
}

function getPreviewKey(workspaceHint: string): string {
  return `${LS_PREVIEW_PREFIX}${workspaceHint}`;
}

function getPreviewModeKey(workspaceHint: string): string {
  return `${LS_PREVIEW_MODE_PREFIX}${encodeURIComponent(workspaceHint)}`;
}

function loadPreviewMode(workspaceHint: string | null): PreviewMode {
  if (!workspaceHint) return "source";
  try {
    return localStorage.getItem(getPreviewModeKey(workspaceHint)) === "rendered"
      ? "rendered"
      : "source";
  } catch {
    return "source";
  }
}

function savePreviewMode(workspaceHint: string | null, mode: PreviewMode): void {
  if (!workspaceHint) return;
  try {
    localStorage.setItem(getPreviewModeKey(workspaceHint), mode);
  } catch {}
}

function loadPreviewLayout(workspaceHint: string | null): PreviewLayout | null {
  if (!workspaceHint) return null;
  try {
    const stored = localStorage.getItem(getPreviewKey(workspaceHint));
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if (
      parsed &&
      typeof parsed.x === "number" &&
      typeof parsed.y === "number" &&
      typeof parsed.width === "number" &&
      typeof parsed.height === "number"
    ) {
      return parsed as PreviewLayout;
    }
  } catch {}
  return null;
}

function savePreviewLayout(workspaceHint: string | null, layout: PreviewLayout | null): void {
  if (!workspaceHint) return;
  try {
    const key = getPreviewKey(workspaceHint);
    if (layout === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(layout));
    }
  } catch {}
}

export function createStore(): FileManagerStore {
  let state: FileManagerState = { 
    open: loadFromStorage(),
    expandedPaths: new Set(),
    currentWorkspace: null,
    previewLayout: null,
    previewMode: "source"
  };
  const listeners = new Set<() => void>();
  const expandedListeners = new Set<() => void>();

  const notifyExpanded = (): void => {
    expandedListeners.forEach((listener) => listener());
  };

  return {
    getState: () => state,
    setState: (partial) => {
      state = { ...state, ...partial };
      if (partial.open !== undefined) {
        saveToStorage(state.open);
      }
      if (partial.expandedPaths !== undefined && state.currentWorkspace) {
        saveExpandedPaths(state.currentWorkspace, state.expandedPaths);
      }
      if (partial.expandedPaths !== undefined) {
        notifyExpanded();
      }
      listeners.forEach((l) => l());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    togglePath: (path: string) => {
      const newExpandedPaths = new Set(state.expandedPaths);
      if (newExpandedPaths.has(path)) {
        newExpandedPaths.delete(path);
      } else {
        newExpandedPaths.add(path);
      }
      state = { ...state, expandedPaths: newExpandedPaths };
      if (state.currentWorkspace) {
        saveExpandedPaths(state.currentWorkspace, newExpandedPaths);
      }
      notifyExpanded();
      listeners.forEach((l) => l());
    },
    isExpanded: (path: string) => {
      return state.expandedPaths.has(path);
    },
    getExpandedPaths: () => {
      return [...state.expandedPaths];
    },
    subscribeExpandedPaths: (listener) => {
      expandedListeners.add(listener);
      return () => expandedListeners.delete(listener);
    },
    pruneExpandedPaths: (paths) => {
      if (paths.length === 0) return;
      const remove = new Set(paths);
      const next = new Set<string>();
      let changed = false;
      for (const path of state.expandedPaths) {
        if (remove.has(path)) {
          changed = true;
        } else {
          next.add(path);
        }
      }
      if (!changed) return;
      state = { ...state, expandedPaths: next };
      if (state.currentWorkspace) {
        saveExpandedPaths(state.currentWorkspace, next);
      }
      notifyExpanded();
      listeners.forEach((l) => l());
    },
    setWorkspace: (workspaceHint: string) => {
      if (state.currentWorkspace === workspaceHint) {
        return; // Уже установлен этот воркспейс
      }
      
      // Загружаем состояние для нового воркспейса
      const expandedPaths = loadExpandedPaths(workspaceHint);
      const previewLayout = loadPreviewLayout(workspaceHint);
      const previewMode = loadPreviewMode(workspaceHint);
      state = {
        ...state,
        currentWorkspace: workspaceHint,
        expandedPaths,
        previewLayout,
        previewMode
      };
      listeners.forEach((l) => l());
    },
    setPreviewMode: (mode: PreviewMode) => {
      state = { ...state, previewMode: mode };
      savePreviewMode(state.currentWorkspace, mode);
      listeners.forEach((l) => l());
    },
    setPreviewLayout: (layout: PreviewLayout | null) => {
      state = { ...state, previewLayout: layout };
      savePreviewLayout(state.currentWorkspace, layout);
      listeners.forEach((l) => l());
    },
  };
}

// Actions
export function toggle(store: FileManagerStore): void {
  store.setState({ open: !store.getState().open });
}

export function close(store: FileManagerStore): void {
  store.setState({ open: false });
}