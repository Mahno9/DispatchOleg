import { display, el, int, P, randInt, type WidgetFactory } from './common.js';

/**
 * §2.1 «точное число»: ползунок 0…10000 с шагом 1 и дрейфом ±driftAmount
 * при бездействии дольше driftIntervalMs. §6.2: диапазон молча расширяется,
 * чтобы `answer` был достижим.
 */
export const createMegaSlider: WidgetFactory = (ctx) => {
  let root: HTMLElement | null = null;
  let input: HTMLInputElement;
  let value: HTMLElement;
  let min = 0;
  let max = 10000;
  let driftAmount = 1;
  let driftIntervalMs = 800;
  let timer = 0;
  let lastTouch = 0;
  let notify: (() => void) | undefined;

  const current = (): number => Number(input.value);

  const show = (): void => {
    value.textContent = String(current()).padStart(String(max).length, '0');
  };

  const touch = (): void => {
    lastTouch = Date.now();
  };

  const drift = (): void => {
    if (Date.now() - lastTouch < driftIntervalMs) return;
    const direction = Math.random() < 0.5 ? -1 : 1;
    let next = current() + direction * driftAmount;
    // у границы отражается внутрь
    if (next < min) next = min + (min - next);
    if (next > max) next = max - (next - max);
    input.value = String(Math.max(min, Math.min(max, Math.round(next))));
    show();
  };

  const startDrift = (): void => {
    stopDrift();
    if (driftAmount === 0) return;
    timer = setInterval(drift, driftIntervalMs) as unknown as number;
  };

  const stopDrift = (): void => {
    if (timer) clearInterval(timer);
    timer = 0;
  };

  return {
    mount(container, params, onChange): void {
      notify = onChange;
      min = int(params, 'min', 0);
      max = int(params, 'max', 10000);
      if (max < min) [min, max] = [max, min];
      driftAmount = Math.abs(int(params, 'driftAmount', 1));
      driftIntervalMs = Math.max(100, int(params, 'driftIntervalMs', 800));

      const target = Number(ctx.answer);
      if (ctx.answer.trim() !== '' && Number.isFinite(target)) {
        if (target < min || target > max) {
          console.warn(`[safe-crack] mega-slider: ответ ${target} вне [${min}, ${max}], диапазон расширен`);
        }
        min = Math.min(min, target);
        max = Math.max(max, target);
      }

      root = el('div', `${P}slider`);
      value = display('0');
      value.classList.add(`${P}slider__value`);
      input = el('input') as HTMLInputElement;
      input.type = 'range';
      input.className = `${P}slider__input`;
      input.min = String(min);
      input.max = String(max);
      input.step = '1';
      input.addEventListener('input', () => {
        touch();
        show();
        notify?.();
      });
      input.addEventListener('pointerdown', touch);

      const scale = el('div', `${P}slider__scale ${P}mono`);
      scale.append(el('span', undefined, String(min)), el('span', undefined, String(max)));

      root.append(value, input, scale);
      container.append(root);
      this.reset();
    },

    getValue(): string {
      return String(current());
    },

    reset(): void {
      input.value = String(randInt(min, max));
      touch();
      show();
      startDrift();
    },

    freeze(): void {
      stopDrift();
    },

    destroy(): void {
      stopDrift();
      root?.remove();
      root = null;
    },
  };
};
