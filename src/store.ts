// src/store.ts

const LS_KEY = "dsh-filemanager-open";
const LS_EXPANDED_PREFIX = "dsh-filemanager-expanded:";
const LS_PREVIEW_PREFIX = "dsh-filemanager-preview:";

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
}

export interface FileManagerStore {
  getState(): FileManagerState;
  setState(partial: Partial<FileManagerState>): void;
  subscribe(listener: () => void): () => void;
  togglePath(path: string): void;
  isExpanded(path: string): boolean;
  setWorkspace(workspaceHint: string): void;
  setPreviewLayout(layout: PreviewLayout | null): void;
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
    previewLayout: null
  };
  const listeners = new Set<() => void>();

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
      listeners.forEach((l) => l());
    },
    isExpanded: (path: string) => {
      return state.expandedPaths.has(path);
    },
    setWorkspace: (workspaceHint: string) => {
      if (state.currentWorkspace === workspaceHint) {
        return; // Уже установлен этот воркспейс
      }
      
      // Загружаем состояние для нового воркспейса
      const expandedPaths = loadExpandedPaths(workspaceHint);
      const previewLayout = loadPreviewLayout(workspaceHint);
      state = {
        ...state,
        currentWorkspace: workspaceHint,
        expandedPaths,
        previewLayout
      };
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