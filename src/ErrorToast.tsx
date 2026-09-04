// src/ErrorToast.tsx
// Toast surface for background live-refresh failures. Reads the shared
// noticeStore (src/notices.ts) and renders each active notice as a themed
// toast with an optional Retry action and a dismiss button. The component
// owns auto-dismiss timers (notice.autoDismissMs); the store itself stays a
// pure, DOM-free module so all list/ordering logic is unit-testable.
import { useEffect, useSyncExternalStore } from "react";
import { noticeStore, type Notice } from "./notices.js";
import { useL10n } from "./use-l10n.js";

function Toast({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  const { t } = useL10n();
  return (
    <div className={`fm-toast fm-toast--${notice.kind}`} role="alert">
      <span className="fm-toast-message">{notice.message}</span>
      <span className="fm-toast-actions">
        {notice.retry && (
          <button
            type="button"
            className="fm-toast-btn fm-toast-btn--retry"
            onClick={() => {
              notice.retry?.();
              onDismiss();
            }}
          >
            {t("retry")}
          </button>
        )}
        <button
          type="button"
          className="fm-toast-btn fm-toast-btn--close"
          onClick={onDismiss}
          aria-label={t("close")}
        >
          ✕
        </button>
      </span>
    </div>
  );
}

export function ErrorToast() {
  const notices = useSyncExternalStore(
    noticeStore.subscribe,
    noticeStore.getNotices,
    noticeStore.getNotices
  );

  // Auto-dismiss timers: a notice with autoDismissMs disappears on its own;
  // replacing the list (push/dismiss) restarts the timers for what remains.
  useEffect(() => {
    const timers = notices
      .filter((n) => n.autoDismissMs !== undefined)
      .map((n) =>
        window.setTimeout(() => noticeStore.dismiss(n.key), n.autoDismissMs)
      );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [notices]);

  if (notices.length === 0) return null;

  return (
    <div className="fm-toasts" aria-live="polite">
      {notices.map((notice) => (
        <Toast
          key={notice.key}
          notice={notice}
          onDismiss={() => noticeStore.dismiss(notice.key)}
        />
      ))}
    </div>
  );
}
