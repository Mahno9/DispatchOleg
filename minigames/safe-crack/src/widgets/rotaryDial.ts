import { display, el, int, P, type WidgetFactory } from './common.js';

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
/** Упор-ограничитель: угол по часовой стрелке от 12 часов. */
const STOP_ANGLE = 100;
/** Доля дуги, которую надо пройти, чтобы цифра засчиталась (недокрут — §2.3). */
const ENOUGH = 0.95;

/**
 * §2.3 «телефонный диск». Отверстие тянут по дуге до упора и отпускают.
 * Дуга у каждой цифры своя (как на настоящем аппарате): у «1» — короткая,
 * у «0» — полная `dialFullTurnDegrees`. Недокрут не засчитывается молча.
 */
export const createRotaryDial: WidgetFactory = (ctx) => {
  let root: HTMLElement | null = null;
  let disc: HTMLElement;
  let out: HTMLElement;
  let dialed = '';
  let digits = 3;
  let fullTurn = 300;
  let notify: (() => void) | undefined;

  let dragIndex = -1;
  let startAngle = 0;
  let rotation = 0;

  /** Дуга от отверстия `index` до упора. */
  const arcFor = (index: number): number => (fullTurn * (index + 1)) / DIGITS.length;

  const angleAt = (event: PointerEvent): number => {
    const box = disc.getBoundingClientRect();
    const dx = event.clientX - (box.left + box.width / 2);
    const dy = event.clientY - (box.top + box.height / 2);
    // 0° — 12 часов, растёт по часовой стрелке
    return (Math.atan2(dx, -dy) * 180) / Math.PI;
  };

  const show = (): void => {
    out.textContent = dialed.padEnd(digits, '·');
  };

  const spin = (deg: number, animated: boolean): void => {
    disc.style.transition = animated ? 'transform 320ms cubic-bezier(0.3, 0, 0.2, 1)' : 'none';
    disc.style.transform = `rotate(${deg}deg)`;
  };

  const onMove = (event: PointerEvent): void => {
    if (dragIndex < 0) return;
    let delta = angleAt(event) - startAngle;
    while (delta < 0) delta += 360;
    while (delta >= 360) delta -= 360;
    // рывок против часовой читаем как ноль, а не как почти полный оборот
    rotation = delta > 340 ? 0 : Math.min(delta, arcFor(dragIndex));
    spin(rotation, false);
  };

  const onUp = (): void => {
    if (dragIndex < 0) return;
    const index = dragIndex;
    dragIndex = -1;
    if (rotation >= arcFor(index) * ENOUGH && dialed.length < digits) {
      dialed += DIGITS[index]!;
      ctx.playSound('dialClick');
      show();
      notify?.();
    }
    rotation = 0;
    spin(0, true);
  };

  const onDown = (event: PointerEvent, index: number): void => {
    if (dialed.length >= digits || dragIndex >= 0) return;
    event.preventDefault();
    dragIndex = index;
    startAngle = angleAt(event);
    rotation = 0;
    spin(0, false);
  };

  return {
    mount(container, params, onChange): void {
      notify = onChange;
      digits = Math.max(1, int(params, 'digits', 3));
      fullTurn = Math.max(60, int(params, 'dialFullTurnDegrees', 300));

      root = el('div', `${P}dial`);
      out = display('');
      const body = el('div', `${P}dial__body`);
      disc = el('div', `${P}dial__disc`);
      DIGITS.forEach((digit, index) => {
        const angle = ((STOP_ANGLE - arcFor(index)) * Math.PI) / 180;
        const hole = el('button', `${P}dial__hole ${P}mono`, digit);
        hole.type = 'button';
        hole.style.left = `${50 + 36 * Math.sin(angle)}%`;
        hole.style.top = `${50 - 36 * Math.cos(angle)}%`;
        hole.addEventListener('pointerdown', (event) => onDown(event, index));
        disc.append(hole);
      });
      const stop = el('div', `${P}dial__stop`);
      stop.style.left = `${50 + 46 * Math.sin((STOP_ANGLE * Math.PI) / 180)}%`;
      stop.style.top = `${50 - 46 * Math.cos((STOP_ANGLE * Math.PI) / 180)}%`;
      body.append(disc, stop);

      const clear = el('button', `${P}btn`, 'СБРОС');
      clear.type = 'button';
      clear.addEventListener('click', () => {
        this.reset();
        notify?.();
      });

      root.append(out, body, clear);
      container.append(root);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      this.reset();
    },

    getValue(): string {
      return dialed;
    },

    reset(): void {
      dialed = '';
      dragIndex = -1;
      rotation = 0;
      spin(0, false);
      show();
    },

    destroy(): void {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      root?.remove();
      root = null;
    },
  };
};
