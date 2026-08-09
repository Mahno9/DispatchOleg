import { describe, expect, it } from 'vitest';
import { TUTORIALS } from './tutorials';

/**
 * task-sort рисует три зоны колонками (≥720px) и строками (уже). Один набор
 * процентов обслуживает обе раскладки — значит, шаги обязаны расходиться и по
 * x, и по y. Регресс: все три стрелки стояли на x≈50 и на широком экране
 * упирались в среднюю колонку.
 */
describe('инструктаж task-sort', () => {
  const third = (value: number): number => Math.min(2, Math.floor(value / (100 / 3)));

  it('указывает на три разные зоны в обеих раскладках', () => {
    const steps = TUTORIALS['task-sort'];
    expect(steps?.map((s) => third(s.x))).toEqual([0, 1, 2]);
    expect(steps?.map((s) => third(s.y))).toEqual([0, 1, 2]);
  });

  it('все стрелки лежат внутри рабочей области', () => {
    for (const steps of Object.values(TUTORIALS)) {
      for (const step of steps) {
        expect(step.x).toBeGreaterThanOrEqual(0);
        expect(step.x).toBeLessThanOrEqual(100);
        expect(step.y).toBeGreaterThanOrEqual(0);
        expect(step.y).toBeLessThanOrEqual(100);
      }
    }
  });
});
