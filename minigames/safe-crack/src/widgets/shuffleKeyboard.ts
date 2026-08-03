import { shuffle } from '../engine.js';
import { bool, display, el, P, str, type WidgetFactory } from './common.js';

const BACKSPACE = '⌫';
const DEFAULT_ALPHABET = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя ';

/**
 * §2.4 «прыгающая клавиатура»: сетка букв в случайном порядке,
 * перемешивается после каждого нажатия (клавиша «⌫» — тоже участник).
 */
export const createShuffleKeyboard: WidgetFactory = (ctx) => {
  let root: HTMLElement | null = null;
  let grid: HTMLElement;
  let out: HTMLElement;
  let keys: string[] = [];
  let typed = '';
  let target = '';
  let reshuffle = true;
  let notify: (() => void) | undefined;

  const show = (): void => {
    out.textContent = target ? typed.padEnd(target.length, '·') : typed || '·';
  };

  const press = (key: string): void => {
    typed = key === BACKSPACE ? typed.slice(0, -1) : typed + key;
    ctx.playSound('dialClick');
    show();
    if (reshuffle) layout();
    notify?.();
  };

  function layout(): void {
    grid.textContent = '';
    for (const key of shuffle(keys)) {
      const button = el('button', `${P}key ${P}mono`, key === ' ' ? '␣' : key);
      button.type = 'button';
      if (key === BACKSPACE) button.classList.add(`${P}key--alt`);
      button.addEventListener('click', () => press(key));
      grid.append(button);
    }
  }

  return {
    mount(container, params, onChange): void {
      notify = onChange;
      target = str(params, 'targetWord', ctx.answer);
      reshuffle = bool(params, 'shuffleEveryKey', true);
      keys = [...new Set([...str(params, 'alphabet', DEFAULT_ALPHABET)]), BACKSPACE];

      root = el('div', `${P}keyboard`);
      out = display('');
      grid = el('div', `${P}keyboard__grid`);
      grid.style.gridTemplateColumns = `repeat(${Math.ceil(Math.sqrt(keys.length))}, 1fr)`;
      root.append(out, grid);
      container.append(root);
      this.reset();
    },

    getValue(): string {
      return typed;
    },

    reset(): void {
      typed = '';
      show();
      layout();
    },

    destroy(): void {
      root?.remove();
      root = null;
    },
  };
};
