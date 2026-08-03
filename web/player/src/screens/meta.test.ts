import { describe, expect, it } from 'vitest';
import type { Game } from '../api';
import { isUnlocked, metaSide } from './MetaScreen';

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
