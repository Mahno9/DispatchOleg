import { normalizePattern } from '../engine.js';
import { el, int, P, str, type WidgetFactory } from './common.js';

/**
 * §2.9 «стена чекбоксов»: отметить клетки, складывающиеся в `pattern`.
 * Клик мимо паттерна гасит случайную уже отмеченную клетку — не ту,
 * по которой кликнули (короткий оранжевый импульс на погашенной).
 */
export const createCheckboxWall: WidgetFactory = () => {
  let root: HTMLElement | null = null;
  let grid: HTMLElement;
  let cells: HTMLElement[] = [];
  let checked: boolean[] = [];
  let pattern = '';
  let notify: (() => void) | undefined;
  const pulses = new Set<number>();

  const paint = (): void => {
    cells.forEach((cell, i) => cell.classList.toggle(`${P}wall__cell--on`, checked[i] === true));
  };

  const pulse = (index: number): void => {
    const cell = cells[index];
    if (!cell) return;
    cell.classList.add(`${P}wall__cell--miss`);
    const timer = setTimeout(() => {
      pulses.delete(timer as unknown as number);
      cell.classList.remove(`${P}wall__cell--miss`);
    }, 220) as unknown as number;
    pulses.add(timer);
  };

  const click = (index: number): void => {
    if (pattern[index] === '1') {
      checked[index] = !checked[index];
    } else {
      const marked = checked.flatMap((on, i) => (on ? [i] : []));
      if (marked.length > 0) {
        const victim = marked[Math.floor(Math.random() * marked.length)]!;
        checked[victim] = false;
        pulse(victim);
      }
    }
    paint();
    notify?.();
  };

  return {
    mount(container, params, onChange): void {
      notify = onChange;
      const side = Math.max(1, int(params, 'gridSize', 6));
      const raw = str(params, 'pattern', '');
      pattern = normalizePattern(raw, side);
      if (raw.replace(/[^01]/g, '').length !== side * side) {
        console.warn(`[safe-crack] checkbox-wall: pattern приведён к ${side * side} символам`);
      }
      checked = new Array(side * side).fill(false);

      root = el('div', `${P}wall`);
      grid = el('div', `${P}wall__grid`);
      grid.style.gridTemplateColumns = `repeat(${side}, 1fr)`;
      cells = checked.map((_, i) => {
        const cell = el('button', `${P}wall__cell`);
        cell.type = 'button';
        cell.setAttribute('aria-label', `клетка ${i + 1}`);
        cell.addEventListener('click', () => click(i));
        grid.append(cell);
        return cell;
      });
      root.append(grid, el('div', `${P}hint ${P}mono`, 'НАРИСУЙТЕ ОТВЕТ'));
      container.append(root);
      paint();
    },

    getValue(): string {
      return checked.map((on) => (on ? '1' : '0')).join('');
    },

    reset(): void {
      checked = checked.map(() => false);
      paint();
    },

    destroy(): void {
      for (const timer of pulses) clearTimeout(timer);
      pulses.clear();
      root?.remove();
      root = null;
    },
  };
};
