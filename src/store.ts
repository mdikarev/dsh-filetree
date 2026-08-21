// src/store.ts

const LS_KEY = "dsh-filemanager-open";

export interface FileManagerState {
  open: boolean;
}

export interface FileManagerStore {
  getState(): FileManagerState;
  setState(partial: Partial<FileManagerState>): void;
  subscribe(listener: () => void): () => void;
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

export function createStore(): FileManagerStore {
  let state: FileManagerState = { open: loadFromStorage() };
  const listeners = new Set<() => void>();

  return {
    getState: () => state,
    setState: (partial) => {
      state = { ...state, ...partial };
      if (partial.open !== undefined) {
        saveToStorage(state.open);
      }
      listeners.forEach((l) => l());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
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
