// src/ConfirmDeleteDialog.tsx
import { useEffect, useRef } from "react";
import { useL10n } from "./use-l10n.js";
import type { DeleteDialogModel } from "./delete-flow.js";

export interface ConfirmDeleteDialogProps {
  name: string;
  model: DeleteDialogModel;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDeleteDialog({ name, model, busy, error, onCancel, onConfirm }: ConfirmDeleteDialogProps) {
  const { t } = useL10n();
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); onCancel(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  return (
    <div className="fm-confirm-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <div className="fm-confirm-dialog" role="alertdialog" aria-label={t("deleteDialogTitle")}>
        <strong>{model.isDir ? t("deleteFolderBody").replace("{name}", name) : t("deleteFileBody").replace("{name}", name)}</strong>
        <div className="fm-confirm-path">{model.path}</div>
        {model.uncommitted && <div className="fm-confirm-warning">{t("deleteUncommittedWarning")}</div>}
        {model.blocked && !busy && <div className="fm-confirm-error">{t("deleteBlocked")}</div>}
        {error && <div className="fm-confirm-error">{t("deleteErrorPrefix")}{error}</div>}
        <div className="fm-confirm-actions">
          <button ref={cancelRef} type="button" className="fm-confirm-btn" onClick={onCancel} disabled={busy}>
            {t("cancel")}
          </button>
          <button
            type="button"
            className="fm-confirm-btn fm-confirm-btn--danger"
            onClick={onConfirm}
            disabled={busy || model.blocked}
          >
            {busy ? t("loading") : t("deleteAction")}
          </button>
        </div>
      </div>
    </div>
  );
}
