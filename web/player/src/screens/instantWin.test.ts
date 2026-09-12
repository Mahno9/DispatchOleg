import { describe, expect, it } from 'vitest';
import type { Game } from '../api';
import type { GameResult } from '../state/localState';
import { INSTANT_WIN_RESULT, instantFinaleTarget, instantWinTarget } from './instantWin';
import { isUnlocked } from './MetaScreen';

function game(id: number, extra: Partial<Game> = {}): Game {
  return {
    id,
    title: `G${id}`,
    minigameId: 'demo',
    isTutorial: false,
    isFinale: false,
    requiredGameIds: [],
    sortOrder: id,
    character: null,
    ...extra,
  };
}

function won(...ids: number[]): Record<string, GameResult> {
  return Object.fromEntries(
    ids.map((id) => [String(id), { bestScore: 5, won: true, attempts: 1, firstCompletedAt: 0 }]),
  );
}

const tutorial = game(0, { isTutorial: true });
const finale = game(99, { isFinale: true, title: 'Разбор ночной смены' });
const roster = [tutorial, game(1), game(2, { requiredGameIds: [1] }), finale];

describe('instantWinTarget', () => {
  it('вне тест-режима Shift не значит ничего', () => {
    expect(instantWinTarget({ testMode: false, shift: true, games: roster, results: {} })).toBeNull();
  });

  it('в тест-режиме без Shift кнопка работает как обычно', () => {
    expect(instantWinTarget({ testMode: true, shift: false, games: roster, results: {} })).toBeNull();
  });

  it('отдаёт разблокированную и ещё не выигранную операцию', () => {
    const pick = instantWinTarget({ testMode: true, shift: true, games: roster, results: {} });
    expect(pick?.id).toBe(1);
    // Закрыли первую — жребий переходит к той, что она открывает.
    const next = instantWinTarget({
      testMode: true,
      shift: true,
      games: roster,
      results: won(1),
    });
    expect(next?.id).toBe(2);
  });

  it('обучалку и финал не трогает', () => {
    expect(
      instantWinTarget({ testMode: true, shift: true, games: [tutorial, finale], results: {} }),
    ).toBeNull();
  });

  it('закрывать нечего — null (всё выиграно, заперто, ростер пуст)', () => {
    expect(
      instantWinTarget({ testMode: true, shift: true, games: roster, results: won(1, 2) }),
    ).toBeNull();
    expect(
      instantWinTarget({ testMode: true, shift: true, games: [game(5, { requiredGameIds: [4] })], results: {} }),
    ).toBeNull();
    expect(instantWinTarget({ testMode: true, shift: true, games: [], results: {} })).toBeNull();
  });
});

describe('instantFinaleTarget', () => {
  it('отдаёт финал только в тест-режиме и только по Shift', () => {
    expect(
      instantFinaleTarget({ testMode: true, shift: true, games: roster, results: won(1, 2) })?.id,
    ).toBe(99);
    expect(
      instantFinaleTarget({ testMode: false, shift: true, games: roster, results: won(1, 2) }),
    ).toBeNull();
    expect(
      instantFinaleTarget({ testMode: true, shift: false, games: roster, results: won(1, 2) }),
    ).toBeNull();
  });

  it('финала нет или он уже выигран — null', () => {
    expect(
      instantFinaleTarget({ testMode: true, shift: true, games: [game(1)], results: {} }),
    ).toBeNull();
    expect(
      instantFinaleTarget({ testMode: true, shift: true, games: roster, results: won(1, 2, 99) }),
    ).toBeNull();
  });
});

describe('запись мгновенной победы', () => {
  it('открывает зависимые операции — как обычная победа', () => {
    // Повторяет запись localState.recordGameResult: победа с нулём очков.
    const record = (
      results: Record<string, GameResult>,
      id: number,
    ): Record<string, GameResult> => ({
      ...results,
      [String(id)]: {
        bestScore: INSTANT_WIN_RESULT.score,
        won: INSTANT_WIN_RESULT.won,
        attempts: 1,
        firstCompletedAt: 0,
      },
    });

    const dependent = game(2, { requiredGameIds: [1] });
    expect(isUnlocked(dependent, {})).toBe(false);
    const pick = instantWinTarget({ testMode: true, shift: true, games: roster, results: {} });
    expect(pick).not.toBeNull();
    const after = record({}, pick!.id);
    expect(isUnlocked(dependent, after)).toBe(true);
  });
});
