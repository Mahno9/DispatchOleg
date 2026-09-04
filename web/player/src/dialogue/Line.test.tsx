import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DialogueLine, TypedLine, splitSpeaker } from './Line';
import { BarPortrait } from '../ui/BarPortrait';
import { BottomBar } from '../ui/BottomBar';
import type { Character } from '../api';
import games from '../../../../content/games.json' with { type: 'json' };
import castRows from '../../../../content/characters.json' with { type: 'json' };

// В плеере нет DOM-окружения (vitest в node, без jsdom), поэтому проверяем
// разметку через SSR: эффекты не тикают, но раскладка и проводка пропсов видны.
function html(node: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(node);
}

function character(over: Partial<Character> = {}): Character {
  return {
    id: 56,
    name: 'Малевола Красноватая',
    portraitAsset: '/assets-store/OQ7I0Oh4A8.svg',
    metaDialogueId: null,
    metaPosition: 'right',
    description: '',
    ...over,
  };
}

describe('DialogueLine', () => {
  const text = 'Держите ригель ровно шесть секунд.';

  it('печатает начало и прячет хвост, сохраняя его в разметке', () => {
    const out = html(<DialogueLine name="Малевола" text={text} shown={7} done={false} />);
    expect(out).toContain('Малевола');
    expect(out).toContain('Держите');
    // Хвост на месте, но невидим — строка держит финальную раскладку.
    expect(out).toContain('dialogue-hidden');
    expect(out).toContain('ригель ровно шесть секунд.');
    // Курсор мигает, пока печать не закончилась.
    expect(out).not.toContain('dialogue-cursor dialogue-hidden');
  });

  it('на дописанной строке курсор гаснет', () => {
    const out = html(<DialogueLine name="Малевола" text={text} shown={text.length} done />);
    expect(out).toContain('dialogue-cursor dialogue-hidden');
  });

  it('правый говорящий прижимает реплику вправо, безымянный — без строки имени', () => {
    expect(html(<DialogueLine name="X" text="a" shown={1} done side="right" />)).toContain(
      'dialogue-context-right',
    );
    expect(html(<DialogueLine name="" text="a" shown={1} done />)).not.toContain('dialogue-name');
  });
});

describe('TypedLine', () => {
  it('прижимается к стороне своего портрета', () => {
    // Подсказка мини-игры: портрет стоит в правом слоте панели, реплика — к нему.
    expect(html(<TypedLine name="Малевола" text="код" side="right" />)).toContain(
      'dialogue-context-right',
    );
    expect(html(<TypedLine name="Малевола" text="код" />)).not.toContain('dialogue-context-right');
  });
});

describe('splitSpeaker — говорящий из префикса «ИМЯ:»', () => {
  const cast = ['Чейз Альбертович', 'Олег'];

  it('узнаёт по первому слову имени и по полному', () => {
    expect(splitSpeaker('ЧЕЙЗ: Была.', cast)).toEqual({
      name: 'Чейз Альбертович',
      text: 'Была.',
    });
    expect(splitSpeaker('Чейз Альбертович: Была.', cast)).toEqual({
      name: 'Чейз Альбертович',
      text: 'Была.',
    });
  });

  it('регистр и «ё» не мешают', () => {
    expect(splitSpeaker('олег: Стены нет.', cast).name).toBe('Олег');
    expect(splitSpeaker('ФЁДОР: раз', ['Федор']).name).toBe('Федор');
  });

  it('незнакомый префикс реплику не режет', () => {
    expect(splitSpeaker('Внимание: сирена', cast)).toEqual({
      name: null,
      text: 'Внимание: сирена',
    });
    expect(splitSpeaker('Стены нет.', cast)).toEqual({ name: null, text: 'Стены нет.' });
    // Пустое имя персонажа не должно превращаться в совпадение.
    expect(splitSpeaker(': раз', ['', 'Олег']).name).toBeNull();
  });

  it('двоеточия внутри реплики остаются на месте', () => {
    expect(splitSpeaker('ЧЕЙЗ: Правило: не шуметь.', cast).text).toBe('Правило: не шуметь.');
  });
});

describe('портрет в нижней панели', () => {
  it('слот встаёт между репликой и кнопкой', () => {
    const out = html(
      <BottomBar
        cameraOn={false}
        context={<span>реплика</span>}
        portrait={<BarPortrait character={character()} />}
        action={<button type="button">Выйти</button>}
      />,
    );
    expect(out).toContain('bottombar bottombar-portrait');
    expect(out.indexOf('slot-portrait')).toBeGreaterThan(out.indexOf('slot-context'));
    expect(out.indexOf('slot-portrait')).toBeLessThan(out.indexOf('slot-action'));
  });

  it('без персонажа панель остаётся трёхслотовой', () => {
    const out = html(<BottomBar cameraOn={false} context={null} action={null} />);
    expect(out).not.toContain('bottombar-portrait');
    expect(out).not.toContain('slot-portrait');
  });

  it('слушающий персонаж гаснет, говорящий подсвечен', () => {
    expect(html(<BarPortrait character={character()} />)).toContain('portrait-speaking');
    expect(html(<BarPortrait character={character()} speaking={false} />)).toContain(
      'portrait-muted',
    );
  });

  it('без ассета рисуется силуэт, а не битая картинка', () => {
    expect(html(<BarPortrait character={character()} />)).toContain('/assets-store/OQ7I0Oh4A8.svg');
    expect(html(<BarPortrait character={character({ portraitAsset: null })} />)).not.toContain(
      '<img',
    );
  });
});

// Контентный сторож: в двухголосых репликах лабиринта префикс «ИМЯ:» должен
// опознаваться платформой. Не опознался — имя уедет в текст реплики, а подпись
// достанется не тому персонажу.
describe('content: реплики лабиринта подписаны знакомыми именами', () => {
  const game = games.find((g) => g.minigame_id === 'three-mazes');
  const character = castRows.find((c) => c.id === game?.character_id);
  const names = [character?.name ?? '', 'Олег'];
  const lines = Object.values(game?.config_json.barks ?? {})
    .flat()
    .flatMap((d) => d.lines as string[]);

  it('реплики вообще есть, и персонаж игры найден', () => {
    expect(character).toBeDefined();
    expect(lines.length).toBeGreaterThan(0);
  });

  it.each(lines)('«%s» — говорящий опознан', (line) => {
    // Плеер подставляет имя игрока в конфиг до init (docs/platform.md §3.4).
    const said = splitSpeaker(line.replaceAll('{player}', 'Олег'), names);
    expect(said.name).not.toBeNull();
  });
});
