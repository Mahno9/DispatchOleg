import { describe, expect, it } from 'vitest';
import schema from '../schema.json';
import {
  PROBE_MAX_MS,
  PROBE_MIN_MS,
  PROBE_TICK_MS,
  evaluate,
  isOwnActive,
  maxScoreFor,
  normalizeTasks,
  probeTicks,
  shuffle,
  styleTagFor,
  type Mistake,
  type Task,
} from './engine.js';

// t0 own P1, t1 own P1, t2 own P2, t3 own P3, t4 foreign active, t5 own done
const TASKS: Task[] = normalizeTasks([
  { text: 'краб на мосту', assignee: 'Олег', done: false, priority: 1 },
  { text: 'пожар', assignee: 'Олег', done: false, priority: 1 },
  { text: 'запах газа', assignee: 'Олег', done: false, priority: 2 },
  { text: 'робот-курьер', assignee: 'Олег', done: false, priority: 3 },
  { text: 'титан и мегачел', assignee: 'Марина', done: false, priority: 1 },
  { text: 'краб отбуксирован', assignee: 'Олег', done: true, priority: 2 },
]);
const P = 'Олег';
const MAX = 6 * 10 + 5 * 6; // 6 tasks, 4 own active → C(4,2) = 6 pairs

const kinds = (ms: Mistake[]): string[] => ms.map((m) => m.kind);

describe('evaluate', () => {
  it('1. perfect layout', () => {
    const r = evaluate(['t0', 't1', 't2', 't3'], ['t4', 't5'], TASKS, P);
    expect(r.mistakes).toEqual([]);
    expect(r.perfect).toBe(true);
    expect(r.maxScore).toBe(MAX);
    expect(r.score).toBe(MAX);
    expect(r.percent).toBe(100);
  });

  it('2. own active card archived', () => {
    const r = evaluate(['t0', 't1', 't2'], ['t3', 't4', 't5'], TASKS, P);
    expect(r.mistakes).toEqual([{ kind: 'archived-own-active', id: 't3' }]);
    expect(r.perfect).toBe(false);
    expect(r.correctPlacements).toBe(5); // t3 earns nothing
    expect(r.correctPairs).toBe(3);
    expect(r.score).toBe(50 + 15);
  });

  it('3. foreign card queued', () => {
    const r = evaluate(['t0', 't1', 't2', 't3', 't4'], ['t5'], TASKS, P);
    expect(r.mistakes).toEqual([{ kind: 'queued-foreign-or-done', id: 't4' }]);
    expect(r.correctPairs).toBe(6);
  });

  it('4. own but done card queued is still a mistake', () => {
    const r = evaluate(['t0', 't1', 't2', 't3', 't5'], ['t4'], TASKS, P);
    expect(r.mistakes).toEqual([{ kind: 'queued-foreign-or-done', id: 't5' }]);
  });

  it('5. adjacent inversion', () => {
    const r = evaluate(['t0', 't1', 't3', 't2'], ['t4', 't5'], TASKS, P);
    expect(r.mistakes).toEqual([{ kind: 'order-inversion', id: 't3', afterId: 't2' }]);
    expect(r.mistakeIds.sort()).toEqual(['t2', 't3']);
    expect(r.correctPairs).toBe(5); // one less than the maximum of 6
  });

  it('6. a low-priority card thrown to the top costs every card it jumped', () => {
    const r = evaluate(['t3', 't0', 't1', 't2'], ['t4', 't5'], TASKS, P);
    expect(r.mistakes).toHaveLength(3);
    expect(new Set(kinds(r.mistakes))).toEqual(new Set(['order-inversion']));
    expect(r.correctPairs).toBe(3);
  });

  it('7. equal priorities — any mutual order is fine', () => {
    const three = normalizeTasks([
      { text: 'a', assignee: 'Олег', done: false, priority: 1 },
      { text: 'b', assignee: 'Олег', done: false, priority: 1 },
      { text: 'c', assignee: 'Олег', done: false, priority: 1 },
    ]);
    const perms = [
      ['t0', 't1', 't2'],
      ['t0', 't2', 't1'],
      ['t1', 't0', 't2'],
      ['t1', 't2', 't0'],
      ['t2', 't0', 't1'],
      ['t2', 't1', 't0'],
    ];
    for (const perm of perms) {
      const r = evaluate(perm, [], three, P);
      expect(r.mistakes).toEqual([]);
      expect(r.correctPairs).toBe(3);
    }
  });

  it('8. archived own active + queued foreign, independently', () => {
    const r = evaluate(['t0', 't1', 't2', 't4'], ['t3', 't5'], TASKS, P);
    expect(kinds(r.mistakes).sort()).toEqual(['archived-own-active', 'queued-foreign-or-done']);
  });

  it('9. all three mistake kinds at once, mistakeIds without duplicates', () => {
    const r = evaluate(['t2', 't0', 't4'], ['t3', 't1', 't5'], TASKS, P);
    expect(new Set(kinds(r.mistakes))).toEqual(
      new Set(['archived-own-active', 'queued-foreign-or-done', 'order-inversion']),
    );
    expect(new Set(r.mistakeIds).size).toBe(r.mistakeIds.length);
  });

  it('10. a stray queued card does not create phantom inversions', () => {
    const r = evaluate(['t0', 't1', 't2', 't4', 't3'], ['t5'], TASKS, P);
    expect(r.mistakes).toEqual([{ kind: 'queued-foreign-or-done', id: 't4' }]);
    expect(r.correctPairs).toBe(6);
  });

  it('11. assignee case and padding are ignored', () => {
    const padded = normalizeTasks([{ text: 'a', assignee: '  олЕг ', done: false, priority: 1 }]);
    expect(isOwnActive(padded[0]!, ' Олег')).toBe(true);
    expect(evaluate(['t0'], [], padded, 'Олег').mistakes).toEqual([]);
  });

  it('12. empty queue, everything archived', () => {
    const r = evaluate([], ['t0', 't1', 't2', 't3', 't4', 't5'], TASKS, P);
    expect(r.mistakes).toHaveLength(4); // four own active tasks
    expect(new Set(kinds(r.mistakes))).toEqual(new Set(['archived-own-active']));
    expect(r.correctPairs).toBe(0);
    expect(r.score).toBe(20); // t4 + t5 archived correctly
    expect(r.percent).toBe(Math.round((20 / MAX) * 100));
  });

  it('13. empty archive, everything queued', () => {
    const r = evaluate(['t0', 't1', 't3', 't2', 't4', 't5'], [], TASKS, P);
    expect(kinds(r.mistakes).filter((k) => k === 'queued-foreign-or-done')).toHaveLength(2);
    expect(kinds(r.mistakes).filter((k) => k === 'order-inversion')).toHaveLength(1);
    expect(r.correctPlacements).toBe(4);
  });

  it('15. a task in neither array is neither a mistake nor points', () => {
    const r = evaluate(['t0', 't1', 't2'], ['t4', 't5'], TASKS, P);
    expect(r.mistakes).toEqual([]);
    expect(r.perfect).toBe(true);
    expect(r.correctPlacements).toBe(5);
    expect(r.score).toBeLessThan(r.maxScore);
  });

  it('unknown ids are ignored', () => {
    const r = evaluate(['t0', 'nope'], ['t99'], TASKS, P);
    expect(r.mistakes).toEqual([]);
    expect(r.correctPlacements).toBe(1);
  });

  it('maxScore 0 gives percent 100 instead of NaN', () => {
    expect(evaluate([], [], [], P).percent).toBe(100);
  });
});

