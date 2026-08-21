// src/ToggleTab.tsx
import { useRef, useEffect, useState, useCallback } from "react";

interface ToggleTabProps {
  open: boolean;
  onToggle: () => void;
  onSidebarLeft: (left: number) => void;
}

export function ToggleTab({ open, onToggle, onSidebarLeft }: ToggleTabProps) {
  const [left, setLeft] = useState(0);
  const tabRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Find sidebar column by structure:
    // Our overlay is in the grid frame; sidebar is first column
    const findSidebarColumn = (): HTMLElement | null => {
      const el = tabRef.current;
      if (!el) return null;

      // Walk up to find the grid frame (parent of overlay layer)
      let frame = el.parentElement;
      while (frame && !frame.querySelector("[data-slot-layer]")) {
        frame = frame.parentElement;
      }
      if (!frame) return null;

      // First child of frame is typically sidebar column
      const firstChild = frame.firstElementChild as HTMLElement | null;
      if (firstChild && firstChild !== el.parentElement) {
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
      onClick={onToggle}
      title={open ? "Закрыть панель" : "Открыть файлы"}
    >
      {open ? "◀" : "▶"}
    </div>
  );
}
