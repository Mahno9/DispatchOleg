import type { WidgetParams } from '../engine.js';

/** Класс-префикс всех узлов игры (стили scoped под `.sc-root`). */
export const P = 'sc-';

export interface LockWidget {
  mount(container: HTMLElement, params: WidgetParams, onChange?: () => void): void;
  getValue(): string;
  /** Перегенерировать случайное состояние (§3.2) без пересоздания DOM. */
  reset(): void;
  destroy(): void;
  /**
   * Необязательное расширение интерфейса из спеки: остановить внутренние
   * таймеры/RAF на входе в `checking` (§3.1). Реализуют только виджеты
   * с собственной физикой — mega-slider, safe-drum, hold-button.
   */
  freeze?(): void;
}

export interface WidgetContext {
  answer: string;
  selfSubmit?: (value: string) => void;
  playSound: (name: string) => void;
}

export type WidgetFactory = (ctx: WidgetContext) => LockWidget;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  textContent?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textContent !== undefined) node.textContent = textContent;
  return node;
}

export function num(params: WidgetParams, key: string, fallback: number): number {
  const n = Number(params[key]);
  return Number.isFinite(n) ? n : fallback;
}

export function int(params: WidgetParams, key: string, fallback: number): number {
  return Math.round(num(params, key, fallback));
}

export function str(params: WidgetParams, key: string, fallback = ''): string {
  const value = params[key];
  return typeof value === 'string' && value !== '' ? value : fallback;
}

export function bool(params: WidgetParams, key: string, fallback: boolean): boolean {
  const value = params[key];
  return typeof value === 'boolean' ? value : fallback;
}

export function randInt(min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** Табло набранного значения — общее для диска, клавиатуры и барабана. */
export function display(text: string): HTMLElement {
  return el('div', `${P}wdisplay ${P}mono`, text);
}
