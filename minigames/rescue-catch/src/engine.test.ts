import { describe, it, expect } from 'vitest';
import {
  applyInput,
  createState,
  landingIn,
  multiplierOf,
  progressText,
  reachable,
  spawnInterval,
  stepsBetween,
  trySpawn,
  update,
  type ControlVariant,
  type EngineConfig,
  type GameState,
} from './engine';

const DT = 1 / 64; // exactly representable — no float drift in accumulated time

function mk(cfg: Partial<EngineConfig> = {}, seed = 1): GameState {
  // Spawning is disabled by default so scenarios stay hand-controlled.
  return { ...createState(cfg, seed), nextSpawnIn: 1e6 };
}

function run(s: GameState, seconds: number, dt = DT): GameState {
  const frames = Math.round(seconds / dt);
  for (let i = 0; i < frames; i++) s = update(s, dt);
  return s;
}

function withVictim(
  s: GameState,
  target: number,
  phase: 'telegraph' | 'falling' = 'telegraph',
  t = 0,
): GameState {
  return {
    ...s,
    victims: [...s.victims, { id: s.nextVictimId, target, window: 0, phase, t }],
    nextVictimId: s.nextVictimId + 1,
  };
}

/** Drop one victim on `target`; returns the state of the landing frame. */
function land(s: GameState, target: number): GameState {
  let st = withVictim(s, target);
  for (let i = 0; i < 10000; i++) {
    st = update(st, DT);
    if (st.events.some((e) => e.type === 'catch' || e.type === 'miss')) return st;
  }
  throw new Error('victim never landed');
}

const types = (s: GameState): string[] => s.events.map((e) => e.type);

// ---------------------------------------------------------------------------
// Common mechanics
// ---------------------------------------------------------------------------

describe('catch / miss', () => {
  it('catches a victim landing on the rescuer point', () => {
    const s = land(mk({ rescueTarget: 50 }), 0); // position starts at 0
    expect(s.rescued).toBe(1);
    expect(s.missed).toBe(0);
    expect(s.streak).toBe(1);
    expect(s.score).toBe(100);
    expect(s.lives).toBe(3);
    expect(s.victims).toHaveLength(0);
  });

  it('misses a victim landing elsewhere: life lost, streak reset, score kept', () => {
    let s = land(mk({ rescueTarget: 50 }), 0);
    s = land(s, 3);
    expect(s.rescued).toBe(1);
    expect(s.missed).toBe(1);
    expect(s.lives).toBe(2);
    expect(s.streak).toBe(0);
    expect(s.score).toBe(100);
  });

  it('the landing frame emits exactly one catch/miss event', () => {
    const s = land(mk({ rescueTarget: 50 }), 0);
    expect(types(s)).toEqual(['catch']);
  });
});

describe('streak multiplier', () => {
  it('follows 1 + floor(streak / streakStep) and honours the cap', () => {
    const cfg = { streakStep: 3, maxMultiplier: 4 } as Partial<EngineConfig>;
    const c = createState(cfg, 1).cfg;
    expect([0, 1, 2].map((n) => multiplierOf(n, c))).toEqual([1, 1, 1]);
    expect([3, 5].map((n) => multiplierOf(n, c))).toEqual([2, 2]);
    expect([6, 9, 30].map((n) => multiplierOf(n, c))).toEqual([3, 4, 4]);
  });

  it('scores 3/6/9 in a row with x2/x3/x4', () => {
    let s = mk({ rescueTarget: 50 });
    for (let i = 0; i < 9; i++) s = land(s, 0);
    // 2x100 (x1) + 3x200 (x2)... -> catches 1-2 x1, 3-5 x2, 6-8 x3, 9 x4
    expect(s.score).toBe(2 * 100 + 3 * 200 + 3 * 300 + 400);
    expect(s.bestStreak).toBe(9);
  });

  it('one miss at streak 8 drops the multiplier back to x1', () => {
    let s = mk({ rescueTarget: 50 });
    for (let i = 0; i < 8; i++) s = land(s, 0);
    expect(multiplierOf(s.streak, s.cfg)).toBe(3);
    s = land(s, 2);
    expect(s.streak).toBe(0);
    expect(multiplierOf(s.streak, s.cfg)).toBe(1);
    const before = s.score;
    s = land(s, 0);
    expect(s.score - before).toBe(100);
  });
});

