/**
 * Pure logic of "rescue-catch" ("Ну, погоди!").
 *
 * No DOM, no timers, no Math.random — only data and functions, so the whole
 * game is testable in node. The renderer (src/index.ts) never takes a game
 * decision: it reads state, draws it and feeds input back in.
 *
 * Coordinates are indices, time is seconds. Where the points live on screen is
 * the renderer's business.
 *
 * Purity contract: `applyInput` / `update` / `trySpawn` do not mutate the state
 * they get; they return a new object whose `events` array holds *only* the
 * events produced by that call (the caller drains it by simply reading it).
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type ControlVariant = 'inverted' | 'stepwise' | 'clockwise' | 'bidirectional';

/** Ring order, clockwise: top row left→right, bottom row right→left. */
export const RING_KEYS = ['Q', 'W', 'E', 'D', 'S', 'A'] as const;
/** Arc order, left→right along the facade. */
export const ARC_KEYS = ['Q', 'A', 'S', 'D', 'E'] as const;

export function keysOf(variant: ControlVariant): readonly string[] {
  return variant === 'stepwise' ? ARC_KEYS : RING_KEYS;
}

export function pointsOf(variant: ControlVariant): number {
  return variant === 'stepwise' ? ARC_KEYS.length : RING_KEYS.length;
}

export interface EngineConfig {
  controlVariant: ControlVariant;
  rescueTarget: number;
  lives: number;
  spawnIntervalStart: number;
  spawnIntervalMin: number;
  fallTime: number;
  hangTime: number;
  maxAirborne: number;
  inversionInterval: number;
  inversionWarnTime: number;
  stepDelay: number;
  pointsPerCatch: number;
  streakStep: number;
  maxMultiplier: number;
}

export const DEFAULTS: EngineConfig = {
  controlVariant: 'clockwise',
  rescueTarget: 20,
  lives: 3,
  spawnIntervalStart: 2.5,
  spawnIntervalMin: 0.9,
  fallTime: 1.8,
  hangTime: 1.0,
  maxAirborne: 2,
  inversionInterval: 5,
  inversionWarnTime: 1.0,
  stepDelay: 0.25,
  pointsPerCatch: 100,
  streakStep: 3,
  maxMultiplier: 4,
};

/** Re-arm delay when a spawn attempt was refused (§1.5). */
export const RETRY_DELAY = 0.2;
/** How many floors of the tower can host a victim (render-only detail). */
export const WINDOW_ROWS = 5;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function numOr(raw: unknown, def: number, lo: number, hi: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? clamp(n, lo, hi) : def;
}

