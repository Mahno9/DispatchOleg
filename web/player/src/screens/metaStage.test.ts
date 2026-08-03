import { describe, expect, it } from 'vitest';
import type { MetaStage, MetaStageTrigger } from '../api';
import type { GameResult } from '../state/localState';
import { bgStyle, resolveStage, stageMatches } from './metaStage';

function won(...ids: number[]): Record<string, GameResult> {
  return Object.fromEntries(
    ids.map((id) => [String(id), { bestScore: 10, won: true, attempts: 1, firstCompletedAt: 0 }]),
  );
}

function lost(...ids: number[]): Record<string, GameResult> {
  return Object.fromEntries(
    ids.map((id) => [String(id), { bestScore: 0, won: false, attempts: 3, firstCompletedAt: 0 }]),
  );
}

function stage(id: number, sortOrder: number, trigger: MetaStageTrigger): MetaStage {
  return { id, title: `S${id}`, sortOrder, background: {}, characters: [], trigger };
}

const PLAYABLE = [1, 2, 3];

describe('stageMatches — wonCount', () => {
  it('is satisfied by a threshold of zero even with nothing played', () => {
    expect(stageMatches({ type: 'wonCount', value: 0 }, {}, PLAYABLE)).toBe(true);
  });

  it('compares the count of won games against the threshold', () => {
    const results = won(1, 2);
    expect(stageMatches({ type: 'wonCount', value: 1 }, results, PLAYABLE)).toBe(true);
    expect(stageMatches({ type: 'wonCount', value: 2 }, results, PLAYABLE)).toBe(true);
    expect(stageMatches({ type: 'wonCount', value: 3 }, results, PLAYABLE)).toBe(false);
  });

  it('ignores results that are not wins', () => {
    expect(stageMatches({ type: 'wonCount', value: 1 }, lost(1, 2, 3), PLAYABLE)).toBe(false);
    expect(
      stageMatches({ type: 'wonCount', value: 1 }, { ...lost(1, 2), ...won(3) }, PLAYABLE),
    ).toBe(true);
  });

  it('only counts games that are in the playable list', () => {
    // A win recorded for a game the server no longer serves must not inflate it.
    expect(stageMatches({ type: 'wonCount', value: 1 }, won(99), PLAYABLE)).toBe(false);
  });
});

describe('stageMatches — games', () => {
  it('requires every listed game to be won', () => {
    expect(stageMatches({ type: 'games', ids: [1, 2] }, won(1), PLAYABLE)).toBe(false);
    expect(stageMatches({ type: 'games', ids: [1, 2] }, won(1, 2), PLAYABLE)).toBe(true);
    expect(stageMatches({ type: 'games', ids: [1] }, lost(1), PLAYABLE)).toBe(false);
  });

  it('treats an empty id list as always satisfied', () => {
    expect(stageMatches({ type: 'games', ids: [] }, {}, PLAYABLE)).toBe(true);
  });
});

describe('resolveStage', () => {
  it('returns null for an empty stage list', () => {
    expect(resolveStage([], won(1, 2, 3), PLAYABLE)).toBe(null);
  });

  it('returns null when no stage is satisfied', () => {
    const stages = [stage(1, 0, { type: 'wonCount', value: 2 })];
    expect(resolveStage(stages, {}, PLAYABLE)).toBe(null);
  });

  it('picks the last satisfied stage in (sortOrder, id) order', () => {
    const stages = [
      stage(10, 2, { type: 'wonCount', value: 2 }),
      stage(11, 0, { type: 'wonCount', value: 0 }),
      stage(12, 1, { type: 'wonCount', value: 1 }),
    ];
    expect(resolveStage(stages, {}, PLAYABLE)?.id).toBe(11);
    expect(resolveStage(stages, won(1), PLAYABLE)?.id).toBe(12);
    expect(resolveStage(stages, won(1, 2), PLAYABLE)?.id).toBe(10);
  });

  it('breaks a sortOrder tie by id, last one winning', () => {
    const stages = [
      stage(7, 5, { type: 'wonCount', value: 0 }),
      stage(3, 5, { type: 'wonCount', value: 0 }),
    ];
    expect(resolveStage(stages, {}, PLAYABLE)?.id).toBe(7);
  });

  it('skips an unsatisfied later stage and keeps the earlier match', () => {
    const stages = [
      stage(1, 0, { type: 'wonCount', value: 0 }),
      stage(2, 1, { type: 'games', ids: [1, 2, 3] }),
    ];
    expect(resolveStage(stages, won(1), PLAYABLE)?.id).toBe(1);
    expect(resolveStage(stages, won(1, 2, 3), PLAYABLE)?.id).toBe(2);
  });
});

