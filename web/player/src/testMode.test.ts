import { describe, expect, it } from 'vitest';
import type { Game, MetaStage, MetaStageTrigger } from './api';
import { rosterGames } from './screens/flow';
import { resolveStage, stageMatches } from './screens/metaStage';
import { completedGameResults, parseTestTarget, stageTestGameIds } from './testMode';

describe('parseTestTarget', () => {
  it('parses every target', () => {
    expect(parseTestTarget('?test=onboarding')).toEqual({ kind: 'onboarding' });
    expect(parseTestTarget('?test=meta')).toEqual({ kind: 'meta', stageId: null });
    expect(parseTestTarget('?test=meta:7')).toEqual({ kind: 'meta', stageId: 7 });
    expect(parseTestTarget('?test=game:12')).toEqual({ kind: 'game', gameId: 12 });
    expect(parseTestTarget('?test=dialogue:3')).toEqual({ kind: 'dialogue', dialogueId: 3 });
    expect(parseTestTarget('?test=endgame')).toEqual({ kind: 'endgame' });
    expect(parseTestTarget('?test=victory')).toEqual({ kind: 'victory' });
  });

  it('ignores absent or malformed values', () => {
    expect(parseTestTarget('')).toBeNull();
    expect(parseTestTarget('?foo=bar')).toBeNull();
    expect(parseTestTarget('?test=')).toBeNull();
    expect(parseTestTarget('?test=game:')).toBeNull();
    expect(parseTestTarget('?test=game:abc')).toBeNull();
    expect(parseTestTarget('?test=dialogue:x')).toBeNull();
  });
});

it('builds completed progress for the endgame test button', () => {
  expect(completedGameResults([7, 12], 123)).toEqual({
    '7': { bestScore: 0, won: true, attempts: 1, firstCompletedAt: 123 },
    '12': { bestScore: 0, won: true, attempts: 1, firstCompletedAt: 123 },
  });
});

// --- stageTestGameIds -------------------------------------------------------

function game(id: number, sortOrder: number, extra: Partial<Game> = {}): Game {
  return {
    id,
    title: `Игра ${id}`,
    minigameId: 'stub',
    isTutorial: false,
    isFinale: false,
    requiredGameIds: [],
    sortOrder,
    character: null,
    ...extra,
  };
}

function stage(id: number, sortOrder: number, trigger: MetaStageTrigger): MetaStage {
  return { id, title: `Сцена ${id}`, sortOrder, background: {}, characters: [], trigger };
}

/** Ростер «как в контенте»: шесть операций, финал (20) в него не входит. */
const GAMES: Game[] = [
  game(20, 0, { isFinale: true }),
  game(21, 1),
  game(22, 2),
  game(23, 3),
  game(24, 4),
  game(25, 5),
  game(9, 9, { isTutorial: true }),
];

describe('stageTestGameIds', () => {
  it('takes the trigger ids as they are, finale included', () => {
    expect(stageTestGameIds(stage(1, 0, { type: 'games', ids: [20, 22] }), rosterGames(GAMES))).toEqual([
      20, 22,
    ]);
  });

  it('takes the first N roster games by (sortOrder, id)', () => {
    expect(stageTestGameIds(stage(1, 0, { type: 'wonCount', value: 3 }), rosterGames(GAMES))).toEqual([
      21, 22, 23,
    ]);
  });

  it('orders by sortOrder, not by id', () => {
    const shuffled = [game(7, 2), game(3, 0), game(5, 1)];
    expect(stageTestGameIds(stage(1, 0, { type: 'wonCount', value: 2 }), shuffled)).toEqual([3, 5]);
  });

  it('breaks a sortOrder tie by id', () => {
    const tied = [game(8, 0), game(2, 0), game(5, 0)];
    expect(stageTestGameIds(stage(1, 0, { type: 'wonCount', value: 2 }), tied)).toEqual([2, 5]);
  });

  it('clamps a threshold above the roster and yields nothing at zero', () => {
    const roster = rosterGames(GAMES);
    expect(stageTestGameIds(stage(1, 0, { type: 'wonCount', value: 99 }), roster)).toEqual([
      21, 22, 23, 24, 25,
    ]);
    expect(stageTestGameIds(stage(1, 0, { type: 'wonCount', value: 0 }), roster)).toEqual([]);
  });

  it('never seeds the finale or the tutorial through wonCount', () => {
    const ids = stageTestGameIds(stage(1, 0, { type: 'wonCount', value: 99 }), rosterGames(GAMES));
    expect(ids).not.toContain(20);
    expect(ids).not.toContain(9);
  });
});

describe('seeded results resolve back to the forced stage', () => {
  // Раскладка сцен как в контенте: пороги 0/1/3/4 и финальная на games —
  // «После смены» держится на победах ростера, финала (20) в списке нет.
  const STAGES: MetaStage[] = [
    stage(1, 0, { type: 'wonCount', value: 0 }),
    stage(2, 1, { type: 'wonCount', value: 1 }),
    stage(3, 2, { type: 'wonCount', value: 3 }),
    stage(4, 3, { type: 'wonCount', value: 4 }),
    stage(5, 4, { type: 'games', ids: [21, 22, 23, 24, 25] }),
  ];
  const roster = rosterGames(GAMES);
  const playableIds = roster.map((g) => g.id);

  for (const target of STAGES) {
    it(`stage #${target.id} (${target.trigger.type})`, () => {
      const results = completedGameResults(stageTestGameIds(target, roster), 1);
      expect(stageMatches(target.trigger, results, playableIds)).toBe(true);
      expect(resolveStage(STAGES, results, playableIds)?.id).toBe(target.id);
    });
  }
});
