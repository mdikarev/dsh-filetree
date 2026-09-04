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

  // Close when the pointer is outside {source row ∪ menu} — but NOT on
  // page/chat scrolls (a chat update must not dismiss the menu). Pointer-move
  // tracking on the document is robust even when the source row re-renders
  // (row mouseleave can be missed crossing the panel boundary into the chat).
  // A short grace lets the pointer travel from the row onto the menu itself.
  useEffect(() => {
    if (!anchorRow) return;
    let grace: number | null = null;

    const insideAnchorOrMenu = (node: Node | null | undefined): boolean => {
      if (!node) return false;
      if (ref.current && ref.current.contains(node)) return true;
      return anchorRow.contains(node);
    };

    const cancelGrace = (): void => {
      if (grace !== null) { window.clearTimeout(grace); grace = null; }
    };

    const scheduleClose = (): void => {
      if (grace !== null) return;
      grace = window.setTimeout(() => {
        grace = null;
        // Re-check where the pointer is NOW (it may have reached the menu).
        const el = document.elementFromPoint(lastX, lastY);
        if (el && insideAnchorOrMenu(el)) return;
        onClose();
      }, 120);
    };

    // Keep the last known pointer position for the timer re-check.
    let lastX = -1;
    let lastY = -1;

    const onPointerMove = (event: PointerEvent): void => {
      lastX = event.clientX;
      lastY = event.clientY;
      if (insideAnchorOrMenu(event.target as Node)) {
        cancelGrace(); // over the row or the menu again
      } else {
        scheduleClose();
      }
    };

    window.addEventListener("pointermove", onPointerMove, true);
    return () => {
      cancelGrace();
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
