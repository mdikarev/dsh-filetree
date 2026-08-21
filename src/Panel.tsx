// src/Panel.tsx
import { useState, useEffect, useCallback } from "react";
import { fetchRoot, fetchList, sortEntries, type Entry } from "./api.js";
import { Tree } from "./Tree.js";

interface PanelProps {
  open: boolean;
  sidebarLeft: number;
  hint: string;
  onClose: () => void;
}

type Status = "loading" | "ready" | "error" | "no-workspace";

export function Panel({ open, sidebarLeft, hint, onClose }: PanelProps) {
  const [status, setStatus] = useState<Status>("loading");
  const [rootName, setRootName] = useState("");
  const [rootPath, setRootPath] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState("");

  const loadRoot = useCallback(async () => {
    if (!hint) {
      setStatus("no-workspace");
      return;
    }

    setStatus("loading");
    setError("");

    try {
      const rootRes = await fetchRoot(hint);
      setRootPath(rootRes.root);
      setRootName(rootRes.name);

      const listRes = await fetchList(hint, "");
      setEntries(sortEntries(listRes.entries));
      setStatus("ready");
    } catch (err: any) {
      setError(err.message);
      setStatus("error");
    }
  }, [hint]);

  // Load on mount and when hint changes
  useEffect(() => {
    loadRoot();
  }, [loadRoot]);

  const handleRefresh = useCallback(() => {
    loadRoot();
  }, [loadRoot]);

  const handleError = useCallback((msg: string) => {
    // Show inline error for individual folder failures
    console.warn("[filemanager]", msg);
  }, []);

  return (
    <div
      className={`fm-panel${open ? " fm-panel--open" : ""}`}
      style={{ left: sidebarLeft }}
    >
      <div className="fm-header">
        <span className="fm-header-title" title={rootPath}>
          {rootName || "Файлы"}
        </span>
        <button
          className="fm-header-btn"
          onClick={handleRefresh}
          title="Обновить"
        >
          ↻
        </button>
        <button className="fm-header-btn" onClick={onClose} title="Закрыть">
          ✕
        </button>
      </div>

      {status === "loading" && (
        <div className="fm-loading">
          <span className="fm-spinner" /> Загрузка…
        </div>
      )}

      {status === "error" && (
        <div className="fm-error">
          <div>Ошибка: {error}</div>
          <button onClick={handleRefresh}>Повторить</button>
        </div>
      )}

      {status === "no-workspace" && (
        <div className="fm-empty">Нет воркспейса</div>
      )}

      {status === "ready" && (
        <Tree hint={hint} entries={entries} onError={handleError} />
      )}
    </div>
  );
}
