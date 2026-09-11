import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Briefing, BriefingClose } from './MinigameScreen';

// В плеере нет DOM-окружения (vitest в node, без jsdom): разметку проверяем
// через SSR, а проводку клика — по пропсам элемента, который вернул компонент.
describe('Briefing', () => {
  // useLayoutEffect на сервере только ругается в консоль — замеры тут и не нужны.
  const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
  const html = renderToStaticMarkup(
    <Briefing
      minigameId="safe-crack"
      steps={[{ text: 'Шаг один' }]}
      hostRef={{ current: null }}
      onStart={() => {}}
    />,
  );
  quiet.mockRestore();

  // «Понятно» внизу справа терялось; закрывают теперь крестиком в углу, где потом «?».
  it('закрывается крестиком, а не кнопкой «Понятно»', () => {
    expect(html).toContain('class="btn tut-close"');
    expect(html).toContain('aria-label="Закрыть инструктаж"');
    expect(html).toContain('class="tut-close-icon"');
    expect(html).not.toContain('Понятно');
    expect(html.match(/<button/g)?.length).toBe(1);
  });

  it('крестик и есть старт игры: клик уходит в onStart', () => {
    const onStart = vi.fn();
    const button = BriefingClose({ onClose: onStart }) as ReactElement<{ onClick: () => void }>;
    button.props.onClick();
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('показывает две механики только в инструктаже подземки', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mazeHtml = renderToStaticMarkup(
      <Briefing minigameId="three-mazes" steps={[]} hostRef={{ current: null }} onStart={() => {}} />,
    );
    quiet.mockRestore();

    expect(mazeHtml.match(/class="tut-maze-demo"/g)).toHaveLength(2);
    expect(mazeHtml).toContain('class="tut-maze-suspicion"');
    expect(mazeHtml).toContain('разогнаться и пробить пунктирную стену');
    expect(mazeHtml).toContain('пройти круг дозора медленно');
    expect(mazeHtml).toContain('НЕЛЬЗЯ:');
    expect(html).not.toContain('tut-maze-demos');
  });
});
