import { describe, expect, it } from 'vitest';
import { needsBriefing } from './MinigameScreen';

describe('needsBriefing', () => {
  // Раньше стрелки показывались КАЖДЫЙ запуск: на второй попытке игрок снова
  // кликал три подписи, прежде чем игра начинала тикать.
  it('на повторной попытке инструктаж сам не всплывает', () => {
    expect(needsBriefing('safe-crack', [])).toBe(true);
    expect(needsBriefing('safe-crack', ['safe-crack'])).toBe(false);
  });

  it('отметка по другой игре чужой инструктаж не гасит', () => {
    expect(needsBriefing('safe-crack', ['tetris-fill'])).toBe(true);
  });

  it('у игры без шагов инструктажа нет и в первый раз', () => {
    expect(needsBriefing('нет-такой-игры', [])).toBe(false);
  });
});