describe('bgStyle', () => {
  it('returns nothing to override when there is no image', () => {
    expect(bgStyle({})).toEqual({});
    expect(bgStyle({ fit: 'cover', scale: 2 })).toEqual({});
  });

  it('mirrors the admin preview sizes at scale 1', () => {
    expect(bgStyle({ image: 'a.png' }).backgroundSize).toBe('cover');
    expect(bgStyle({ image: 'a.png', fit: 'contain' }).backgroundSize).toBe('contain');
    expect(bgStyle({ image: 'a.png', fit: 'fill-x' }).backgroundSize).toBe('100% auto');
    expect(bgStyle({ image: 'a.png', fit: 'fill-y' }).backgroundSize).toBe('auto 100%');
    expect(bgStyle({ image: 'a.png', fit: 'center' }).backgroundSize).toBe('auto');
    expect(bgStyle({ image: 'a.png', fit: 'tile' }).backgroundSize).toBe('auto');
  });

  it('applies scale as a percentage on the free axis', () => {
    expect(bgStyle({ image: 'a.png', fit: 'cover', scale: 1.5 }).backgroundSize).toBe('150% auto');
    expect(bgStyle({ image: 'a.png', fit: 'contain', scale: 0.5 }).backgroundSize).toBe('auto 50%');
    expect(bgStyle({ image: 'a.png', fit: 'fill-y', scale: 2 }).backgroundSize).toBe('auto 200%');
    expect(bgStyle({ image: 'a.png', fit: 'tile', scale: 2 }).backgroundSize).toBe('200% auto');
  });

  it('repeats only for tile', () => {
    expect(bgStyle({ image: 'a.png', fit: 'tile' }).backgroundRepeat).toBe('repeat');
    expect(bgStyle({ image: 'a.png', fit: 'cover' }).backgroundRepeat).toBe('no-repeat');
  });

  it('offsets from the centre on the axes that have slack', () => {
    const off = { x: 10, y: -20 };
    expect(bgStyle({ image: 'a.png', offset: off }).backgroundPosition).toBe(
      'calc(50% + 10%) calc(50% + -20%)',
    );
    expect(bgStyle({ image: 'a.png', fit: 'fill-x', offset: off }).backgroundPosition).toBe(
      'center calc(50% + -20%)',
    );
    expect(bgStyle({ image: 'a.png', fit: 'fill-y', offset: off }).backgroundPosition).toBe(
      'calc(50% + 10%) center',
    );
    expect(bgStyle({ image: 'a.png', fit: 'tile', offset: off }).backgroundPosition).toBe(
      '10% -20%',
    );
  });

  it('defaults a missing offset to dead centre', () => {
    expect(bgStyle({ image: 'a.png' }).backgroundPosition).toBe('calc(50% + 0%) calc(50% + 0%)');
  });

  it('sets background longhands so the theme gradient cannot show through', () => {
    const style = bgStyle({ image: 'a.png' });
    expect(style.backgroundImage).toBe('url(a.png)');
    expect(style.backgroundColor).toBeDefined();
  });
});
