import { display, el, num, P, randInt, str, type WidgetFactory } from './common.js';

const DEFAULT_ALPHABET = 'абвгдежзиклмнопрстуфхцчшщыэюя';
const VISIBLE = 5;
const CELL = 34;

/**
 * §2.7 «барабан с инерцией»: драг или колесо раскручивают барабан,
 * он затухает по трению и лишь потом притягивается к ближайшей ячейке.
 * Перелёт — норма.
 */
export const createSafeDrum: WidgetFactory = (ctx) => {
  let root: HTMLElement | null = null;
  let strip: HTMLElement;
  let out: HTMLElement;
  let cells: HTMLElement[] = [];
  let letters: string[] = [];
  let typed = '';
  let multi = false;
  let friction = 0.94;
  let notify: (() => void) | undefined;

  /** Позиция в ячейках, дробная. */
  let position = 0;
  let velocity = 0;
  let dragging = false;
  let lastY = 0;
  let raf = 0;

  const wrap = (index: number): number => ((index % letters.length) + letters.length) % letters.length;

  const currentLetter = (): string => letters[wrap(Math.round(position))]!;

  const paint = (): void => {
    const base = Math.round(position);
    const shift = (position - base) * CELL;
    cells.forEach((cell, i) => {
      const offset = i - Math.floor(VISIBLE / 2);
      cell.textContent = letters[wrap(base + offset)]!;
      cell.classList.toggle(`${P}drum__cell--active`, offset === 0);
    });
    strip.style.transform = `translateY(${-shift}px)`;
    out.textContent = multi ? `${typed.padEnd(1, '·')} · ${currentLetter()}` : currentLetter();
  };

  const tick = (): void => {
    raf = requestAnimationFrame(tick);
    if (dragging) return;
    if (Math.abs(velocity) > 0.002) {
      position += velocity;
      velocity *= friction;
      paint();
      return;
    }
    // затухло — доводим до центра ближайшей ячейки
    const target = Math.round(position);
    const gap = target - position;
    if (Math.abs(gap) > 0.001) {
      position += gap * 0.2;
      paint();
    } else if (position !== target) {
      position = target;
      paint();
    }
  };

  const onDown = (event: PointerEvent): void => {
    dragging = true;
    lastY = event.clientY;
    velocity = 0;
    event.preventDefault();
  };

  const onMove = (event: PointerEvent): void => {
    if (!dragging) return;
    const delta = (event.clientY - lastY) / CELL;
    lastY = event.clientY;
    position -= delta;
    velocity = -delta;
    paint();
  };

  const onUp = (): void => {
    if (!dragging) return;
    dragging = false;
    ctx.playSound('dialClick');
    notify?.();
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    velocity += event.deltaY > 0 ? 0.35 : -0.35;
    notify?.();
  };

  return {
    mount(container, params, onChange): void {
      notify = onChange;
      letters = [...new Set([...str(params, 'alphabet', DEFAULT_ALPHABET)])];
      if (letters.length === 0) letters = [...DEFAULT_ALPHABET];
      const target = str(params, 'targetWord', ctx.answer);
      multi = target.length > 1;
      friction = Math.min(0.995, Math.max(0.5, num(params, 'friction', 0.94)));

      root = el('div', `${P}drum`);
      out = display('');
      const body = el('div', `${P}drum__body`);
      body.style.height = `${VISIBLE * CELL}px`;
      strip = el('div', `${P}drum__strip`);
      cells = Array.from({ length: VISIBLE }, () => {
        const cell = el('div', `${P}drum__cell ${P}mono`);
        cell.style.height = `${CELL}px`;
        strip.append(cell);
        return cell;
      });
      body.append(strip);
      body.addEventListener('pointerdown', onDown);
      body.addEventListener('wheel', onWheel, { passive: false });

      const controls = el('div', `${P}row`);
      if (multi) {
        const fix = el('button', `${P}btn`, 'ЗАФИКСИРОВАТЬ');
        fix.type = 'button';
        fix.addEventListener('click', () => {
          typed += currentLetter();
          ctx.playSound('dialClick');
          paint();
          notify?.();
        });
        const clear = el('button', `${P}btn`, 'СБРОС');
        clear.type = 'button';
        clear.addEventListener('click', () => {
          typed = '';
          paint();
          notify?.();
        });
        controls.append(fix, clear);
      }

      root.append(out, body, controls);
      container.append(root);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      this.reset();
    },

    getValue(): string {
      return multi ? typed : currentLetter();
    },

    reset(): void {
      typed = '';
      position = randInt(0, letters.length - 1);
      velocity = 0;
      dragging = false;
      paint();
      if (!raf) raf = requestAnimationFrame(tick);
    },

    freeze(): void {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      velocity = 0;
      dragging = false;
    },

    destroy(): void {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      root?.remove();
      root = null;
    },
  };
};
