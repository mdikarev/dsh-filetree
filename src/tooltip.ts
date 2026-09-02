// src/tooltip.ts
// Полное имя строки дерева, обрезанной по ширине: один тематический тултип,
// рендерится прямо в <body> и управляется императивно.
//
// Почему не React-портал/ребёнок строки: .fm-panel имеет transform (делает его
// containing block для position:fixed), а .fm-panel-clip обрезает overflow:hidden
// на границе 300px — «всплывашка» внутри дерева была бы обрезана панелью.

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface Placement {
  x: number;
  y: number;
  flippedX: boolean;
  flippedY: boolean;
}

/** Отступ тултипа от курсора, px. */
export const TOOLTIP_GAP = 12;

/**
 * Чистая функция: куда поставить тултип размером size, чтобы он не вылез за
 * viewport. По умолчанию — правее и ниже курсора; при нехватке места —
 * flip на другую сторону, затем кламп внутрь экрана.
 */
export function computeTooltipPlacement(
  anchor: Point,
  size: Size,
  viewport: Viewport,
  gap: number = TOOLTIP_GAP
): Placement {
  let x = anchor.x + gap;
  let y = anchor.y + gap;
  let flippedX = false;
  let flippedY = false;

  if (x + size.width > viewport.width) {
    x = anchor.x - gap - size.width;
    flippedX = true;
  }
  if (y + size.height > viewport.height) {
    y = anchor.y - gap - size.height;
    flippedY = true;
  }

  x = Math.max(0, Math.min(x, Math.max(0, viewport.width - size.width)));
  y = Math.max(0, Math.min(y, Math.max(0, viewport.height - size.height)));
  return { x, y, flippedX, flippedY };
}

export type TooltipToken = object;

let tooltipEl: HTMLDivElement | null = null;
let tooltipOwner: TooltipToken | null = null;

function ensureElement(): HTMLDivElement {
  if (tooltipEl === null) {
    tooltipEl = document.createElement("div");
    tooltipEl.className = "fm-name-tooltip";
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}

/** Разметить элемент у курсора с учётом реального размера и flip. */
function placeTooltip(el: HTMLDivElement, cursor: Point): void {
  el.style.visibility = "hidden";
  el.style.left = "0px";
  el.style.top = "0px";
  // Принудительный reflow: offsetWidth/Height должны отразить итоговый текст.
  void el.offsetWidth;
  const placement = computeTooltipPlacement(
    cursor,
    { width: el.offsetWidth, height: el.offsetHeight },
    { width: window.innerWidth, height: window.innerHeight }
  );
  el.style.left = `${placement.x}px`;
  el.style.top = `${placement.y}px`;
  el.style.visibility = "visible";
}

/**
 * Показать полное имя у курсора. Владелец (token) нужен, чтобы hide/cleanup
 * не снимали чужой тултип. Повторный вызов с тем же токеном обновляет текст.
 */
export function showNameTooltip(token: TooltipToken, text: string, cursor: Point): void {
  const el = ensureElement();
  tooltipOwner = token;
  el.textContent = text;
  placeTooltip(el, cursor);
}

/** Переставить активный тултип владельца token к новому курсору. */
export function repositionNameTooltip(token: TooltipToken, cursor: Point): void {
  if (tooltipOwner !== token || tooltipEl === null) return;
  placeTooltip(tooltipEl, cursor);
}

/** Скрыть тултип, если он принадлежит token (например, при размонтировании строки). */
export function hideNameTooltip(token: TooltipToken): void {
  if (tooltipOwner !== token || tooltipEl === null) return;
  tooltipEl.remove();
  tooltipEl = null;
  tooltipOwner = null;
}
