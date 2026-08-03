import { describe, expect, it } from 'vitest';
import {
  buildResult,
  buildWordReels,
  compareAnswer,
  composeWords,
  createState,
  dedupe,
  EMPTY_SLOT,
  generateDecoys,
  normalize,
  normalizeConfig,
  normalizePattern,
  numberToWords,
  reduce,
  resolveExpected,
  shuffle,
  type Config,
  type Event,
  type Lock,
  type State,
} from './engine.js';

function lock(over: Partial<Lock> = {}): Lock {
  return { question: 'q', widget: 'mega-slider', answer: '1', points: 50, params: {}, ...over };
}

function config(over: Partial<Config> = {}): Config {
  return {
    title: 'СЕЙФ',
    timeLimitSeconds: 0,
    maxAttempts: 0,
    errorPenalty: 10,
    locks: [lock()],
    ...over,
  };
}

function run(cfg: Config, events: Event[], from?: State): State {
  return events.reduce((state, event) => reduce(state, event, cfg), from ?? createState(cfg));
}

/** Верный ответ на текущий ригель + докрутка checking. */
function solve(cfg: Config, state: State): State {
  const value = resolveExpected(cfg.locks[state.currentLock]!);
  return run(cfg, [{ type: 'SUBMIT', value }, { type: 'CHECK_DONE' }, { type: 'REVEAL_DONE' }], state);
}

describe('normalize / compareAnswer', () => {
  it('обрезает пробелы, игнорирует регистр и ё', () => {
    expect(normalize('  ЧЁТЫРЕ ')).toBe('четыре');
    expect(compareAnswer('  ЧЁТЫРЕ ', 'четыре')).toBe(true);
    expect(compareAnswer('Ёжик', 'ежик')).toBe(true);
  });

  it('не схлопывает внутренние пробелы и не канонизирует числа', () => {
    expect(compareAnswer('двести  три', 'двести три')).toBe(false);
    expect(compareAnswer('007', '7')).toBe(false);
  });
});

