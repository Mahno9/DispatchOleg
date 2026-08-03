import { buildWordReels, composeWords } from '../engine.js';
import { display, el, int, P, randInt, type WidgetFactory } from './common.js';

/**
 * §2.5 «число прописью»: барабаны разрядов. Числа-подростки («двенадцать»)
 * лежат цельными пунктами на барабане десятков — искать их надо там.
 */
export const createNumberAsWords: WidgetFactory = (ctx) => {
  let root: HTMLElement | null = null;
  let out: HTMLElement;
  let reels: string[][] = [];
  let index: number[] = [];
  let windows: HTMLElement[] = [];
  let notify: (() => void) | undefined;

  const show = (): void => {
    reels.forEach((reel, i) => {
      windows[i]!.textContent = reel[index[i]!]!;
    });
    out.textContent = composeWords(reels.map((reel, i) => reel[index[i]!]!)) || '—';
  };

  const step = (reelIndex: number, delta: number): void => {
    const size = reels[reelIndex]!.length;
    index[reelIndex] = (index[reelIndex]! + delta + size) % size;
    ctx.playSound('dialClick');
    show();
    notify?.();
  };

  return {
    mount(container, params, onChange): void {
      notify = onChange;
      reels = buildWordReels(int(params, 'slots', 3), int(params, 'maxNumber', 999));
      index = reels.map(() => 0);

      root = el('div', `${P}words`);
      out = display('—');
      const rack = el('div', `${P}words__rack`);
      windows = reels.map((_, i) => {
        const column = el('div', `${P}words__reel`);
        const up = el('button', `${P}btn ${P}btn--tiny`, '▲');
        up.type = 'button';
        up.addEventListener('click', () => step(i, -1));
        const down = el('button', `${P}btn ${P}btn--tiny`, '▼');
        down.type = 'button';
        down.addEventListener('click', () => step(i, 1));
        const face = el('div', `${P}words__face ${P}mono`);
        column.addEventListener(
          'wheel',
          (event) => {
            event.preventDefault();
            step(i, event.deltaY > 0 ? 1 : -1);
          },
          { passive: false },
        );
        column.append(up, face, down);
        rack.append(column);
        return face;
      });

      root.append(out, rack);
      container.append(root);
      this.reset();
    },

    getValue(): string {
      return composeWords(reels.map((reel, i) => reel[index[i]!]!));
    },

    reset(): void {
      index = reels.map((reel) => randInt(0, reel.length - 1));
      show();
    },

    destroy(): void {
      root?.remove();
      root = null;
    },
  };
};
