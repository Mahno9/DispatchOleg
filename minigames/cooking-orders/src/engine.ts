/**
 * Pure order FSM for cooking-orders. No DOM, no timers, no rAF: every
 * transition takes the current timestamp as an argument and returns a new
 * state, so the whole thing is deterministic and testable.
 *
 * Spec: docs/minigames/06-cooking-orders.md §5.1
 */

export interface Step {
  ingredientId: string;
  amount: number;
}

export interface Order {
  name: string;
  orderName: string;
  portrait: string;
  steps: Step[];
  cookSeconds: number;
}

export interface Ingredient {
  id: string;
  name: string;
  image: string;
  unitName: string;
}

export interface Config {
  orders: Order[];
  fillRatePerSec: number;
  doseTolerancePct: number;
  cookTolerancePct: number;
  failsAllowed: number;
  pointsPerStep: number;
  pointsPerOrder: number;
}

export type Phase = 'idle' | 'pouring' | 'cooking' | 'spoiled' | 'orderDone' | 'wiped' | 'finished';

export interface State {
  phase: Phase;
  orderIndex: number;
  stepIndex: number;
  /** ms, absolute mark of hold start — hold value is derived from it, never accumulated. */
  holdStartedAt: number | null;
  /** units poured (pouring) or seconds cooked (cooking) */
  holdValue: number;
  score: number;
  /** points earned on steps of the current order — wiped out by a mistake */
  orderScore: number;
  fails: number;
  wipes: number;
}

/** A frame gap this large means the tab slept — cancel the hold, do not punish (§6.3). */
export const MAX_FRAME_GAP_MS = 500;

/** Tolerance boundaries are inclusive; this absorbs float noise on the exact edge. */
const EPS = 1e-9;

