import { describe, expect, it, vi } from 'vitest';
import { localState } from '../state/localState';
import { needsBriefing, rememberBriefing } from './MinigameScreen';

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

  it('песочница не записывает просмотр инструктажа', () => {
    const mark = vi.spyOn(localState, 'markBriefed').mockImplementation(() => undefined);
    rememberBriefing('safe-crack', false);
    expect(mark).not.toHaveBeenCalled();
    rememberBriefing('safe-crack', true);
    expect(mark).toHaveBeenCalledWith('safe-crack');
    mark.mockRestore();
  });
});