describe('terminal states', () => {
  it('wins at rescueTarget and freezes', () => {
    let s = mk({ rescueTarget: 2 });
    s = land(s, 0);
    expect(s.status).toBe('running');
    s = land(s, 0);
    expect(s.status).toBe('won');
    expect(types(s)).toContain('win');
    const frozen = run(s, 5);
    expect(frozen.status).toBe('won');
    expect(frozen.rescued).toBe(2);
  });

  it('loses when lives hit zero and freezes', () => {
    let s = mk({ rescueTarget: 50, lives: 2 });
    s = land(s, 1);
    expect(s.status).toBe('running');
    s = land(s, 1);
    expect(s.status).toBe('lost');
    expect(s.lives).toBe(0);
    expect(types(s)).toContain('lose');
    expect(run(s, 5).status).toBe('lost');
  });

  it('input is ignored after the round is over', () => {
    let s = mk({ rescueTarget: 1 });
    s = land(s, 0);
    const after = applyInput(s, { type: 'point', index: 1 }, s.now);
    expect(after.position).toBe(s.position);
    expect(after.events).toHaveLength(0);
  });

  it('nothing spawns on the frame the round ends, nor after it', () => {
    // victim lands and the spawn timer expires on the very same frame
    let s = mk({ rescueTarget: 1 });
    s = withVictim(s, 0, 'falling', s.cfg.fallTime - DT / 2);
    s = update({ ...s, nextSpawnIn: DT / 2 }, DT);
    expect(s.status).toBe('won');
    expect(s.nextVictimId).toBe(2); // no extra victim was born
    expect(run({ ...s, nextSpawnIn: 0 }, 3).nextVictimId).toBe(2);
  });
});

describe('spawn', () => {
  it('never exceeds maxAirborne', () => {
    let s = createState({ maxAirborne: 2, spawnIntervalStart: 0.5, spawnIntervalMin: 0.5 }, 7);
    for (let i = 0; i < 2000; i++) {
      s = update(s, DT);
      expect(s.victims.length).toBeLessThanOrEqual(2);
      if (s.status !== 'running') break;
    }
  });

  it('never targets a point that is already targeted', () => {
    for (let seed = 1; seed <= 20; seed++) {
      let s = createState({ maxAirborne: 4, spawnIntervalStart: 0.4, spawnIntervalMin: 0.4 }, seed);
      for (let i = 0; i < 1500 && s.status === 'running'; i++) {
        s = update(s, DT);
        const targets = s.victims.map((v) => v.target);
        expect(new Set(targets).size).toBe(targets.length);
      }
    }
  });

  it('refuses to spawn when every point is taken', () => {
    let s = mk({ maxAirborne: 4, controlVariant: 'inverted' });
    for (let i = 0; i < 6; i++) s = withVictim(s, i);
    const after = trySpawn({ ...s, cfg: { ...s.cfg, maxAirborne: 10 } });
    expect(after.victims).toHaveLength(6);
    expect(after.nextSpawnIn).toBeCloseTo(0.2);
  });

  it('accelerates linearly with rescue progress', () => {
    const s = mk({ spawnIntervalStart: 2.5, spawnIntervalMin: 0.9, rescueTarget: 20 });
    expect(spawnInterval(s)).toBeCloseTo(2.5);
    expect(spawnInterval({ ...s, rescued: 10 })).toBeCloseTo(1.7);
    expect(spawnInterval({ ...s, rescued: 20 })).toBeCloseTo(0.9);
    expect(spawnInterval({ ...s, rescued: 30 })).toBeCloseTo(0.9); // clamped
    let prev = Infinity;
    for (let r = 0; r <= 20; r++) {
      const v = spawnInterval({ ...s, rescued: r });
      expect(v).toBeLessThan(prev);
      prev = v;
    }
  });

  it('arms the next spawn with the accelerated interval', () => {
    const s = { ...mk({ controlVariant: 'inverted' }), rescued: 10 };
    expect(trySpawn(s).nextSpawnIn).toBeCloseTo(1.7);
  });
});