export function initialState(): State {
  return {
    phase: 'idle',
    orderIndex: 0,
    stepIndex: 0,
    holdStartedAt: null,
    holdValue: 0,
    score: 0,
    orderScore: 0,
    fails: 0,
    wipes: 0,
  };
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export function currentOrder(s: State, cfg: Config): Order | undefined {
  return cfg.orders[s.orderIndex];
}

export function currentStep(s: State, cfg: Config): Step | undefined {
  return currentOrder(s, cfg)?.steps[s.stepIndex];
}

/** Dose scale in units: amber zone is [min, max], the scale ends exactly at max. */
export function doseWindow(s: State, cfg: Config): { min: number; max: number; scaleMax: number } | undefined {
  const step = currentStep(s, cfg);
  if (!step || step.amount <= 0) return undefined;
  const tol = cfg.doseTolerancePct / 100;
  return { min: step.amount - tol, max: step.amount + tol, scaleMax: step.amount + tol };
}

/** Cook ring in seconds: a full turn equals the upper tolerance bound. */
export function cookWindow(s: State, cfg: Config): { min: number; max: number; ringMax: number } | undefined {
  const order = currentOrder(s, cfg);
  if (!order) return undefined;
  const tol = cfg.cookTolerancePct / 100;
  return {
    min: order.cookSeconds * (1 - tol),
    max: order.cookSeconds * (1 + tol),
    ringMax: order.cookSeconds * (1 + tol),
  };
}

/** Hold value at time `t`, derived from the absolute start mark (§6.3). */
export function holdAt(s: State, cfg: Config, t: number): number {
  if (s.holdStartedAt === null) return 0;
  const seconds = Math.max(0, (t - s.holdStartedAt) / 1000);
  return s.phase === 'pouring' ? seconds * cfg.fillRatePerSec : seconds;
}

/** One progress unit per ingredient step plus one for the cook step of each order. */
export function progress(s: State, cfg: Config): { text: string; percent: number } {
  const total = cfg.orders.reduce((sum, o) => sum + o.steps.length + 1, 0);
  let done = 0;
  for (let i = 0; i < s.orderIndex && i < cfg.orders.length; i++) done += cfg.orders[i]!.steps.length + 1;
  done += s.stepIndex;
  const order = currentOrder(s, cfg);
  const text = order
    ? `ЗАКАЗ ${s.orderIndex + 1}/${cfg.orders.length} · ШАГ ${Math.min(s.stepIndex + 1, order.steps.length + 1)}/${order.steps.length + 1}`
    : `ЗАКАЗ ${cfg.orders.length}/${cfg.orders.length} · СМЕНА ЗАКРЫТА`;
  return { text, percent: total === 0 ? 100 : Math.round((done / total) * 100) };
}

export function styleTagFor(s: State): 'flawless' | 'steady' | 'scorched' {
  if (s.wipes >= 1) return 'scorched';
  return s.fails === 0 ? 'flawless' : 'steady';
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

function within(value: number, min: number, max: number): boolean {
  return value >= min - EPS && value <= max + EPS;
}

/**
 * The single failure path: points of the current order are taken back, the
 * order restarts from step 1, the global counter grows. The `failsAllowed`-th
 * mistake burns the whole shift instead of a single dish.
 */
function fail(s: State, cfg: Config): State {
  const fails = s.fails + 1;
  const wiped = fails >= cfg.failsAllowed;
  return {
    ...s,
    phase: wiped ? 'wiped' : 'spoiled',
    stepIndex: 0,
    holdStartedAt: null,
    holdValue: 0,
    score: s.score - s.orderScore,
    orderScore: 0,
    fails,
    wipes: wiped ? s.wipes + 1 : s.wipes,
  };
}

function stepDone(s: State, cfg: Config): State {
  return {
    ...s,
    phase: 'idle',
    stepIndex: s.stepIndex + 1,
    holdStartedAt: null,
    holdValue: 0,
    score: s.score + cfg.pointsPerStep,
    orderScore: s.orderScore + cfg.pointsPerStep,
  };
}

/** Single click on a shelf cell — only valid for a `amount === 0` step. */
export function pickIngredient(s: State, cfg: Config, ingredientId: string): State {
  if (s.phase !== 'idle') return s;
  const step = currentStep(s, cfg);
  if (!step || step.amount !== 0 || step.ingredientId !== ingredientId) return fail(s, cfg);
  return stepDone(s, cfg);
}

/** Press-and-hold on a shelf cell — only valid for a `amount > 0` step. */
export function startPour(s: State, cfg: Config, ingredientId: string, t: number): State {
  if (s.phase !== 'idle') return s;
  const step = currentStep(s, cfg);
  if (!step || step.amount <= 0 || step.ingredientId !== ingredientId) return fail(s, cfg);
  return { ...s, phase: 'pouring', holdStartedAt: t, holdValue: 0 };
}

export function endPour(s: State, cfg: Config, t: number): State {
  if (s.phase !== 'pouring') return s;
  const w = doseWindow(s, cfg);
  const value = holdAt(s, cfg, t);
  if (!w || !within(value, w.min, w.max)) return fail(s, cfg);
  return stepDone(s, cfg);
}

export function startCook(s: State, cfg: Config, t: number): State {
  if (s.phase !== 'idle') return s;
  const order = currentOrder(s, cfg);
  if (!order || s.stepIndex !== order.steps.length) return fail(s, cfg);
  return { ...s, phase: 'cooking', holdStartedAt: t, holdValue: 0 };
}

export function endCook(s: State, cfg: Config, t: number): State {
  if (s.phase !== 'cooking') return s;
  const w = cookWindow(s, cfg);
  const value = holdAt(s, cfg, t);
  if (!w || !within(value, w.min, w.max)) return fail(s, cfg);
  const orderIndex = s.orderIndex + 1;
  return {
    ...s,
    phase: orderIndex >= cfg.orders.length ? 'finished' : 'orderDone',
    orderIndex,
    stepIndex: 0,
    holdStartedAt: null,
    holdValue: 0,
    score: s.score + cfg.pointsPerOrder,
    orderScore: 0,
  };
}

/**
 * Called from rAF while holding. Overflow and overcook are caught here, in the
 * frame, without waiting for the release (§6.4).
 */
export function tickHold(s: State, cfg: Config, t: number, lastFrameAt?: number): State {
  if (s.phase !== 'pouring' && s.phase !== 'cooking') return s;
  if (lastFrameAt !== undefined && t - lastFrameAt > MAX_FRAME_GAP_MS) return cancelHold(s);
  const value = holdAt(s, cfg, t);
  const w = s.phase === 'pouring' ? doseWindow(s, cfg) : cookWindow(s, cfg);
  if (!w) return fail(s, cfg);
  if (value > w.max + EPS) return fail(s, cfg);
  return { ...s, holdValue: value };
}

/** Hold aborted by the system, not the player: no penalty, step stays current. */
export function cancelHold(s: State): State {
  if (s.phase !== 'pouring' && s.phase !== 'cooking') return s;
  return { ...s, phase: 'idle', holdStartedAt: null, holdValue: 0 };
}

export function resolveSpoiled(s: State): State {
  return s.phase === 'spoiled' ? { ...s, phase: 'idle' } : s;
}

export function resolveOrderDone(s: State): State {
  return s.phase === 'orderDone' ? { ...s, phase: 'idle' } : s;
}

/** End of the "ВСЁ СГОРЕЛО" splash: the shift restarts, `wipes` is kept. */
export function resolveWipe(s: State): State {
  if (s.phase !== 'wiped') return s;
  return {
    ...initialState(),
    wipes: s.wipes,
  };
}

// ---------------------------------------------------------------------------
// Config normalisation (§4, §6.6, §6.7)
// ---------------------------------------------------------------------------

export interface Normalized {
  cfg: Config;
  ingredients: Ingredient[];
  spoilAnimationMs: number;
  /** Non-null means the level is unplayable — render the config error panel. */
  error: string | null;
}

function num(value: unknown, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalize(raw: unknown): Normalized {
  const c = (raw ?? {}) as Record<string, unknown>;

  const ingredients: Ingredient[] = [];
  if (Array.isArray(c.ingredients)) {
    for (const item of c.ingredients as Record<string, unknown>[]) {
      const id = str(item?.id);
      if (!id || ingredients.some((x) => x.id === id)) continue;
      ingredients.push({
        id,
        name: str(item?.name) || id,
        image: str(item?.image),
        unitName: str(item?.unitName) || 'ложка',
      });
    }
  }

  const orders: Order[] = [];
  if (Array.isArray(c.characters)) {
    for (const item of c.characters as Record<string, unknown>[]) {
      const rawSteps = Array.isArray(item?.steps) ? (item.steps as Record<string, unknown>[]) : [];
      orders.push({
        name: str(item?.name) || 'БЕЗ ИМЕНИ',
        portrait: str(item?.portrait),
        orderName: str(item?.orderName) || 'БЕЗ НАЗВАНИЯ',
        cookSeconds: num(item?.cookSeconds, 6, 0.5),
        steps: rawSteps.map((st) => ({
          ingredientId: str(st?.ingredientId),
          amount: Math.max(0, Math.round(num(st?.amount, 1, 0))),
        })),
      });
    }
  }

  let error: string | null = null;
  if (orders.length === 0) error = 'КОНФИГ ПУСТ: НЕТ ЗАКАЗОВ';
  else if (ingredients.length === 0) error = 'КОНФИГ ПУСТ: НЕТ ИНГРЕДИЕНТОВ';
  else {
    // A step pointing at a missing ingredient makes the order unpassable — refuse
    // loudly at init instead of shipping a dead level (§6.7).
    outer: for (const order of orders) {
      for (const step of order.steps) {
        if (!ingredients.some((i) => i.id === step.ingredientId)) {
          error = `ОШИБКА КОНФИГА: ЗАКАЗ «${order.orderName}» ССЫЛАЕТСЯ НА НЕИЗВЕСТНЫЙ ИНГРЕДИЕНТ «${step.ingredientId || '—'}»`;
          break outer;
        }
      }
    }
  }

  return {
    ingredients,
    spoilAnimationMs: Math.round(num(c.spoilAnimationMs, 1000, 200, 5000)),
    error,
    cfg: {
      orders,
      fillRatePerSec: num(c.fillRatePerSec, 1.5, 0.1),
      doseTolerancePct: Math.round(num(c.doseTolerancePct, 40, 1, 100)),
      cookTolerancePct: Math.round(num(c.cookTolerancePct, 12, 1, 50)),
      failsAllowed: Math.round(num(c.failsAllowed, 3, 1)),
      pointsPerStep: Math.round(num(c.pointsPerStep, 10, 0)),
      pointsPerOrder: Math.round(num(c.pointsPerOrder, 50, 0)),
    },
  };
}