describe('default content', () => {
  const defaults = normalizeTasks(schema.properties.tasks.default);

  it('14. maxScoreFor on the default content is 630', () => {
    expect(defaults).toHaveLength(30);
    expect(defaults.filter((t) => isOwnActive(t, 'Олег'))).toHaveLength(12);
    expect(maxScoreFor(defaults, 'Олег')).toBe(630);
  });

  it('a correct layout of the default content is perfect', () => {
    const own = defaults.filter((t) => isOwnActive(t, 'Олег'));
    const queue = [...own].sort((a, b) => a.priority - b.priority).map((t) => t.id);
    const archive = defaults.filter((t) => !isOwnActive(t, 'Олег')).map((t) => t.id);
    const r = evaluate(queue, archive, defaults, 'Олег');
    expect(r.mistakes).toEqual([]);
    expect(r.score).toBe(630);
    expect(r.percent).toBe(100);
  });
});

describe('helpers', () => {
  it('16. styleTagFor', () => {
    const perfect = evaluate(['t0', 't1', 't2', 't3'], ['t4', 't5'], TASKS, P);
    const flawed = evaluate([], ['t0', 't1', 't2', 't3', 't4', 't5'], TASKS, P);
    expect(styleTagFor(perfect, 1)).toBe('flawless');
    expect(styleTagFor(perfect, 2)).toBe('corrected');
    expect(styleTagFor(flawed, 2)).toBe('sloppy');
  });

  it('17. shuffle is deterministic and keeps the multiset', () => {
    const ids = TASKS.map((t) => t.id);
    expect(shuffle(ids, 42)).toEqual(shuffle(ids, 42));
    expect(shuffle(ids, 42).slice().sort()).toEqual(ids.slice().sort());
    expect(shuffle(ids, 42)).not.toEqual(shuffle(ids, 7));
    expect(ids).toEqual(TASKS.map((t) => t.id)); // input untouched
  });

  it('18. normalizeTasks clamps priority and drops empty texts', () => {
    const tasks = normalizeTasks([
      { text: 'слишком срочно', assignee: 'Олег', done: false, priority: 9 },
      { text: '   ', assignee: 'Олег', done: false, priority: 1 },
      { text: 'нулевой', assignee: 'Олег', done: false, priority: 0 },
      { text: 'мусор', assignee: 42, done: 'yes', priority: 'abc' },
      null,
    ]);
    expect(tasks.map((t) => [t.id, t.priority])).toEqual([
      ['t0', 4],
      ['t2', 1],
      ['t3', 4],
    ]);
    expect(tasks[2]!.assignee).toBe('');
    expect(tasks[2]!.done).toBe(false);
  });

  it('normalizeTasks survives a broken config', () => {
    expect(normalizeTasks(undefined)).toEqual([]);
    expect(normalizeTasks('nope')).toEqual([]);
    expect(normalizeTasks([])).toEqual([]);
  });

  // Задержка — вся суть механики: короче 500 мс её можно «промазать» курсором,
  // длиннее 1200 мс разбор смены превращается в ожидание.
  it('probeTicks keeps the priority query inside 500…1200 ms', () => {
    for (const r of [0, 0.25, 0.5, 0.75, 1, -3, 42]) {
      const ms = probeTicks(r) * PROBE_TICK_MS;
      expect(ms).toBeGreaterThanOrEqual(PROBE_MIN_MS - PROBE_TICK_MS / 2);
      expect(ms).toBeLessThanOrEqual(PROBE_MAX_MS + PROBE_TICK_MS / 2);
    }
    expect(probeTicks(0)).toBeLessThan(probeTicks(1));
  });
});
