import { describe, expect, it } from 'vitest';
import schema from '../schema.json';
import games from '../../../content/games.json' with { type: 'json' };
import {
  cancelHold,
  currentOrder,
  endCook,
  endPour,
  initialState,
  normalize,
  pickIngredient,
  progress,
  resolveOrderDone,
  resolveSpoiled,
  resolveWipe,
  startCook,
  startPour,
  styleTagFor,
  tickHold,
  type Config,
  type State,
} from './engine.js';

// The shipped defaults are the test fixture: broken content fails the suite.
const props = schema.properties as unknown as Record<string, { default?: unknown }>;
const RAW = Object.fromEntries(
  Object.entries(props)
    .filter(([, v]) => v.default !== undefined)
    .map(([k, v]) => [k, v.default]),
);

const { cfg, ingredients, error } = normalize(RAW);

/** ms of holding needed to reach `units` on the dose scale */
const pourMs = (units: number): number => (units / cfg.fillRatePerSec) * 1000;

function playOrder(s: State, c: Config, clock: { t: number }): State {
  const order = currentOrder(s, c)!;
  for (const step of order.steps) {
    if (step.amount === 0) {
      s = pickIngredient(s, c, step.ingredientId);
    } else {
      s = startPour(s, c, step.ingredientId, clock.t);
      clock.t += pourMs(step.amount);
      s = endPour(s, c, clock.t);
    }
    clock.t += 100;
  }
  s = startCook(s, c, clock.t);
  clock.t += order.cookSeconds * 1000;
  s = endCook(s, c, clock.t);
  clock.t += 600;
  return s;
}

describe('config', () => {
  it('default content from the spec is valid and playable', () => {
    expect(error).toBeNull();
    expect(ingredients).toHaveLength(8);
    expect(cfg.orders).toHaveLength(3);
    expect(cfg.orders.map((o) => o.steps.length)).toEqual([3, 4, 4]);
    expect(cfg.fillRatePerSec).toBe(1.5);
    expect(cfg.doseTolerancePct).toBe(40);
    expect(cfg.cookTolerancePct).toBe(12);
    expect(cfg.failsAllowed).toBe(3);
  });

  it('a step pointing at a missing ingredient is a config error', () => {
    const broken = normalize({
      ...RAW,
      characters: [{ name: 'Вера', orderName: 'Какао', cookSeconds: 6, steps: [{ ingredientId: 'ghost', amount: 1 }] }],
    });
    expect(broken.error).toContain('ghost');
  });

  it('an empty queue is a config error', () => {
    expect(normalize({ ...RAW, characters: [] }).error).toBe('КОНФИГ ПУСТ: НЕТ ЗАКАЗОВ');
  });
});

describe('simple step (amount = 0)', () => {
  const s0 = { ...initialState(), orderIndex: 1 }; // Макс: уголёк, пыль ×2, мёд ×4, мята

  it('right ingredient advances the step and scores', () => {
    const s = pickIngredient(s0, cfg, 'dragon-coal');
    expect(s.phase).toBe('idle');
    expect(s.stepIndex).toBe(1);
    expect(s.score).toBe(10);
    expect(s.fails).toBe(0);
  });

  it('wrong ingredient spoils the dish', () => {
    const s = pickIngredient(s0, cfg, 'sugar');
    expect(s.phase).toBe('spoiled');
    expect(s.fails).toBe(1);
    expect(s.stepIndex).toBe(0);
  });

  it('out of order: an ingredient from a later step is a mistake', () => {
    const s = pickIngredient(s0, cfg, 'moon-mint'); // step 4, current is step 1
    expect(s.phase).toBe('spoiled');
    expect(s.fails).toBe(1);
  });

  it('a dose ingredient clicked instead of held is a mistake', () => {
    const s = pickIngredient({ ...s0, stepIndex: 1 }, cfg, 'stardust'); // amount = 2
    expect(s.phase).toBe('spoiled');
  });
});

