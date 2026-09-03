// src/tree-nav.ts

export type TreeNavKey = "ArrowUp" | "ArrowDown" | "Home" | "End";

export function treeNavStep(
  current: number,
  visibleCount: number,
  key: TreeNavKey
): number | null {
  if (visibleCount <= 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return visibleCount - 1;
  if (key === "ArrowUp") return current > 0 ? current - 1 : 0;
  if (key === "ArrowDown") return current < visibleCount - 1 ? current + 1 : visibleCount - 1;
  return null;
}
