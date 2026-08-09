/**
 * Pure scoring logic for task-sort. No DOM, no config, no side-effects.
 *
 * The player sorts dispatcher tickets into three zones: INBOX, QUEUE (ordered)
 * and ARCHIVE. Only the player's own *active* tasks belong in the queue, sorted
 * by priority (1 = most urgent) top-down; everything else belongs in the
 * archive. Equal priorities may stand in any mutual order.
 */

export interface Task {
  id: string;
  text: string;
  assignee: string;
  done: boolean;
  priority: 1 | 2 | 3 | 4;
}

export type Mistake =
  | { kind: 'archived-own-active'; id: string }
  | { kind: 'queued-foreign-or-done'; id: string }
  | { kind: 'order-inversion'; id: string; afterId: string };

export interface Evaluation {
  mistakes: Mistake[];
  /** Unique card ids to mark with the ALERT stripe. */
  mistakeIds: string[];
  score: number;
  correctPlacements: number;
  correctPairs: number;
  maxScore: number;
  percent: number;
  perfect: boolean;
}

export const PLACEMENT_POINTS = 10;
export const PAIR_POINTS = 5;

/**
 * «Запрос приоритета» на карточке: пока крутится спиннер, поле не читается.
 * Задержка нужна не для красоты — без неё игрок проводит курсором по стопке и
 * получает все приоритеты даром, будто их и не прятали.
 */
export const PROBE_MIN_MS = 500;
export const PROBE_MAX_MS = 1200;
/** Шаг спиннера; он же квант задержки — таймер на карточке ровно один. */
export const PROBE_TICK_MS = 90;

/** Сколько шагов спиннера крутить. `random` — из `Math.random()`, 0…1. */
export function probeTicks(random: number): number {
  const span = PROBE_MAX_MS - PROBE_MIN_MS;
  const ms = PROBE_MIN_MS + Math.min(1, Math.max(0, random)) * span;
  return Math.max(1, Math.round(ms / PROBE_TICK_MS));
}

/** Case-insensitive, whitespace-tolerant name key. */
function nameKey(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Validates raw admin config into playable tasks: assigns ids by original
 * index, clamps priority to 1…4, coerces assignee/done, drops empty texts.
 */
export function normalizeTasks(rawTasks: unknown): Task[] {
  if (!Array.isArray(rawTasks)) return [];
  const tasks: Task[] = [];
  rawTasks.forEach((raw: unknown, index: number) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const text = typeof item.text === 'string' ? item.text.trim() : '';
    if (!text) return;
    const priority = Math.round(Number(item.priority));
    tasks.push({
      id: `t${index}`,
      text,
      assignee: typeof item.assignee === 'string' ? item.assignee.trim() : '',
      done: item.done === true,
      priority: (Number.isFinite(priority) ? Math.min(4, Math.max(1, priority)) : 4) as 1 | 2 | 3 | 4,
    });
  });
  return tasks;
}

/** The single place where an assignee is compared with the player. */
export function isOwnActive(task: Task, playerName: string): boolean {
  const player = nameKey(playerName);
  return player !== '' && !task.done && nameKey(task.assignee) === player;
}

/** Deterministic Fisher-Yates (mulberry32). Returns a new array. */
export function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = items.slice();
  let state = (seed >>> 0) || 1;
  const rnd = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** 10 × N + 5 × C(K, 2), where K is the number of the player's active tasks. */
export function maxScoreFor(tasks: readonly Task[], playerName: string): number {
  const own = tasks.filter((t) => isOwnActive(t, playerName)).length;
  return PLACEMENT_POINTS * tasks.length + (PAIR_POINTS * own * (own - 1)) / 2;
}

/**
 * Scores a layout. Ids missing from `tasks` are ignored; tasks missing from
 * both arrays count as "not placed" — no points, no mistakes.
 */
export function evaluate(
  queueIds: readonly string[],
  archiveIds: readonly string[],
  tasks: readonly Task[],
  playerName: string,
): Evaluation {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const mistakes: Mistake[] = [];
  let correctPlacements = 0;

  for (const id of archiveIds) {
    const task = byId.get(id);
    if (!task) continue;
    if (isOwnActive(task, playerName)) mistakes.push({ kind: 'archived-own-active', id });
    else correctPlacements++;
  }

  const ordered: Task[] = [];
  for (const id of queueIds) {
    const task = byId.get(id);
    if (!task) continue;
    if (isOwnActive(task, playerName)) {
      correctPlacements++;
      ordered.push(task);
    } else {
      // Excluded from the order check: one stray card must not cascade into
      // a pile of phantom inversions.
      mistakes.push({ kind: 'queued-foreign-or-done', id });
    }
  }

  // All pairs, not just neighbours: a card thrown to the very top should cost
  // as much as it disturbs. C(50, 2) = 1225 — quadratic is harmless here.
  let correctPairs = 0;
  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      const a = ordered[i]!;
      const b = ordered[j]!;
      if (a.priority > b.priority) mistakes.push({ kind: 'order-inversion', id: a.id, afterId: b.id });
      else correctPairs++;
    }
  }

  const mistakeIds: string[] = [];
  for (const m of mistakes) {
    for (const id of m.kind === 'order-inversion' ? [m.id, m.afterId] : [m.id]) {
      if (!mistakeIds.includes(id)) mistakeIds.push(id);
    }
  }

  const score = PLACEMENT_POINTS * correctPlacements + PAIR_POINTS * correctPairs;
  const maxScore = maxScoreFor(tasks, playerName);
  return {
    mistakes,
    mistakeIds,
    score,
    correctPlacements,
    correctPairs,
    maxScore,
    percent: maxScore === 0 ? 100 : Math.round((score / maxScore) * 100),
    perfect: mistakes.length === 0,
  };
}

/** Post-dialogue branching tag; only meaningful when the player won. */
export function styleTagFor(evaluation: Evaluation, attemptsUsed: number): 'flawless' | 'corrected' | 'sloppy' {
  if (!evaluation.perfect) return 'sloppy';
  return attemptsUsed <= 1 ? 'flawless' : 'corrected';
}