describe('dosing', () => {
  const s0 = initialState(); // Вера: молоко ×3, сахар ×2, корица ×1
  const tol = cfg.doseTolerancePct / 100; // 0.4 units

  it('released exactly on the amount', () => {
    const s = endPour(startPour(s0, cfg, 'hero-milk', 0), cfg, pourMs(3));
    expect(s.phase).toBe('idle');
    expect(s.stepIndex).toBe(1);
    expect(s.score).toBe(10);
  });

  it('both tolerance boundaries count as a hit', () => {
    for (const value of [3 - tol, 3 + tol]) {
      const s = endPour(startPour(s0, cfg, 'hero-milk', 0), cfg, pourMs(value));
      expect(s.phase, `value ${value}`).toBe('idle');
      expect(s.stepIndex).toBe(1);
    }
  });

  it('a hair under the lower bound is a mistake', () => {
    const s = endPour(startPour(s0, cfg, 'hero-milk', 0), cfg, pourMs(3 - tol - 0.01));
    expect(s.phase).toBe('spoiled');
    expect(s.fails).toBe(1);
    expect(s.stepIndex).toBe(0);
  });

  it('a hair over the upper bound is a mistake', () => {
    const s = endPour(startPour(s0, cfg, 'hero-milk', 0), cfg, pourMs(3 + tol + 0.01));
    expect(s.phase).toBe('spoiled');
  });

  it('overflow is caught inside the rAF frame, without a release', () => {
    const pouring = startPour(s0, cfg, 'hero-milk', 0);
    expect(tickHold(pouring, cfg, pourMs(3), pourMs(3) - 16).phase).toBe('pouring');
    const s = tickHold(pouring, cfg, pourMs(3 + tol + 0.5), pourMs(3 + tol + 0.5) - 16);
    expect(s.phase).toBe('spoiled');
    expect(s.fails).toBe(1);
    // the release afterwards is ignored
    expect(endPour(s, cfg, pourMs(9)).phase).toBe('spoiled');
  });

  it('starting a pour with the wrong ingredient fails immediately', () => {
    const s = startPour(s0, cfg, 'sugar', 0);
    expect(s.phase).toBe('spoiled');
    expect(s.holdStartedAt).toBeNull();
  });

  it('a second pointerdown while holding is ignored', () => {
    const pouring = startPour(s0, cfg, 'hero-milk', 0);
    expect(startPour(pouring, cfg, 'sugar', 100)).toBe(pouring);
    expect(startCook(pouring, cfg, 100)).toBe(pouring);
  });
});

describe('cooking', () => {
  const cooked = (s: State, seconds: number): State => endCook(startCook(s, cfg, 0), cfg, seconds * 1000);
  const ready = { ...initialState(), stepIndex: 3, score: 30, orderScore: 30 }; // Вера, all 3 steps done

  it('released inside the amber sector hands over the order', () => {
    const s = cooked(ready, 6);
    expect(s.phase).toBe('orderDone');
    expect(s.orderIndex).toBe(1);
    expect(s.stepIndex).toBe(0);
    expect(s.score).toBe(30 + cfg.pointsPerOrder);
    expect(s.orderScore).toBe(0);
    expect(resolveOrderDone(s).phase).toBe('idle');
  });

  it('undercooked and overcooked both spoil the dish', () => {
    expect(cooked(ready, 6 * 0.88 - 0.05).phase).toBe('spoiled');
    expect(cooked(ready, 6 * 1.12 + 0.05).phase).toBe('spoiled');
    expect(cooked(ready, 6 * 0.88).phase).toBe('orderDone'); // boundary is a hit
    expect(cooked(ready, 6 * 1.12).phase).toBe('orderDone');
  });

  it('overcooking is caught inside the rAF frame', () => {
    const cooking = startCook(ready, cfg, 0);
    const t = 6 * 1.12 * 1000 + 200;
    expect(tickHold(cooking, cfg, t, t - 16).phase).toBe('spoiled');
  });

  it('cooking before all ingredients are in is a mistake', () => {
    const s = startCook(initialState(), cfg, 0);
    expect(s.phase).toBe('spoiled');
    expect(s.fails).toBe(1);
  });

  it('an order with no steps is cook-only and starts immediately', () => {
    const one = normalize({
      ...RAW,
      characters: [{ name: 'Вера', orderName: 'Кипяток', cookSeconds: 4, steps: [] }],
    });
    const s = endCook(startCook(initialState(), one.cfg, 0), one.cfg, 4000);
    expect(s.phase).toBe('finished');
    expect(s.score).toBe(one.cfg.pointsPerOrder);
    // ...and the shelf is dead from the start
    expect(pickIngredient(initialState(), one.cfg, 'sugar').phase).toBe('spoiled');
  });
});