describe('FSM', () => {
  it('пустой locks[] → мгновенная победа (§6.1)', () => {
    const cfg = config({ locks: [] });
    const state = run(cfg, [{ type: 'START' }]);
    expect(state.phase).toBe('victory');
    const result = buildResult(state, cfg);
    expect(result).toMatchObject({ score: 0, won: true });
    expect(result.details).toMatchObject({ locksOpened: 0, locksTotal: 0 });
  });

  it('три верных ответа подряд → victory, score = сумма points', () => {
    const cfg = config({
      locks: [
        lock({ answer: 'а', points: 50 }),
        lock({ answer: 'б', points: 80 }),
        lock({ answer: 'в', points: 100 }),
      ],
    });
    let state = run(cfg, [{ type: 'START' }]);
    expect(state.phase).toBe('lock');
    state = solve(cfg, state);
    expect(state.phase).toBe('lock');
    expect(state.currentLock).toBe(1);
    state = solve(cfg, state);
    state = solve(cfg, state);
    expect(state.phase).toBe('victory');
    expect(state.score).toBe(230);
    expect(state.locksOpened).toBe(3);
  });

  it('ошибка: ригель тот же, mistakes++, score -= errorPenalty', () => {
    const cfg = config({ locks: [lock({ answer: 'а' }), lock({ answer: 'б' })] });
    let state = run(cfg, [{ type: 'START' }]);
    state = run(cfg, [{ type: 'SUBMIT', value: 'не то' }, { type: 'CHECK_DONE' }], state);
    expect(state.phase).toBe('lockFail');
    expect(state.mistakes).toBe(1);
    expect(state.score).toBe(-10);
    state = run(cfg, [{ type: 'REVEAL_DONE' }], state);
    expect(state.phase).toBe('lock');
    expect(state.currentLock).toBe(0);
  });

  it('maxAttempts = 1: ошибка на первом из трёх ригелей → defeat (§6.7)', () => {
    const cfg = config({ maxAttempts: 1, locks: [lock(), lock(), lock()] });
    let state = run(cfg, [{ type: 'START' }, { type: 'SUBMIT', value: 'мимо' }, { type: 'CHECK_DONE' }]);
    expect(state.phase).toBe('lockFail');
    expect(state.attemptsLeft).toBe(0);
    state = run(cfg, [{ type: 'REVEAL_DONE' }], state);
    expect(state.phase).toBe('defeat');
  });

  it('maxAttempts = 0: десять ошибок подряд — всё ещё lock, попытки бесконечны', () => {
    const cfg = config({ maxAttempts: 0, errorPenalty: 5 });
    let state = run(cfg, [{ type: 'START' }]);
    for (let i = 0; i < 10; i++) {
      state = run(cfg, [{ type: 'SUBMIT', value: 'мимо' }, { type: 'CHECK_DONE' }, { type: 'REVEAL_DONE' }], state);
    }
    expect(state.phase).toBe('lock');
    expect(state.attemptsLeft).toBe(Infinity);
    expect(state.mistakes).toBe(10);
    expect(state.score).toBe(-50);
  });

  it('score не уходит в минус в результате (§3.3)', () => {
    const cfg = config({ errorPenalty: 100, locks: [lock({ points: 0 })] });
    let state = run(cfg, [{ type: 'START' }, { type: 'SUBMIT', value: 'мимо' }, { type: 'CHECK_DONE' }]);
    state = run(cfg, [{ type: 'REVEAL_DONE' }], state);
    expect(state.score).toBe(-100);
    expect(buildResult(state, cfg).score).toBe(0);
  });

  it('победа приоритетнее истёкшего таймера (§3.5)', () => {
    const cfg = config({ timeLimitSeconds: 10, locks: [lock({ answer: 'а' })] });
    let state = run(cfg, [{ type: 'START' }, { type: 'SUBMIT', value: 'а' }]);
    state = run(cfg, [{ type: 'TICK', deltaSeconds: 10 }], state);
    expect(state.phase).toBe('checking');
    expect(state.timeExpired).toBe(true);
    state = run(cfg, [{ type: 'CHECK_DONE' }], state);
    expect(state.phase).toBe('victory');
    expect(buildResult(state, cfg).won).toBe(true);
  });

  it('TICK в victory/defeat ничего не меняет', () => {
    const cfg = config({ timeLimitSeconds: 10, locks: [] });
    const won = run(cfg, [{ type: 'START' }]);
    expect(reduce(won, { type: 'TICK', deltaSeconds: 99 }, cfg)).toBe(won);

    const lost = run(config({ timeLimitSeconds: 1 }), [{ type: 'START' }, { type: 'TICK', deltaSeconds: 1 }]);
    expect(lost.phase).toBe('defeat');
    expect(reduce(lost, { type: 'TICK', deltaSeconds: 99 }, cfg)).toBe(lost);
  });

  it('SUBMIT в фазе checking игнорируется (§6.4)', () => {
    const cfg = config({ locks: [lock({ answer: 'а' })] });
    const checking = run(cfg, [{ type: 'START' }, { type: 'SUBMIT', value: 'мимо' }]);
    expect(checking.phase).toBe('checking');
    const again = reduce(checking, { type: 'SUBMIT', value: 'а' }, cfg);
    expect(again).toBe(checking);
    expect(again.answerCorrect).toBe(false);
  });

  it('таймер вышел в checking при неверном ответе → defeat (§6.6)', () => {
    const cfg = config({ timeLimitSeconds: 5, locks: [lock({ answer: 'а' }), lock({ answer: 'б' })] });
    let state = run(cfg, [{ type: 'START' }, { type: 'SUBMIT', value: 'мимо' }]);
    state = run(cfg, [{ type: 'TICK', deltaSeconds: 5 }, { type: 'CHECK_DONE' }], state);
    expect(state.phase).toBe('defeat');
    expect(state.mistakes).toBe(1);
  });

  it('таймер вышел в checking, ответ верный, но ригели остались → defeat (§6.6)', () => {
    const cfg = config({ timeLimitSeconds: 5, locks: [lock({ answer: 'а' }), lock({ answer: 'б' })] });
    let state = run(cfg, [{ type: 'START' }, { type: 'SUBMIT', value: 'а' }]);
    state = run(cfg, [{ type: 'TICK', deltaSeconds: 5 }, { type: 'CHECK_DONE' }], state);
    expect(state.phase).toBe('defeat');
    expect(state.locksOpened).toBe(1);
    expect(buildResult(state, cfg).score).toBe(50);
  });

  it('resolveExpected: hold-button → hit, checkbox-wall → pattern, иначе answer', () => {
    expect(resolveExpected(lock({ widget: 'hold-button', answer: 'что угодно' }))).toBe('hit');
    const pattern = '0'.repeat(35) + '1';
    expect(resolveExpected(lock({ widget: 'checkbox-wall', params: { pattern, gridSize: 6 } }))).toBe(pattern);
    expect(resolveExpected(lock({ answer: '4471' }))).toBe('4471');
  });

  it('styleTag: medvezhatnik без ошибок, отсутствует при поражении', () => {
    const cfg = config({ locks: [lock({ answer: 'а' })] });
    const won = solve(cfg, run(cfg, [{ type: 'START' }]));
    expect(buildResult(won, cfg).details.styleTag).toBe('medvezhatnik');

    const cfg2 = config({ maxAttempts: 1, locks: [lock({ answer: 'а' })] });
    const lost = run(cfg2, [
      { type: 'START' },
      { type: 'SUBMIT', value: 'мимо' },
      { type: 'CHECK_DONE' },
      { type: 'REVEAL_DONE' },
    ]);
    expect(lost.phase).toBe('defeat');
    expect(buildResult(lost, cfg2).details.styleTag).toBeUndefined();
  });

  it('styleTag: vzlomshchik и grubaya-sila', () => {
    const cfg = config({ locks: [lock({ answer: 'а' })] });
    let state = run(cfg, [{ type: 'START' }, { type: 'SUBMIT', value: 'мимо' }, { type: 'CHECK_DONE' }]);
    state = solve(cfg, run(cfg, [{ type: 'REVEAL_DONE' }], state));
    expect(state.mistakes).toBe(1);
    expect(buildResult(state, cfg).details.styleTag).toBe('vzlomshchik');

    const many = { ...state, mistakes: 2 };
    expect(buildResult(many, cfg).details.styleTag).toBe('grubaya-sila');
  });
});