/** Admin config is untrusted input: clamp everything to the schema ranges. */
export function normalizeConfig(raw: Partial<EngineConfig> | undefined): EngineConfig {
  const c = raw ?? {};
  const variant: ControlVariant =
    c.controlVariant === 'inverted' ||
    c.controlVariant === 'stepwise' ||
    c.controlVariant === 'bidirectional'
      ? c.controlVariant
      : 'clockwise';
  return {
    controlVariant: variant,
    rescueTarget: Math.round(numOr(c.rescueTarget, DEFAULTS.rescueTarget, 1, 100)),
    lives: Math.round(numOr(c.lives, DEFAULTS.lives, 1, 10)),
    spawnIntervalStart: numOr(c.spawnIntervalStart, DEFAULTS.spawnIntervalStart, 0.5, 10),
    spawnIntervalMin: numOr(c.spawnIntervalMin, DEFAULTS.spawnIntervalMin, 0.3, 10),
    fallTime: numOr(c.fallTime, DEFAULTS.fallTime, 0.4, 6),
    hangTime: numOr(c.hangTime, DEFAULTS.hangTime, 0.1, 4),
    maxAirborne: Math.round(numOr(c.maxAirborne, DEFAULTS.maxAirborne, 1, 4)),
    inversionInterval: numOr(c.inversionInterval, DEFAULTS.inversionInterval, 1, 30),
    inversionWarnTime: numOr(c.inversionWarnTime, DEFAULTS.inversionWarnTime, 0.2, 3),
    stepDelay: numOr(c.stepDelay, DEFAULTS.stepDelay, 0.05, 1),
    pointsPerCatch: Math.round(numOr(c.pointsPerCatch, DEFAULTS.pointsPerCatch, 1, 10000)),
    streakStep: Math.round(numOr(c.streakStep, DEFAULTS.streakStep, 1, 20)),
    maxMultiplier: Math.round(numOr(c.maxMultiplier, DEFAULTS.maxMultiplier, 1, 10)),
  };
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface Victim {
  id: number;
  /** Index of the catch point this one falls onto. */
  target: number;
  /** Floor of the window it hangs in — renderer only. */
  window: number;
  phase: 'telegraph' | 'falling';
  /** Time spent in the current phase, seconds. */
  t: number;
}

export type GameEventType =
  'catch' | 'miss' | 'deny' | 'step' | 'inversionWarn' | 'inverted' | 'win' | 'lose';

export interface GameEvent {
  type: GameEventType;
  /** Point index the event happened on, where it makes sense. */
  point?: number;
}

/** mulberry32 seed — a plain int32. */
export type RngState = number;

export interface GameState {
  cfg: EngineConfig;
  /** 6 for the ring variants, 5 for the stepwise arc. */
  points: number;
  position: number;
  /** stepwise: where the rescuer is walking to; otherwise === position. */
  targetIndex: number;
  /** stepwise: next auto-step; clockwise: end of the step cooldown. */
  nextStepAt: number;
  inverted: boolean;
  inversionAt: number;
  inversionWarned: boolean;
  victims: Victim[];
  nextVictimId: number;
  nextSpawnIn: number;
  rescued: number;
  missed: number;
  lives: number;
  score: number;
  streak: number;
  bestStreak: number;
  status: 'running' | 'won' | 'lost';
  /** Accumulated game time, seconds. */
  now: number;
  rng: RngState;
  events: GameEvent[];
}

export type InputEvent = { type: 'arrow'; dir: -1 | 1 } | { type: 'point'; index: number };

export function createState(raw: Partial<EngineConfig> | undefined, seed: number): GameState {
  const cfg = normalizeConfig(raw);
  const points = pointsOf(cfg.controlVariant);
  // stepwise starts in the middle of the arc, the ring variants at Q.
  const position = cfg.controlVariant === 'stepwise' ? Math.floor(points / 2) : 0;
  return {
    cfg,
    points,
    position,
    targetIndex: position,
    nextStepAt: 0,
    inverted: false,
    inversionAt: cfg.inversionInterval,
    inversionWarned: false,
    victims: [],
    nextVictimId: 1,
    nextSpawnIn: cfg.spawnIntervalStart,
    rescued: 0,
    missed: 0,
    lives: cfg.lives,
    score: 0,
    streak: 0,
    bestStreak: 0,
    status: 'running',
    now: 0,
    rng: seed | 0,
    events: [],
  };
}

/** Fresh working copy; `events` always starts empty (see purity contract). */
function fork(s: GameState): GameState {
  return { ...s, victims: s.victims.map((v) => ({ ...v })), events: [] };
}

function nextRandom(s: GameState): number {
  s.rng = (s.rng + 0x6d2b79f5) | 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Derived values
// ---------------------------------------------------------------------------

export function multiplierOf(streak: number, cfg: EngineConfig): number {
  return Math.min(cfg.maxMultiplier, 1 + Math.floor(streak / cfg.streakStep));
}

/** Seconds left until this victim touches its point. */
export function landingIn(v: Victim, cfg: EngineConfig): number {
  return v.phase === 'telegraph' ? cfg.hangTime - v.t + cfg.fallTime : cfg.fallTime - v.t;
}

/** Spawn interval at the current rescue progress (§1.5). */
export function spawnInterval(s: GameState): number {
  const p = clamp(s.rescued / s.cfg.rescueTarget, 0, 1);
  return s.cfg.spawnIntervalStart + (s.cfg.spawnIntervalMin - s.cfg.spawnIntervalStart) * p;
}

function earliestVictim(s: GameState): Victim | undefined {
  let best: Victim | undefined;
  for (const v of s.victims) {
    if (!best || landingIn(v, s.cfg) < landingIn(best, s.cfg)) best = v;
  }
  return best;
}

/** Minimum number of steps from `from` to `to` under the variant's rules. */
export function stepsBetween(s: GameState, from: number, to: number): number {
  const d = (to - from + s.points) % s.points;
  if (s.cfg.controlVariant === 'clockwise') return d;
  if (s.cfg.controlVariant === 'bidirectional') return Math.min(d, s.points - d);
  return Math.abs(to - from); // stepwise: open arc, both directions
}

/**
 * Can the player still get to `target` in time (§6.4)? Greedy, one step ahead:
 * if somebody is already airborne the player is assumed to be standing on
 * *their* point when they land, and the time budget shrinks accordingly.
 */
export function reachable(s: GameState, target: number): boolean {
  if (s.cfg.controlVariant === 'inverted') return true; // instant steps, no limit
  const window = s.cfg.hangTime + s.cfg.fallTime;
  const earliest = earliestVictim(s);
  const from = earliest ? earliest.target : s.position;
  const budget = earliest ? window - landingIn(earliest, s.cfg) : window;
  return stepsBetween(s, from, target) * s.cfg.stepDelay <= budget;
}

export function progressText(s: GameState): { text: string; percent: number } {
  const lives = Math.max(0, s.lives);
  const dots = '●'.repeat(lives) + '○'.repeat(Math.max(0, s.cfg.lives - lives));
  const mult = multiplierOf(s.streak, s.cfg);
  return {
    text: `СПАСЕНО ${s.rescued}/${s.cfg.rescueTarget} · ЖИЗНИ ${dots} · СЕРИЯ ×${mult} · ${s.score}`,
    percent: clamp(Math.round((s.rescued / s.cfg.rescueTarget) * 100), 0, 100),
  };
}

export function styleTagOf(s: GameState): 'flawless' | 'clutch' | 'steady' {
  if (s.missed === 0) return 'flawless';
  if (s.lives === 1) return 'clutch';
  return 'steady';
}

// ---------------------------------------------------------------------------
// Spawn
// ---------------------------------------------------------------------------

function doSpawn(s: GameState): void {
  if (s.status !== 'running') return;
  if (s.victims.length >= s.cfg.maxAirborne) {
    s.nextSpawnIn = RETRY_DELAY;
    return;
  }
  const taken = new Set(s.victims.map((v) => v.target));
  const candidates: number[] = [];
  for (let i = 0; i < s.points; i++) {
    if (!taken.has(i) && reachable(s, i)) candidates.push(i);
  }
  if (candidates.length === 0) {
    s.nextSpawnIn = RETRY_DELAY;
    return;
  }
  const target = candidates[Math.floor(nextRandom(s) * candidates.length)] ?? candidates[0]!;
  s.victims = [
    ...s.victims,
    {
      id: s.nextVictimId,
      target,
      window: Math.floor(nextRandom(s) * WINDOW_ROWS),
      phase: 'telegraph',
      t: 0,
    },
  ];
  s.nextVictimId += 1;
  s.nextSpawnIn = spawnInterval(s);
}

/** Exposed for the spawn-constraint tests (§1.5). */
export function trySpawn(state: GameState): GameState {
  const s = fork(state);
  doSpawn(s);
  return s;
}

// ---------------------------------------------------------------------------
// Input — the only place the control variants differ
// ---------------------------------------------------------------------------

export function applyInput(state: GameState, input: InputEvent, now: number): GameState {
  const s = fork(state);
  if (s.status !== 'running') return s;

  switch (s.cfg.controlVariant) {
    case 'inverted': {
      // Arrows steer directly; a point key means "one step towards that point"
      // — and the inversion applies to it just the same, which is the joke.
      let dir: -1 | 1;
      if (input.type === 'arrow') dir = input.dir;
      else {
        if (input.index < 0 || input.index >= s.points || input.index === s.position) return s;
        dir = (input.index - s.position + s.points) % s.points <= s.points / 2 ? 1 : -1;
      }
      const step = s.inverted ? -dir : dir;
      s.position = (s.position + step + s.points) % s.points;
      s.targetIndex = s.position;
      s.events.push({ type: 'step', point: s.position });
      return s;
    }
    case 'bidirectional': {
      if (now < s.nextStepAt) return s; // inside the cooldown — silently ignored
      let step: -1 | 1;
      if (input.type === 'arrow') step = input.dir;
      else {
        const d = (input.index - s.position + s.points) % s.points;
        if (d !== 1 && d !== s.points - 1) {
          s.events.push({ type: 'deny', point: input.index });
          return s;
        }
        step = d === 1 ? 1 : -1;
      }
      s.position = (s.position + step + s.points) % s.points;
      s.targetIndex = s.position;
      s.nextStepAt = now + s.cfg.stepDelay;
      s.events.push({ type: 'step', point: s.position });
      return s;
    }
    case 'clockwise': {
      if (input.type !== 'point') return s;
      if (now < s.nextStepAt) return s; // inside the cooldown — silently ignored
      const next = (s.position + 1) % s.points;
      if (input.index !== next) {
        s.events.push({ type: 'deny', point: input.index });
        return s;
      }
      s.position = next;
      s.targetIndex = next;
      s.nextStepAt = now + s.cfg.stepDelay;
      s.events.push({ type: 'step', point: next });
      return s;
    }
    case 'stepwise': {
      if (input.type !== 'point') return s;
      if (input.index < 0 || input.index >= s.points) return s;
      // Standing still: the first step costs a full stepDelay. Already walking:
      // retarget only, the step timer keeps running (spam must not freeze it).
      if (s.position === s.targetIndex) s.nextStepAt = now + s.cfg.stepDelay;
      s.targetIndex = input.index;
      return s;
    }
  }
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

export function update(state: GameState, dt: number): GameState {
  const s = fork(state);
  if (s.status !== 'running') return s;
  const cfg = s.cfg;

  // 1. time
  s.now += dt;

  // 2. inversion timer
  if (cfg.controlVariant === 'inverted') {
    if (!s.inversionWarned && s.now >= s.inversionAt - cfg.inversionWarnTime) {
      s.inversionWarned = true;
      s.events.push({ type: 'inversionWarn' });
    }
    while (s.now >= s.inversionAt) {
      s.inverted = !s.inverted;
      s.inversionAt += cfg.inversionInterval;
      s.inversionWarned = false;
      s.events.push({ type: 'inverted' });
    }
  }

  // 3. stepwise auto-walk — before landings, so a step that lands on the very
  //    frame of a touchdown still counts for the player.
  if (cfg.controlVariant === 'stepwise') {
    for (
      let guard = s.points;
      guard > 0 && s.position !== s.targetIndex && s.now >= s.nextStepAt;
      guard--
    ) {
      s.position += Math.sign(s.targetIndex - s.position);
      s.nextStepAt += cfg.stepDelay;
      s.events.push({ type: 'step', point: s.position });
    }
  }

  // 4. victims advance
  const landed: Victim[] = [];
  const alive: Victim[] = [];
  for (const v of s.victims) {
    v.t += dt;
    if (v.phase === 'telegraph' && v.t >= cfg.hangTime) {
      v.phase = 'falling';
      v.t -= cfg.hangTime;
    }
    if (v.phase === 'falling' && v.t >= cfg.fallTime) landed.push(v);
    else alive.push(v);
  }
  s.victims = alive;

  // 5. resolve landings, stable by id
  landed.sort((a, b) => a.id - b.id);
  for (const v of landed) {
    if (v.target === s.position) {
      s.rescued += 1;
      s.streak += 1;
      s.bestStreak = Math.max(s.bestStreak, s.streak);
      s.score += cfg.pointsPerCatch * multiplierOf(s.streak, cfg);
      s.events.push({ type: 'catch', point: v.target });
    } else {
      s.missed += 1;
      s.lives -= 1;
      s.streak = 0;
      s.events.push({ type: 'miss', point: v.target });
    }
  }

  // 6. terminal check — win wins over lose. Done before the spawn so that no
  //    victim is born into an already finished round (§3.1).
  if (s.rescued >= cfg.rescueTarget) {
    s.status = 'won';
    s.events.push({ type: 'win' });
  } else if (s.lives <= 0) {
    s.status = 'lost';
    s.events.push({ type: 'lose' });
  }

  // 7. spawn
  s.nextSpawnIn -= dt;
  if (s.status === 'running' && s.nextSpawnIn <= 0) doSpawn(s);

  return s;
}
