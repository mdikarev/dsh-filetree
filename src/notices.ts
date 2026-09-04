// src/notices.ts
// Minimal in-memory notice (toast) store for background failures of the
// live-refresh machinery (expanded-directory listing errors, root refresh
// errors). Pure module: no DOM access (Node-test safe); the rendering
// component (ErrorToast.tsx) owns auto-dismiss timers and a11y.

export type NoticeKind = "error" | "warning";

export interface Notice {
  /** Dedupe key: pushing a notice with an existing key replaces it in place. */
  key: string;
  kind: NoticeKind;
  /** Display text (already localized by the caller, or a raw fs message). */
  message: string;
  /** Optional action run by the toast's Retry button. */
  retry?: () => void;
  /** Auto-dismiss after this many ms; absent = persists until dismissed. */
  autoDismissMs?: number;
}

export interface NoticeStore {
  getNotices(): Notice[];
  subscribe(listener: () => void): () => void;
  push(notice: Notice): void;
  dismiss(key: string): void;
}

export function createNoticeStore(): NoticeStore {

  let notices: Notice[] = [];
  const listeners = new Set<() => void>();

  const emit = (): void => {
    for (const listener of [...listeners]) listener();
  };

  return {
    getNotices: () => notices,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    push: (notice) => {
      const existing = notices.findIndex((n) => n.key === notice.key);
      let next: Notice[];
      if (existing === -1) {
        next = [notice, ...notices];
      } else {
        next = notices.map((n, i) => (i === existing ? notice : n));
      }
      if (next !== notices) {
        notices = next;
        emit();
      }
    },
    dismiss: (key) => {
      const next = notices.filter((n) => n.key !== key);
      if (next.length !== notices.length) {
        notices = next;
        emit();
      }
    },
  };
}

// Shared client-wide instance (one per client lifecycle, mirrors caps.ts).
export const noticeStore: NoticeStore = createNoticeStore();
