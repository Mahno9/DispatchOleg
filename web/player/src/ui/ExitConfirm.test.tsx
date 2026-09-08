import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ExitConfirm } from './ExitConfirm';

// В плеере нет DOM-окружения (vitest в node, без jsdom): проверяем разметку
// через SSR — состав панели и переиспользованные классы терминала видны.
const html = renderToStaticMarkup(<ExitConfirm onConfirm={() => {}} onCancel={() => {}} />);

describe('ExitConfirm', () => {
  it('спрашивает и говорит, чем грозит согласие', () => {
    expect(html).toContain('Прервать операцию?');
    expect(html).toContain('Попытка не засчитается');
  });

  // Отмена обязана быть: без неё панель — это тот же выход в один клик.
  it('даёт и прервать, и вернуться в игру', () => {
    expect(html).toContain('ПРЕРВАТЬ');
    expect(html).toContain('ПРОДОЛЖИТЬ');
    expect(html.match(/<button/g)?.length).toBe(2);
  });

  it('переиспользует разметку отказов терминала, а не свою', () => {
    expect(html).toContain('class="scan-refusal"');
    expect(html).toContain('class="panel"');
    expect(html).toContain('class="btn btn-danger"');
  });
});