describe('progressText', () => {
  it('renders the panel line and a 0..100 percent', () => {
    const s = mk({ rescueTarget: 20, lives: 3 });
    expect(progressText(s)).toEqual({
      text: 'СПАСЕНО 0/20 · ЖИЗНИ ●●● · СЕРИЯ ×1 · 0',
      percent: 0,
    });
    const mid = { ...s, rescued: 5, lives: 2, streak: 3, score: 900 };
    expect(progressText(mid)).toEqual({
      text: 'СПАСЕНО 5/20 · ЖИЗНИ ●●○ · СЕРИЯ ×2 · 900',
      percent: 25,
    });
    expect(progressText({ ...s, rescued: 20 }).percent).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// inverted
// ---------------------------------------------------------------------------

describe('control: inverted', () => {
  const cfg: Partial<EngineConfig> = { controlVariant: 'inverted' };

  it('arrows step one point, sign flipped while inverted', () => {
    const s = mk(cfg);
    expect(applyInput(s, { type: 'arrow', dir: 1 }, 0).position).toBe(1);
    expect(applyInput({ ...s, position: 3 }, { type: 'arrow', dir: -1 }, 0).position).toBe(2);
    const inv = { ...s, inverted: true, position: 3 };
    expect(applyInput(inv, { type: 'arrow', dir: 1 }, 0).position).toBe(2);
    expect(applyInput(inv, { type: 'arrow', dir: -1 }, 0).position).toBe(4);
  });

  it('the ring is closed', () => {
    const s = mk(cfg);
    expect(applyInput({ ...s, position: 5 }, { type: 'arrow', dir: 1 }, 0).position).toBe(0);
    expect(applyInput({ ...s, position: 0 }, { type: 'arrow', dir: -1 }, 0).position).toBe(5);
  });

  it('a point key steps one point towards that point', () => {
    const s = mk(cfg);
    const near = applyInput(s, { type: 'point', index: 2 }, 0); // +2 around -> +1
    expect(near.position).toBe(1);
    expect(types(near)).toEqual(['step']);
    const far = applyInput(s, { type: 'point', index: 4 }, 0); // -2 around -> -1
    expect(far.position).toBe(5);
    // own point: nothing happens, no deny
    const same = applyInput(s, { type: 'point', index: 0 }, 0);
    expect(same.position).toBe(0);
    expect(same.events).toHaveLength(0);
  });

  it('a point key obeys the inversion too', () => {
    const s = { ...mk(cfg), inverted: true };
    expect(applyInput(s, { type: 'point', index: 2 }, 0).position).toBe(5); // away from it
    expect(applyInput(s, { type: 'point', index: 4 }, 0).position).toBe(1);
  });

  it('flips exactly every inversionInterval', () => {
    const s = mk({ ...cfg, inversionInterval: 5 });
    expect(run(s, 4.9).inverted).toBe(false);
    expect(run(s, 5.1).inverted).toBe(true);
    expect(run(s, 10.1).inverted).toBe(false);
  });

  it('warns once per cycle, inversionWarnTime ahead', () => {
    let s = mk({ ...cfg, inversionInterval: 5, inversionWarnTime: 1 });
    let warns = 0;
    let firstWarnAt = 0;
    for (let i = 0; i < Math.round(11 / DT); i++) {
      s = update(s, DT);
      if (types(s).includes('inversionWarn')) {
        warns += 1;
        if (warns === 1) firstWarnAt = s.now;
      }
    }
    expect(warns).toBe(2); // two switches in 11 s
    expect(firstWarnAt).toBeGreaterThanOrEqual(4);
    expect(firstWarnAt).toBeLessThan(4 + 2 * DT);
  });

  it('uses the flag as of the keydown, not as of the next frame', () => {
    let s = mk({ ...cfg, inversionInterval: 5 });
    s = run(s, 4.9);
    expect(s.inverted).toBe(false);
    const before = applyInput(s, { type: 'arrow', dir: 1 }, s.now);
    expect(before.position).toBe(1); // +1: flag was still false at press time
    const flipped = run(before, 0.2);
    expect(flipped.inverted).toBe(true);
    expect(applyInput(flipped, { type: 'arrow', dir: 1 }, flipped.now).position).toBe(0); // -1
  });
});

// ---------------------------------------------------------------------------
// clockwise
// ---------------------------------------------------------------------------

describe('control: clockwise', () => {
  const cfg: Partial<EngineConfig> = { controlVariant: 'clockwise', stepDelay: 0.25 };

  it('steps onto the next clockwise point and wraps 5 -> 0', () => {
    const s = mk(cfg);
    const one = applyInput(s, { type: 'point', index: 1 }, 0);
    expect(one.position).toBe(1);
    expect(types(one)).toEqual(['step']);
    const wrap = applyInput({ ...s, position: 5 }, { type: 'point', index: 0 }, 0);
    expect(wrap.position).toBe(0);
  });

  it('denies every other point, including the current one', () => {
    const s = mk(cfg);
    for (const index of [0, 2, 3, 4, 5]) {
      const after = applyInput(s, { type: 'point', index }, 0);
      expect(after.position).toBe(0);
      expect(types(after)).toEqual(['deny']);
    }
  });

  it('ignores presses inside the cooldown silently (no deny)', () => {
    const s = applyInput(mk(cfg), { type: 'point', index: 1 }, 0);
    expect(s.nextStepAt).toBeCloseTo(0.25);
    const early = applyInput(s, { type: 'point', index: 2 }, 0.1);
    expect(early.position).toBe(1);
    expect(early.events).toHaveLength(0);
    const earlyWrong = applyInput(s, { type: 'point', index: 5 }, 0.1);
    expect(earlyWrong.events).toHaveLength(0);
    const late = applyInput(s, { type: 'point', index: 2 }, 0.25);
    expect(late.position).toBe(2);
  });

  it('reachable() rejects targets too far around the ring', () => {
    // window = 1.3 s, one step = 0.6 s -> at most 2 steps
    const s = mk({ ...cfg, stepDelay: 0.6, hangTime: 0.5, fallTime: 0.8 });
    expect(stepsBetween(s, 0, 5)).toBe(5);
    expect(reachable(s, 2)).toBe(true);
    expect(reachable(s, 3)).toBe(false);
    expect(reachable(s, 5)).toBe(false);
  });

  it('reachable() shrinks the budget while somebody is already airborne', () => {
    const base = mk({ ...cfg, stepDelay: 0.25, hangTime: 1, fallTime: 1.8 });
    // one victim just spawned on point 2: budget is 0, only its own point is
    // "reachable" (and that one is filtered out by the same-point rule)
    const fresh = withVictim(base, 2);
    expect(reachable(fresh, 3)).toBe(false);
    // ... the same victim 1.5 s later leaves a 1.5 s budget: 6 steps max
    const later = run(fresh, 1.5);
    expect(landingIn(later.victims[0]!, later.cfg)).toBeLessThan(1.4);
    expect(reachable(later, 5)).toBe(true); // 3 steps from point 2
  });

  it('only ever spawns reachable targets under a tight config', () => {
    const tight: Partial<EngineConfig> = {
      ...cfg,
      stepDelay: 0.6,
      hangTime: 0.5,
      fallTime: 0.8,
      maxAirborne: 1,
      spawnIntervalStart: 1.5,
      spawnIntervalMin: 1.5,
    };
    for (let seed = 1; seed <= 10; seed++) {
      let s = createState(tight, seed);
      let seen = 0;
      for (let i = 0; i < 1500 && s.status === 'running'; i++) {
        const before = s;
        s = update(s, DT);
        if (s.victims.length > before.victims.length) {
          const v = s.victims[s.victims.length - 1]!;
          expect(stepsBetween(before, before.position, v.target)).toBeLessThanOrEqual(2);
          seen += 1;
        }
      }
      expect(seen).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// bidirectional
// ---------------------------------------------------------------------------

describe('control: bidirectional', () => {
  const cfg: Partial<EngineConfig> = { controlVariant: 'bidirectional', stepDelay: 0.25 };

  it('steps onto either neighbour and wraps both ways', () => {
    const s = mk(cfg);
    const cw = applyInput(s, { type: 'point', index: 1 }, 0);
    expect(cw.position).toBe(1);
    expect(types(cw)).toEqual(['step']);
    const ccw = applyInput(s, { type: 'point', index: 5 }, 0);
    expect(ccw.position).toBe(5);
    expect(types(ccw)).toEqual(['step']);
  });

  it('accepts arrows as well', () => {
    const s = mk(cfg);
    expect(applyInput(s, { type: 'arrow', dir: 1 }, 0).position).toBe(1);
    expect(applyInput(s, { type: 'arrow', dir: -1 }, 0).position).toBe(5);
  });

  it('denies non-adjacent points, including the current one', () => {
    const s = mk(cfg);
    for (const index of [0, 2, 3, 4]) {
      const after = applyInput(s, { type: 'point', index }, 0);
      expect(after.position).toBe(0);
      expect(types(after)).toEqual(['deny']);
    }
  });

  it('respects the stepDelay cooldown, silently', () => {
    const s = applyInput(mk(cfg), { type: 'point', index: 1 }, 0);
    expect(s.nextStepAt).toBeCloseTo(0.25);
    const early = applyInput(s, { type: 'point', index: 0 }, 0.1);
    expect(early.position).toBe(1);
    expect(early.events).toHaveLength(0);
    const earlyArrow = applyInput(s, { type: 'arrow', dir: 1 }, 0.1);
    expect(earlyArrow.position).toBe(1);
    expect(earlyArrow.events).toHaveLength(0);
    const late = applyInput(s, { type: 'point', index: 0 }, 0.25);
    expect(late.position).toBe(0);
  });

  it('stepsBetween uses the shortest arc, and reachable() follows it', () => {
    const s = mk({ ...cfg, stepDelay: 0.6, hangTime: 0.5, fallTime: 0.8 }); // budget 1.3 s -> 2 steps
    expect(stepsBetween(s, 0, 5)).toBe(1); // 5 the clockwise way, 1 the other
    expect(stepsBetween(s, 0, 3)).toBe(3);
    expect(reachable(s, 5)).toBe(true); // unreachable in clockwise, one step here
    expect(reachable(s, 2)).toBe(true);
    expect(reachable(s, 3)).toBe(false); // 3 steps = 1.8 > 1.3
  });
});

// ---------------------------------------------------------------------------
// stepwise
// ---------------------------------------------------------------------------

describe('control: stepwise', () => {
  const cfg: Partial<EngineConfig> = { controlVariant: 'stepwise', stepDelay: 0.25 };

  it('has a 5 point arc and starts in the middle', () => {
    const s = mk(cfg);
    expect(s.points).toBe(5);
    expect(s.position).toBe(2);
  });

  it('does not teleport: the key only sets a target', () => {
    const s = applyInput(mk(cfg), { type: 'point', index: 0 }, 0);
    expect(s.position).toBe(2);
    expect(s.targetIndex).toBe(0);
    expect(s.events).toHaveLength(0);
  });

  it('walks one point per stepDelay', () => {
    let s = applyInput(mk(cfg), { type: 'point', index: 0 }, 0);
    s = run(s, 0.24);
    expect(s.position).toBe(2);
    s = run(s, 0.02); // ~0.26 s total
    expect(s.position).toBe(1);
    s = run(s, 0.25);
    expect(s.position).toBe(0);
    expect(s.targetIndex).toBe(0);
  });

  it('the arc is open: 0 -> 4 takes four steps, not one wrap', () => {
    let s = applyInput({ ...mk(cfg), position: 0, targetIndex: 0 }, { type: 'point', index: 4 }, 0);
    s = run(s, 3 * 0.25 + 0.01);
    expect(s.position).toBe(3);
    s = run(s, 0.25);
    expect(s.position).toBe(4);
  });

  it('retargeting mid-walk turns around without resetting the step timer', () => {
    let s = applyInput({ ...mk(cfg), position: 0, targetIndex: 0 }, { type: 'point', index: 4 }, 0);
    s = run(s, 0.26);
    expect(s.position).toBe(1);
    const armed = s.nextStepAt;
    s = applyInput(s, { type: 'point', index: 0 }, s.now);
    expect(s.nextStepAt).toBe(armed);
    expect(s.targetIndex).toBe(0);
    s = run(s, 0.25);
    expect(s.position).toBe(0);
  });

  it('pressing the current point cancels the walk without a deny', () => {
    let s = applyInput({ ...mk(cfg), position: 0, targetIndex: 0 }, { type: 'point', index: 4 }, 0);
    s = run(s, 0.26);
    expect(s.position).toBe(1);
    s = applyInput(s, { type: 'point', index: 1 }, s.now);
    expect(s.targetIndex).toBe(1);
    expect(s.events).toHaveLength(0);
    s = run(s, 1);
    expect(s.position).toBe(1);
  });

  it('a long frame does not swallow steps', () => {
    let s = applyInput({ ...mk(cfg), position: 0, targetIndex: 0 }, { type: 'point', index: 4 }, 0);
    s = update(s, 0.8);
    expect(s.position).toBe(3);
  });

  it('reachable() uses the open-arc distance', () => {
    const s = mk({
      ...cfg,
      stepDelay: 0.6,
      hangTime: 0.5,
      fallTime: 0.8,
      controlVariant: 'stepwise',
    });
    expect(stepsBetween(s, 2, 4)).toBe(2);
    expect(reachable(s, 4)).toBe(true); // 2 steps = 1.2 <= 1.3
    expect(reachable({ ...s, position: 0 }, 4)).toBe(false); // 4 steps = 2.4
  });
});

// ---------------------------------------------------------------------------
// Invariants over seeded runs
// ---------------------------------------------------------------------------

/** Where the player must be next: the point of the earliest landing. */
function goalOf(s: GameState): number | null {
  let best = null as null | { target: number; eta: number };
  for (const v of s.victims) {
    const eta = landingIn(v, s.cfg);
    if (!best || eta < best.eta) best = { target: v.target, eta };
  }
  return best ? best.target : null;
}

/** Plays by the rules of the variant, always heading for the next landing. */
function bot(s: GameState): GameState {
  const goal = goalOf(s);
  if (goal === null || goal === s.position) return s;
  if (s.cfg.controlVariant === 'clockwise') {
    return applyInput(s, { type: 'point', index: (s.position + 1) % s.points }, s.now);
  }
  if (s.cfg.controlVariant === 'stepwise') {
    return s.targetIndex === goal ? s : applyInput(s, { type: 'point', index: goal }, s.now);
  }
  const dir = (goal - s.position + s.points) % s.points <= s.points / 2 ? 1 : -1;
  const arrow = s.inverted ? ((-dir | 0) as -1 | 1) : ((dir | 0) as -1 | 1);
  return applyInput(s, { type: 'arrow', dir: arrow }, s.now);
}

describe('invariants over seeded runs', () => {
  const variants: ControlVariant[] = ['inverted', 'clockwise', 'stepwise'];

  it('keeps position, counters and lives consistent for any seed', () => {
    for (const controlVariant of variants) {
      for (let seed = 1; seed <= 12; seed++) {
        let s = createState({ controlVariant }, seed);
        const startLives = s.cfg.lives;
        for (let i = 0; i < 3000 && s.status === 'running'; i++) {
          // deliberately clumsy player: moves on every 7th frame
          if (i % 7 === 0) s = bot(s);
          s = update(s, DT);
          expect(s.position).toBeGreaterThanOrEqual(0);
          expect(s.position).toBeLessThan(s.points);
          expect(s.rescued + s.missed).toBe(s.nextVictimId - 1 - s.victims.length);
          expect(s.lives + s.missed).toBe(startLives);
        }
      }
    }
  });

  it('a bot playing by the rules never misses (spawn stays solvable)', () => {
    // Budget-generous config: the point is that the spawn filter plus the
    // variant rules always leave a route, not that the route is tight.
    const cfg: Partial<EngineConfig> = {
      spawnIntervalStart: 2.5,
      spawnIntervalMin: 1.6,
      stepDelay: 0.25,
      hangTime: 1,
      fallTime: 1.8,
      maxAirborne: 2,
      rescueTarget: 20,
    };
    for (const controlVariant of ['clockwise', 'stepwise'] as ControlVariant[]) {
      for (let seed = 1; seed <= 25; seed++) {
        let s = createState({ ...cfg, controlVariant }, seed);
        for (let i = 0; i < 6000 && s.status === 'running'; i++) {
          s = update(s, DT);
          s = bot(s);
        }
        expect(`${controlVariant}:${seed}:${s.status}:${s.missed}`).toBe(
          `${controlVariant}:${seed}:won:0`,
        );
      }
    }
  });
});
