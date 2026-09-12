import { describe, expect, it } from 'vitest';
import type { Game } from '../api';
import type { GameResult } from '../state/localState';
import { allRosterWon, finaleGame, isWon, rosterGames, shouldShowVictory } from './flow';

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

const tutorial = game(0, { isTutorial: true });
const finale = game(99, { isFinale: true, title: 'Разбор ночной смены' });

function won(...ids: number[]): Record<string, GameResult> {
  return Object.fromEntries(
    ids.map((id) => [String(id), { bestScore: 5, won: true, attempts: 1, firstCompletedAt: 0 }]),
  );
}

describe('rosterGames', () => {
  it('оставляет только операции смены — без обучалки и финала', () => {
    const list = [tutorial, game(1), game(2), finale];
    expect(rosterGames(list).map((g) => g.id)).toEqual([1, 2]);
  });

  it('пустой список игр — пустой ростер', () => {
    expect(rosterGames([])).toEqual([]);
    expect(rosterGames([tutorial, finale])).toEqual([]);
  });
});

describe('finaleGame', () => {
  it('находит финал и молчит, когда его нет', () => {
    expect(finaleGame([tutorial, game(1), finale])?.id).toBe(99);
    expect(finaleGame([tutorial, game(1)])).toBeNull();
  });
});

describe('allRosterWon', () => {
  const list = [tutorial, game(1), game(2), finale];

  it('не смотрит на финал: выигран ростер — смена отработана', () => {
    expect(allRosterWon(list, won(1, 2))).toBe(true);
    // И наоборот: выигранный финал сам по себе ростер не закрывает.
    expect(allRosterWon(list, won(1, 99))).toBe(false);
  });

  it('обучалка тоже не в счёт', () => {
    expect(allRosterWon(list, won(0, 1))).toBe(false);
  });

  it('игры не доехали — это не победа', () => {
    expect(allRosterWon([], {})).toBe(false);
    expect(allRosterWon([tutorial, finale], {})).toBe(false);
  });
});

describe('isWon', () => {
  it('только выигрыш, не попытка', () => {
    const played = { '1': { bestScore: 3, won: false, attempts: 2, firstCompletedAt: 0 } };
    expect(isWon(game(1), played)).toBe(false);
    expect(isWon(game(1), won(1))).toBe(true);
  });
});

describe('shouldShowVictory · смена с финалом', () => {
  const games = [tutorial, game(1), game(2), finale];

  it('ростер не добит — финала нет', () => {
    expect(shouldShowVictory({ games, results: won(1), victorySeen: false })).toBe(false);
  });

  it('ростер добит, финал впереди — победа с кнопкой «Закрыть смену»', () => {
    expect(shouldShowVictory({ games, results: won(1, 2), victorySeen: false })).toBe(true);
  });

  // Игрок вышел из «Разбора» на середине и вернулся на мету: флаг показа уже
  // стоит, но ворота к финалу обязаны открыться снова.
  it('финал брошен на середине — победа встречает снова, флаг не помеха', () => {
    expect(shouldShowVictory({ games, results: won(1, 2), victorySeen: true })).toBe(true);
  });

  it('финал выигран — победу больше не показываем', () => {
    expect(shouldShowVictory({ games, results: won(1, 2, 99), victorySeen: false })).toBe(false);
    expect(shouldShowVictory({ games, results: won(1, 2, 99), victorySeen: true })).toBe(false);
  });
});

describe('shouldShowVictory · смена без финала', () => {
  const games = [tutorial, game(1), game(2)];

  it('один показ на прохождение — дальше держит флаг', () => {
    expect(shouldShowVictory({ games, results: won(1, 2), victorySeen: false })).toBe(true);
    expect(shouldShowVictory({ games, results: won(1, 2), victorySeen: true })).toBe(false);
  });

  it('без полного прохождения флаг ничего не решает', () => {
    expect(shouldShowVictory({ games, results: won(1), victorySeen: false })).toBe(false);
    expect(shouldShowVictory({ games, results: won(1), victorySeen: true })).toBe(false);
  });
});
