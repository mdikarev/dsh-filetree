// src/ContextMenu.tsx
import { useEffect, useRef, type ReactNode } from "react";

export interface ContextMenuItem {
  id: string;
  label: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

const MENU_MARGIN = 6;

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Clamp to the viewport after mount so long menus / edge anchors stay visible.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const left = Math.max(MENU_MARGIN, Math.min(x, window.innerWidth - rect.width - MENU_MARGIN));
    const top = Math.max(MENU_MARGIN, Math.min(y, window.innerHeight - rect.height - MENU_MARGIN));
    el.style.left = left + "px";
    el.style.top = top + "px";
  }, [x, y]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); }
    };
    const onScroll = () => onClose();
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  const focusFirst = (el: HTMLDivElement | null) => { el?.focus(); };

  return (
    <div
      ref={(node) => { ref.current = node; focusFirst(node?.querySelector?.("[data-autofocus]") as HTMLDivElement | null ?? null); }}
      className="fm-context-menu"
      role="menu"
      style={{ left: x, top: y }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
          const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === "ArrowDown" ? (idx + 1) % buttons.length : (idx - 1 + buttons.length) % buttons.length;
          buttons[next]?.focus();
        }
      }}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          className={"fm-context-menu-item" + (item.danger ? " fm-context-menu-item--danger" : "")}
          disabled={item.disabled}
          data-autofocus={item.id === items[0]?.id ? "" : undefined}
          onClick={() => { onClose(); item.onSelect(); }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
