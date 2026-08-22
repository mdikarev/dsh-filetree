// src/preview-position.ts

export interface Point {
  x: number;
  y: number;
}

/**
 * Clamp a desired top-left position so the panel stays fully inside the
 * viewport. If the panel is larger than the viewport on an axis, that axis
 * clamps to 0.
 */
export function clampPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number
): Point {
  const maxX = Math.max(0, viewportWidth - width);
  const maxY = Math.max(0, viewportHeight - height);
  return {
    x: Math.min(Math.max(x, 0), maxX),
    y: Math.min(Math.max(y, 0), maxY),
  };
}