describe('penalty', () => {
  it('takes back the current order points only, keeping delivered orders', () => {
    const clock = { t: 0 };
    let s = resolveOrderDone(playOrder(initialState(), cfg, clock)); // order 1 delivered: 80
    expect(s.score).toBe(80);
    s = pickIngredient(s, cfg, 'dragon-coal'); // order 2, step 1 → 90
    expect(s.score).toBe(90);
    s = pickIngredient(s, cfg, 'iron-bolt'); // wrong
    expect(s.phase).toBe('spoiled');
    expect(s.score).toBe(80); // step points of order 2 revoked
    expect(s.orderScore).toBe(0);
    expect(s.stepIndex).toBe(0);
    expect(s.orderIndex).toBe(1); // same character, same dish
    expect(resolveSpoiled(s).phase).toBe('idle');
  });
});

describe('wipe', () => {
  it('the third mistake burns the shift, resolveWipe restarts it', () => {
    let s = initialState();
    for (let i = 0; i < 2; i++) {
      s = resolveSpoiled(pickIngredient(s, cfg, 'iron-bolt'));
      expect(s.phase).toBe('idle');
    }
    expect(s.fails).toBe(2);
    expect(s.wipes).toBe(0);

    s = pickIngredient(s, cfg, 'iron-bolt');
    expect(s.phase).toBe('wiped');
    expect(s.fails).toBe(3);
    expect(s.wipes).toBe(1);

    s = resolveWipe(s);
    expect(s).toEqual({ ...initialState(), wipes: 1 });
    expect(styleTagFor(s)).toBe('scorched');
  });
});

describe('cancel', () => {
  it('cancelHold mid-pour costs nothing', () => {
    const pouring = startPour(initialState(), cfg, 'hero-milk', 0);
    const s = cancelHold(pouring);
    expect(s.phase).toBe('idle');
    expect(s.fails).toBe(0);
    expect(s.stepIndex).toBe(0);
    expect(s.holdValue).toBe(0);
    expect(s.score).toBe(0);
  });

  it('a frame gap over 500 ms cancels instead of failing', () => {
    const cooking = startCook({ ...initialState(), stepIndex: 3 }, cfg, 0);
    const s = tickHold(cooking, cfg, 20000, 19000); // slept through the whole cook window
    expect(s.phase).toBe('idle');
    expect(s.fails).toBe(0);
    expect(s.stepIndex).toBe(3); // step stays current
  });
});

describe('win', () => {
  it('a clean run through all three orders finishes with the full score', () => {
    const clock = { t: 0 };
    let s = initialState();
    for (let i = 0; i < cfg.orders.length; i++) s = resolveOrderDone(playOrder(s, cfg, clock));
    expect(s.phase).toBe('finished');
    expect(s.orderIndex).toBe(3);
    expect(s.fails).toBe(0);
    expect(s.score).toBe(11 * cfg.pointsPerStep + 3 * cfg.pointsPerOrder); // 260
    expect(styleTagFor(s)).toBe('flawless');
    expect(progress(s, cfg).percent).toBe(100);
  });

  it('progress counts every ingredient step plus one cook step per order', () => {
    expect(progress(initialState(), cfg)).toEqual({ text: 'ЗАКАЗ 1/3 · ШАГ 1/4', percent: 0 });
    expect(progress({ ...initialState(), stepIndex: 3 }, cfg).percent).toBe(Math.round((3 / 14) * 100));
    expect(progress({ ...initialState(), orderIndex: 1 }, cfg).text).toBe('ЗАКАЗ 2/3 · ШАГ 1/5');
  });
});

// Контентный сторож: очередь наверху — это карточки-досье, и заказчик без
// портрета вырождается в безликий плейсхолдер с одной буквой.
describe('content: у заказчиков «Кухни для героев» есть лица', () => {
  const game = games.find((g) => g.minigame_id === 'cooking-orders');
  const { cfg, error } = normalize(game?.config_json);

  it('уровень вообще собирается', () => {
    expect(error).toBeNull();
    expect(cfg.orders.length).toBeGreaterThan(0);
  });

  it.each(cfg.orders.map((o) => [o.name, o.orderName, o.portrait] as const))(
    '%s · %s — портрет задан',
    (_name, _dish, portrait) => {
      expect(portrait).not.toBe('');
    },
  );
});
