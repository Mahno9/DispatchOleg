import { describe, it, expect } from 'vitest';
import { fillPlaceholders } from './minigameLoader';

describe('fillPlaceholders', () => {
  it('подставляет имя в строки на любой глубине', () => {
    const config = {
      playerName: '{player}',
      attempts: 2,
      muted: false,
      tasks: [
        { text: 'Разобрать входящие', assignee: '{player}', done: false, priority: 1 },
        { text: 'Обход района', assignee: 'Вторая смена', done: false, priority: 1 },
      ],
    };

    expect(fillPlaceholders(config, 'Маша')).toEqual({
      playerName: 'Маша',
      attempts: 2,
      muted: false,
      tasks: [
        { text: 'Разобрать входящие', assignee: 'Маша', done: false, priority: 1 },
        { text: 'Обход района', assignee: 'Вторая смена', done: false, priority: 1 },
      ],
    });
  });

  it('заменяет все вхождения в одной строке', () => {
    expect(fillPlaceholders({ t: '{player} и {player}' }, 'Ким')).toEqual({ t: 'Ким и Ким' });
  });

  it('не трогает конфиг без плейсхолдеров и не портит null', () => {
    const config = { a: 'текст', b: null, c: [1, 2] };
    expect(fillPlaceholders(config, 'Маша')).toEqual(config);
  });
});