describe('normalizeConfig', () => {
  it('подставляет дефолты и чинит мусор', () => {
    const cfg = normalizeConfig({
      locks: [{ question: 'q', widget: 'нет-такого', answer: 'а', points: -5 }, null],
    });
    expect(cfg.title).toBe('СЕЙФ');
    expect(cfg.errorPenalty).toBe(10);
    expect(cfg.locks[0]).toMatchObject({ widget: 'mega-slider', points: 0, params: {} });
    expect(cfg.locks[1]).toMatchObject({ widget: 'mega-slider', points: 50 });
    expect(normalizeConfig(null).locks).toEqual([]);
  });
});

describe('генераторы содержимого виджетов', () => {
  it('generateDecoys для числа даёт соседние числа без самого ответа', () => {
    const decoys = generateDecoys('4471', 6);
    expect(decoys).toHaveLength(6);
    expect(decoys).not.toContain('4471');
    expect(decoys).toContain('4470');
    expect(decoys).toContain('4472');
    expect(new Set(decoys).size).toBe(6);
  });

  it('generateDecoys не уходит в отрицательные числа', () => {
    const decoys = generateDecoys('1', 20);
    expect(decoys).toHaveLength(20);
    expect(decoys.every((d) => Number(d) >= 0)).toBe(true);
  });

  it('generateDecoys для текста: уникальные, не равны ответу, нужного количества', () => {
    const decoys = generateDecoys('два', 300);
    expect(decoys).toHaveLength(300);
    expect(new Set(decoys.map(normalize)).size).toBe(300);
    expect(decoys.some((d) => compareAnswer(d, 'два'))).toBe(false);
  });

  it('dedupe и shuffle сохраняют состав', () => {
    expect(dedupe(['а', 'б', 'а'])).toEqual(['а', 'б']);
    const items = ['а', 'б', 'в', 'г'];
    expect(shuffle(items).sort()).toEqual(items.slice().sort());
    expect(shuffle(items, () => 0)).toHaveLength(4);
  });

  it('normalizePattern дополняет нулями и обрезает до gridSize²', () => {
    expect(normalizePattern('11', 2)).toBe('1100');
    expect(normalizePattern('1'.repeat(10), 2)).toBe('1111');
    expect(normalizePattern('1x0', 2)).toBe('1000');
    expect(normalizePattern('', 6)).toHaveLength(36);
  });
});

describe('number-as-words', () => {
  it('numberToWords покрывает крайние случаи', () => {
    expect(numberToWords(0)).toBe('ноль');
    expect(numberToWords(12)).toBe('двенадцать');
    expect(numberToWords(203)).toBe('двести три');
    expect(numberToWords(999)).toBe('девятьсот девяносто девять');
  });

  it('барабаны позволяют набрать любое число 0…999', () => {
    const reels = buildWordReels(3, 999);
    expect(reels).toHaveLength(3);
    expect(reels.every((reel) => reel[0] === EMPTY_SLOT)).toBe(true);

    const combos = new Set<string>();
    for (const h of reels[0]!) {
      for (const t of reels[1]!) {
        for (const u of reels[2]!) combos.add(composeWords([h, t, u]));
      }
    }
    for (let n = 0; n <= 999; n++) {
      expect(combos.has(numberToWords(n)), `не набрать ${n} (${numberToWords(n)})`).toBe(true);
    }
  });

  it('maxNumber режет барабаны, slots оставляет младшие разряды', () => {
    const reels = buildWordReels(2, 99);
    expect(reels).toHaveLength(2);
    expect(reels[0]).toContain('девяносто');
    expect(reels[0]).not.toContain('сто');
    expect(buildWordReels(3, 20)[0]).toEqual([EMPTY_SLOT]);
  });

  it('composeWords склеивает непустые фрагменты', () => {
    expect(composeWords(['двести', EMPTY_SLOT, 'три'])).toBe('двести три');
    expect(composeWords([EMPTY_SLOT, EMPTY_SLOT, EMPTY_SLOT])).toBe('');
  });
});
