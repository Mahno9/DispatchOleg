import { dedupe, generateDecoys, normalize, shuffle } from '../engine.js';
import { el, int, P, type WidgetFactory } from './common.js';

/**
 * §2.2 «иголка в стоге»: нативный `select` на сотни пунктов без поиска.
 * Порядок перемешивается при каждой инициализации (§3.2).
 * §6.2: `answer` добавляется в список, если его там нет.
 */
export const createHaystackDropdown: WidgetFactory = (ctx) => {
  let root: HTMLElement | null = null;
  let select: HTMLSelectElement;
  let options: string[] = [];
  let notify: (() => void) | undefined;

  const fill = (): void => {
    select.textContent = '';
    for (const value of shuffle(options)) {
      const option = el('option', undefined, value) as HTMLOptionElement;
      option.value = value;
      select.append(option);
    }
    select.selectedIndex = 0;
  };

  return {
    mount(container, params, onChange): void {
      notify = onChange;
      const raw = Array.isArray(params.options) ? (params.options as unknown[]) : [];
      const listed = dedupe(raw.filter((v): v is string => typeof v === 'string' && v.trim() !== ''));
      options = listed.length > 0 ? listed : [ctx.answer, ...generateDecoys(ctx.answer, int(params, 'optionsCount', 300))];
      if (!options.some((o) => normalize(o) === normalize(ctx.answer))) {
        console.warn('[safe-crack] haystack-dropdown: ответа нет в options, добавлен принудительно');
        options = [...options, ctx.answer];
      }
      options = dedupe(options);

      root = el('div', `${P}haystack`);
      select = el('select', `${P}haystack__select ${P}mono`) as HTMLSelectElement;
      select.size = 10;
      select.addEventListener('change', () => notify?.());
      const counter = el('div', `${P}hint ${P}mono`, `ПУНКТОВ: ${options.length} · ПОИСКА НЕТ`);
      root.append(select, counter);
      container.append(root);
      this.reset();
    },

    getValue(): string {
      return select.value;
    },

    reset(): void {
      fill();
    },

    destroy(): void {
      root?.remove();
      root = null;
    },
  };
};
