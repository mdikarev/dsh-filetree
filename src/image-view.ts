// src/image-view.ts

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 8;
export const ZOOM_STEP = 1.25;

export type ZoomMode = "fit" | "custom";
export interface ZoomState {
  mode: ZoomMode;
  scale: number;
}

export const initialZoom: ZoomState = { mode: "fit", scale: 1 };

function clampScale(scale: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale));
}

export function zoomIn(state: ZoomState): ZoomState {
  if (state.mode === "fit") return { mode: "custom", scale: ZOOM_STEP };
  return { mode: "custom", scale: clampScale(state.scale * ZOOM_STEP) };
}

export function zoomOut(state: ZoomState): ZoomState {
  if (state.mode === "fit") return state;
  return { mode: "custom", scale: clampScale(state.scale / ZOOM_STEP) };
}

export function setFitZoom(): ZoomState {
  return initialZoom;
}

export function toggleZoom(state: ZoomState): ZoomState {
  return state.mode === "fit" ? { mode: "custom", scale: 1 } : initialZoom;
}
