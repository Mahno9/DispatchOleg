import { el, int, num, P, type WidgetFactory } from './common.js';

/** Отпускание раньше этого — случайный клик, попыткой не считается (§2.8). */
const ACCIDENTAL_MS = 300;
/** Полный ход стрелки манометра, градусы. */
const SWEEP = 240;

/**
 * §2.8 «удержание» — единственный selfSubmit-виджет. Держать ровно
 * `targetSeconds` ± `toleranceMs`; манометр отстаёт на `gaugeLagMs`
 * и существует ровно для того, чтобы мешать.
 */
export const createHoldButton: WidgetFactory = (ctx) => {
  let root: HTMLElement | null = null;
  let pad: HTMLElement;
  let needle: HTMLElement;
  let label: HTMLElement;
  let targetMs = 5000;
  let toleranceMs = 300;
  let lagMs = 400;
  let notify: (() => void) | undefined;

  let holdStart = 0;
  let shownMs = 0;
  let raf = 0;
  let result = 'miss';
  let hint = '';

  const paintNeedle = (): void => {
    const ratio = Math.max(0, Math.min(1, shownMs / (targetMs * 1.6 || 1)));
    needle.style.transform = `rotate(${-SWEEP / 2 + ratio * SWEEP}deg)`;
  };

  const tick = (): void => {
    raf = requestAnimationFrame(tick);
    const elapsed = holdStart ? performance.now() - holdStart : 0;
    // стрелка отстаёт на lagMs и доезжает со сглаживанием
    const target = Math.max(0, elapsed - lagMs);
    shownMs += (target - shownMs) * 0.12;
    paintNeedle();
  };

  const stopLoop = (): void => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  const onDown = (event: PointerEvent): void => {
    if (holdStart) return;
    event.preventDefault();
    holdStart = performance.now();
    shownMs = 0;
    pad.classList.add(`${P}hold__pad--down`);
    ctx.playSound('dialClick');
    stopLoop();
    raf = requestAnimationFrame(tick);
    notify?.();
  };

  const onUp = (): void => {
    if (!holdStart) return;
    const held = performance.now() - holdStart;
    holdStart = 0;
    pad.classList.remove(`${P}hold__pad--down`);
    stopLoop();
    shownMs = 0;
    paintNeedle();
    // случайный клик — молча сбрасываемся, попытка не тратится
    if (held < ACCIDENTAL_MS) return;
    result = Math.abs(held - targetMs) <= toleranceMs ? 'hit' : 'miss';
    label.textContent = `${(held / 1000).toFixed(1)} С`;
    ctx.selfSubmit?.(result);
  };

  return {
    mount(container, params, onChange): void {
      notify = onChange;
      targetMs = Math.max(0, num(params, 'targetSeconds', 5) * 1000);
      toleranceMs = Math.max(0, int(params, 'toleranceMs', 300));
      lagMs = Math.max(0, int(params, 'gaugeLagMs', 400));

      root = el('div', `${P}hold`);
      const gauge = el('div', `${P}gauge`);
      const dialFace = el('div', `${P}gauge__face`);
      needle = el('div', `${P}gauge__needle`);
      gauge.append(dialFace, needle, el('div', `${P}gauge__cap`));
      hint = `ЦЕЛЬ: ${(targetMs / 1000).toFixed(1)} С · ДОПУСК ±${toleranceMs} МС`;
      label = el('div', `${P}hint ${P}mono`, hint);

      pad = el('button', `${P}hold__pad`, 'ДЕРЖАТЬ');
      (pad as HTMLButtonElement).type = 'button';
      pad.addEventListener('pointerdown', onDown);
      pad.addEventListener('contextmenu', (event) => event.preventDefault());

      root.append(gauge, pad, label);
      container.append(root);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      this.reset();
    },

    getValue(): string {
      return result;
    },

    reset(): void {
      holdStart = 0;
      shownMs = 0;
      result = 'miss';
      stopLoop();
      pad.classList.remove(`${P}hold__pad--down`);
      label.textContent = hint;
      paintNeedle();
    },

    freeze(): void {
      holdStart = 0;
      stopLoop();
      pad.classList.remove(`${P}hold__pad--down`);
    },

    destroy(): void {
      stopLoop();
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      root?.remove();
      root = null;
    },
  };
};
