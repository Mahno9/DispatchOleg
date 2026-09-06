import { describe, expect, it } from 'vitest';
import type { Character, MetaStage, MetaStageCharacter, MetaStageTrigger } from '../api';
import type { GameResult } from '../state/localState';
import {
  bgStyle,
  pendingDialogueIds,
  requiredDialogueCount,
  resolveStage,
  stageDialogueIds,
  stageMatches,
} from './metaStage';

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

function character(id: number, metaDialogueId: number | null): Character {
  return {
    id,
    name: `C${id}`,
    portraitAsset: null,
    metaDialogueId,
    metaPosition: 'left',
    description: '',
  };
}

function placed(id: number, sortOrder: number, characters: MetaStageCharacter[]): MetaStage {
  return {
    id,
    title: `S${id}`,
    sortOrder,
    background: {},
    characters,
    trigger: { type: 'wonCount', value: 0 },
  };
}

describe('stageDialogueIds', () => {
  const cast = [character(1, 100), character(2, 200), character(3, null)];

  it('counts a dialogue hung on several characters once', () => {
    const stage = placed(1, 0, [
      { characterId: 1, x: 10, y: 10 },
      { characterId: 2, x: 20, y: 20, dialogueId: 100 },
    ]);
    expect(stageDialogueIds(stage, cast)).toEqual([100]);
  });

  it('lets a placement override the character default', () => {
    const stage = placed(1, 0, [{ characterId: 1, x: 0, y: 0, dialogueId: 777 }]);
    expect(stageDialogueIds(stage, cast)).toEqual([777]);
  });

  it('drops placements whose character is not in the roster', () => {
    const stage = placed(1, 0, [
      { characterId: 99, x: 0, y: 0 },
      { characterId: 2, x: 0, y: 0 },
    ]);
    expect(stageDialogueIds(stage, cast)).toEqual([200]);
  });

  it('treats a character with nothing to say as scenery', () => {
    expect(stageDialogueIds(placed(1, 0, [{ characterId: 3, x: 0, y: 0 }]), cast)).toEqual([]);
  });

  it('falls back to the character default on an empty override', () => {
    // `entry.dialogueId ?? character.metaDialogueId` — как и PlacedCharacter,
    // который на такую расстановку всё равно рисует кликабельного персонажа.
    const stage = placed(1, 0, [{ characterId: 1, x: 0, y: 0, dialogueId: null }]);
    expect(stageDialogueIds(stage, cast)).toEqual([100]);
  });

  it('is empty for a stage with no placements at all', () => {
    expect(stageDialogueIds(placed(1, 0, []), cast)).toEqual([]);
  });

  it('falls back to the chatty cast when no stage is on screen', () => {
    expect(stageDialogueIds(null, cast)).toEqual([100, 200]);
    expect(stageDialogueIds(null, [character(3, null)])).toEqual([]);
  });
});

describe('pendingDialogueIds', () => {
  const cast = [character(1, 100), character(2, 200), character(3, 300)];

  it('subtracts what has been read and keeps the order', () => {
    expect(pendingDialogueIds(null, cast, [])).toEqual([100, 200, 300]);
    expect(pendingDialogueIds(null, cast, [200])).toEqual([100, 300]);
    expect(pendingDialogueIds(null, cast, [300, 100, 200])).toEqual([]);
  });

  it('ignores read ids that the stage never offered', () => {
    const stage = placed(1, 0, [{ characterId: 2, x: 0, y: 0 }]);
    expect(pendingDialogueIds(stage, cast, [999, 100])).toEqual([200]);
  });

  it('is empty while the roster has not loaded — the gate must let the player pass', () => {
    expect(pendingDialogueIds(null, [], [])).toEqual([]);
    expect(pendingDialogueIds(placed(1, 0, [{ characterId: 1, x: 0, y: 0 }]), [], [])).toEqual([]);
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

describe('requiredDialogueCount — порция диалогов перед операцией', () => {
  // Пороги 0 / 1 / 3 / 5 и финал по списку игр — как в контенте.
  const s0 = stage(18, 10, { type: 'wonCount', value: 0 });
  const s1 = stage(30, 20, { type: 'wonCount', value: 1 });
  const s3 = stage(31, 30, { type: 'wonCount', value: 3 });
  const s5 = stage(32, 40, { type: 'wonCount', value: 5 });
  const sEnd = stage(33, 50, { type: 'games', ids: [1, 2, 3, 4, 5, 6] });
  const all = [sEnd, s5, s3, s1, s0]; // порядок в массиве не важен

  it('сцена на одну операцию требует всех', () => {
    expect(requiredDialogueCount(all, s0, 0, 4)).toBe(4);
  });

  it('сцена на две операции: половина, потом все', () => {
    expect(requiredDialogueCount(all, s1, 1, 4)).toBe(2);
    expect(requiredDialogueCount(all, s1, 2, 4)).toBe(4);
    // нечётное число диалогов округляется вверх
    expect(requiredDialogueCount(all, s1, 1, 3)).toBe(2);
    expect(requiredDialogueCount(all, s3, 3, 5)).toBe(3);
    expect(requiredDialogueCount(all, s3, 4, 5)).toBe(5);
  });

  it('сцена на три операции: треть, две трети, все', () => {
    const t0 = stage(1, 1, { type: 'wonCount', value: 0 });
    const t3 = stage(2, 2, { type: 'wonCount', value: 3 });
    expect(requiredDialogueCount([t0, t3], t0, 0, 6)).toBe(2);
    expect(requiredDialogueCount([t0, t3], t0, 1, 6)).toBe(4);
    expect(requiredDialogueCount([t0, t3], t0, 2, 6)).toBe(6);
  });

  it('счётчик побед за пределами сцены не ломает порцию', () => {
    // тест-режим форсит сцену: побед может быть меньше порога или больше
    expect(requiredDialogueCount(all, s1, 0, 4)).toBe(2);
    expect(requiredDialogueCount(all, s1, 9, 4)).toBe(4);
  });

  it('games-триггер у сцены или у следующей, последняя сцена, нет сцены — все', () => {
    expect(requiredDialogueCount(all, s5, 5, 4)).toBe(4); // следующая — games
    expect(requiredDialogueCount(all, sEnd, 6, 4)).toBe(4); // сама games и последняя
    expect(requiredDialogueCount(all, null, 0, 4)).toBe(4);
    expect(requiredDialogueCount([s0], s0, 0, 4)).toBe(4); // единственная
  });

  it('две сцены с одним порогом не дают нулевого окна', () => {
    const a = stage(1, 1, { type: 'wonCount', value: 2 });
    const b = stage(2, 2, { type: 'wonCount', value: 2 });
    expect(requiredDialogueCount([a, b], a, 2, 4)).toBe(4);
  });
});
