import { describe, expect, it } from 'vitest';
import type { Game } from '../api';
import type { GameResult } from '../state/localState';
import { isUnlocked, metaSide, pickRandomGame } from './MetaScreen';

function game(id: number, requiredGameIds: number[] = []): Game {
  return {
    id,
    title: `G${id}`,
    minigameId: 'demo',
    isTutorial: false,
    requiredGameIds,
    sortOrder: id,
    character: null,
  };
}

describe('isUnlocked', () => {
  it('opens a game with no prerequisites', () => {
    expect(isUnlocked(game(1), {})).toBe(true);
  });

  it('requires every prerequisite to be won, not merely played', () => {
    const played = { '1': { bestScore: 0, won: false, attempts: 1, firstCompletedAt: 0 } };
    const beaten = { '1': { bestScore: 9, won: true, attempts: 1, firstCompletedAt: 0 } };
    expect(isUnlocked(game(2, [1]), {})).toBe(false);
    expect(isUnlocked(game(2, [1]), played)).toBe(false);
    expect(isUnlocked(game(2, [1]), beaten)).toBe(true);
    expect(isUnlocked(game(3, [1, 2]), beaten)).toBe(false);
  });
});

describe('pickRandomGame', () => {
  function won(...ids: number[]): Record<string, GameResult> {
    return Object.fromEntries(
      ids.map((id) => [String(id), { bestScore: 5, won: true, attempts: 1, firstCompletedAt: 0 }]),
    );
  }

  const tutorial: Game = { ...game(0), isTutorial: true };

  it('returns null when nothing is unlocked', () => {
    expect(pickRandomGame([], {}, () => 0)).toBe(null);
    expect(pickRandomGame([tutorial], {}, () => 0)).toBe(null);
    expect(pickRandomGame([game(2, [1])], {}, () => 0)).toBe(null);
  });

  it('never offers the tutorial', () => {
    expect(pickRandomGame([tutorial, game(1)], {}, () => 0)?.id).toBe(1);
    expect(pickRandomGame([tutorial, game(1)], {}, () => 0.99)?.id).toBe(1);
  });

  it('picks across the unlocked and unbeaten pool', () => {
    const games = [game(1), game(2), game(3)];
    expect(pickRandomGame(games, {}, () => 0)?.id).toBe(1);
    expect(pickRandomGame(games, {}, () => 0.99)?.id).toBe(3);
    expect(pickRandomGame(games, {}, () => 0.5)?.id).toBe(2);
  });

  it('prefers a game that has not been won yet', () => {
    const games = [game(1), game(2)];
    expect(pickRandomGame(games, won(1), () => 0)?.id).toBe(2);
    expect(pickRandomGame(games, won(1), () => 0.99)?.id).toBe(2);
  });

  it('lets an all-clear player replay any unlocked game', () => {
    const games = [game(1), game(2)];
    expect(pickRandomGame(games, won(1, 2), () => 0)?.id).toBe(1);
    expect(pickRandomGame(games, won(1, 2), () => 0.99)?.id).toBe(2);
  });

  it('skips a game whose prerequisites are not won', () => {
    const games = [game(1), game(2, [3])];
    expect(pickRandomGame(games, {}, () => 0.99)?.id).toBe(1);
  });
});

describe('metaSide', () => {
  it('sends only explicit right slots to the right', () => {
    expect(metaSide('right')).toBe('right');
    expect(metaSide('RIGHT-2')).toBe('right');
    expect(metaSide('право')).toBe('right');
    expect(metaSide('left')).toBe('left');
    expect(metaSide('')).toBe('left');
    expect(metaSide('{"x":0.2,"y":0.5}')).toBe('left');
  });
});
