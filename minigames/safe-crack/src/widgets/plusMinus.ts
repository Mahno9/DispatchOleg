import { display, el, int, P, randInt, type WidgetFactory } from './common.js';

/**
 * §2.6 «плюс-минус»: только `+1` и `−1`, без автоповтора.
 * Каждые `swapEveryNClicks` кликов кнопки меняются местами —
 * подписи при этом всегда честные.
 */
export const createPlusMinus: WidgetFactory = (ctx) => {
  let root: HTMLElement | null = null;
  let out: HTMLElement;
  let pad: HTMLElement;
  let plus: HTMLElement;
  let minus: HTMLElement;
  let value = 0;
  let clicks = 0;
  let startMin = 0;
  let startMax = 100;
  let swapEvery = 5;
  let notify: (() => void) | undefined;

  const show = (): void => {
    out.textContent = String(value);
  };

  let swapTimer = 0;

  const swap = (): void => {
    const [first, second] = pad.firstElementChild === plus ? [minus, plus] : [plus, minus];
    pad.append(first, second);
    pad.classList.add(`${P}pad--swap`);
    clearTimeout(swapTimer);
    swapTimer = setTimeout(() => pad.classList.remove(`${P}pad--swap`), 160) as unknown as number;
  };

  const bump = (delta: number): void => {
    value += delta;
    clicks++;
    ctx.playSound('dialClick');
    show();
    if (swapEvery > 0 && clicks % swapEvery === 0) swap();
    notify?.();
  };

  return {
    mount(container, params, onChange): void {
      notify = onChange;
      startMin = int(params, 'startMin', 0);
      startMax = int(params, 'startMax', 100);
      if (startMax < startMin) [startMin, startMax] = [startMax, startMin];
      swapEvery = Math.max(0, int(params, 'swapEveryNClicks', 5));

      root = el('div', `${P}plusminus`);
      out = display('0');
      out.classList.add(`${P}plusminus__value`);
      pad = el('div', `${P}pad`);
      minus = el('button', `${P}btn ${P}btn--square`, '−1');
      (minus as HTMLButtonElement).type = 'button';
      minus.addEventListener('click', () => bump(-1));
      plus = el('button', `${P}btn ${P}btn--square`, '+1');
      (plus as HTMLButtonElement).type = 'button';
      plus.addEventListener('click', () => bump(1));
      pad.append(minus, plus);
      root.append(out, pad);
      container.append(root);
      this.reset();
    },

    getValue(): string {
      return String(value);
    },

    reset(): void {
      value = randInt(startMin, startMax);
      clicks = 0;
      pad.append(minus, plus);
      show();
    },

    destroy(): void {
      clearTimeout(swapTimer);
      root?.remove();
      root = null;
    },
  };
};
