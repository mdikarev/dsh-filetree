// src/ToggleTab.tsx
import { useRef, useEffect, useState, useCallback } from "react";
import { useL10n } from "./use-l10n.js";

interface ToggleTabProps {
  open: boolean;
  onToggle: () => void;
  onSidebarLeft: (left: number) => void;
}

export function ToggleTab({ open, onToggle, onSidebarLeft }: ToggleTabProps) {
  const { t } = useL10n();
  const [left, setLeft] = useState(0);
  const tabRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Find sidebar column by structure: the shell renders our overlay layer
    // ([data-shell-overlay]) as a direct child of the grid frame, whose first
    // column child is the sidebar.
    const findSidebarColumn = (): HTMLElement | null => {
      const el = tabRef.current;
      if (!el) return null;

      // Preferred: the overlay layer's parent is the shell grid frame.
      const overlay = el.closest("[data-shell-overlay]");
      let frame: HTMLElement | null = overlay?.parentElement ?? null;

      // Fallback: walk up to the closest CSS grid container ancestor.
      if (!frame) {
        let node = el.parentElement;
        while (node) {
          if (getComputedStyle(node).display === "grid") {
            frame = node;
            break;
          }
          node = node.parentElement;
        }
      }
      if (!frame) return null;

      // First column child of the grid frame is the sidebar.
      const firstChild = frame.firstElementChild as HTMLElement | null;
      if (firstChild && !firstChild.contains(el)) {
        return firstChild;
      }
      return null;
    };

    const sidebar = findSidebarColumn();
    if (!sidebar) {
      // Fallback: left edge
      setLeft(0);
      onSidebarLeft(0);
      return;
    }

    const updatePosition = () => {
      const rect = sidebar.getBoundingClientRect();
      const newLeft = rect.right;
      setLeft(newLeft);
      onSidebarLeft(newLeft);
    };

    updatePosition();

    const observer = new ResizeObserver(updatePosition);
    observer.observe(sidebar);

    return () => observer.disconnect();
  }, [onSidebarLeft]);

  // When panel is open, tab moves to panel's right edge
  const tabLeft = open ? left + 300 : left;
  const verticalOffset = Math.round(window.innerHeight / 3);

  return (
    <div
      ref={tabRef}
      className="fm-toggle"
      style={{ left: tabLeft, top: verticalOffset }}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      title={open ? t("closePanel") : t("openFiles")}
    >
      {open ? "◀" : "▶"}
    </div>
  );
}
