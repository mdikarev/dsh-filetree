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
  /** The tree row the menu was opened from; leaving it with the pointer
   *  (unless the pointer is on the menu) closes the menu. */
  anchorRow?: HTMLElement | null;
}

const MENU_MARGIN = 6;

export function ContextMenu({ x, y, items, onClose, anchorRow }: ContextMenuProps) {
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
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  // Close when the pointer leaves the source row — but NOT on page/chat
  // scrolls (a chat update must not dismiss the menu). A short grace covers
  // the gap while the pointer travels from the row onto the menu itself.
  useEffect(() => {
    if (!anchorRow) return;
    const menu = ref.current;
    let grace: number | null = null;
    let ptr = { x: -1, y: -1 };

    const insideAnchorOrMenu = (node: Node | null | undefined): boolean => {
      if (!node) return false;
      if (ref.current && ref.current.contains(node)) return true;
      return anchorRow.contains(node);
    };

    const cancelGrace = (): void => {
      if (grace !== null) { window.clearTimeout(grace); grace = null; }
    };

    const onPointerMove = (event: PointerEvent): void => {
      ptr = { x: event.clientX, y: event.clientY };
      if (grace !== null && insideAnchorOrMenu(event.target as Node)) cancelGrace();
    };

    const onMouseLeave = (event: MouseEvent): void => {
      // Moving straight onto the menu (or back onto the row) keeps it open.
      if (insideAnchorOrMenu(event.relatedTarget as Node)) return;
      cancelGrace();
      grace = window.setTimeout(() => {
        grace = null;
        const el = document.elementFromPoint(ptr.x, ptr.y);
        if (el && insideAnchorOrMenu(el)) return; // pointer is on the menu now
        onClose();
      }, 150);
    };

    anchorRow.addEventListener("mouseleave", onMouseLeave);
    window.addEventListener("pointermove", onPointerMove, true);
    return () => {
      cancelGrace();
      anchorRow.removeEventListener("mouseleave", onMouseLeave);
      window.removeEventListener("pointermove", onPointerMove, true);
    };
  }, [anchorRow, onClose]);

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
