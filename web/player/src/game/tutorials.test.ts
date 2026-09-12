import { describe, expect, it } from 'vitest';
import { TUTORIALS, autoDir, autoPoint, resolveStep } from './tutorials';

const HOST = { left: 100, top: 50, width: 1000, height: 500 };

describe('размещение шага по элементу игры', () => {
  it('переводит точку внутри цели в проценты рабочей области', () => {
    // Цель занимает правую половину по ширине и нижнюю по высоте.
    const target = { left: 600, top: 300, width: 500, height: 250 };
    expect(resolveStep(HOST, target, { x: 0, y: 0, dir: 'up', text: '' })).toMatchObject({
      x: 50,
      y: 50,
    });
    expect(resolveStep(HOST, target, { x: 100, y: 100, dir: 'up', text: '' })).toMatchObject({
      x: 100,
      y: 100,
    });
  });

  it('без цели остаются проценты самого шага, иначе центр', () => {
    expect(resolveStep(HOST, null, { x: 30, y: 70, dir: 'up', text: '' })).toMatchObject({
      x: 30,
      y: 70,
    });
    expect(resolveStep(HOST, null, { text: '' })).toMatchObject({ x: 50, y: 50 });
    // Схлопнутая цель — тоже повод не делить на ноль.
    const empty = { left: 0, top: 0, width: 0, height: 0 };
    expect(resolveStep(HOST, empty, { x: 30, y: 70, text: '' })).toMatchObject({ x: 30, y: 70 });
  });

  // Игра на canvas растягивает холст на всю зону, а мир рисует по центру.
  it('aspect вписывает картинку в цель, как object-fit: contain', () => {
    const full = { left: 100, top: 50, width: 1000, height: 500 };
    // Мир 1:1 в области 2:1 → квадрат 500×500 по центру, слева и справа по 250.
    expect(resolveStep(HOST, full, { x: 0, y: 0, aspect: 1, dir: 'up', text: '' })).toMatchObject({
      x: 25,
      y: 0,
    });
    expect(
      resolveStep(HOST, full, { x: 100, y: 100, aspect: 1, dir: 'up', text: '' }),
    ).toMatchObject({ x: 75, y: 100 });
  });
});

describe('авторазмещение', () => {
  // Подпись шириной до 88% обрежется краем, если стрелка у края смотрит наружу.
  it('разворачивает шаг подписью к центру экрана', () => {
    const at = (left: number, top: number) => ({ left, top, width: 100, height: 50 });
    expect(autoDir(HOST, at(150, 250))).toBe('left'); // левая треть
    expect(autoDir(HOST, at(950, 250))).toBe('right'); // правая треть
    expect(autoDir(HOST, at(550, 100))).toBe('up'); // середина, верхняя половина
    expect(autoDir(HOST, at(550, 450))).toBe('down'); // середина, нижняя половина
    expect(autoDir(HOST, null)).toBe('up');
  });

  it('сажает стрелку на обращённую к подписи кромку, чтобы остриё смотрело внутрь цели', () => {
    expect(autoPoint('left')).toEqual({ x: 90, y: 50 });
    expect(autoPoint('right')).toEqual({ x: 10, y: 50 });
    expect(autoPoint('up')).toEqual({ x: 50, y: 90 });
    expect(autoPoint('down')).toEqual({ x: 50, y: 10 });
  });

  it('шаг без dir берёт направление у своего места на экране', () => {
    const left = { left: 100, top: 250, width: 200, height: 100 };
    const right = { left: 900, top: 250, width: 200, height: 100 };
    const top = { left: 500, top: 50, width: 200, height: 100 };
    const bottom = { left: 500, top: 450, width: 200, height: 100 };
    expect(resolveStep(HOST, left, { text: '' })).toEqual({ x: 18, y: 50, dir: 'left' });
    expect(resolveStep(HOST, right, { text: '' })).toEqual({ x: 82, y: 50, dir: 'right' });
    expect(resolveStep(HOST, top, { text: '' })).toEqual({ x: 50, y: 18, dir: 'up' });
    expect(resolveStep(HOST, bottom, { text: '' })).toEqual({ x: 50, y: 82, dir: 'down' });
  });
});

describe('данные инструктажа', () => {
  it('task-sort целится в заголовки зон и подсказку приоритета', () => {
    expect(TUTORIALS['task-sort']?.map((s) => s.target)).toEqual([
      '.ts-zone--inbox .ts-zone__head',
      '.ts-zone--queue .ts-zone__hint',
      '.ts-zone--archive .ts-zone__head',
    ]);
    expect(TUTORIALS['task-sort']?.map((s) => s.dir)).toEqual(['up', 'up', 'up']);
  });

  it('сейф целится в активный ригель и сам виджет ввода', () => {
    expect(TUTORIALS['safe-crack']?.slice(0, 2).map((s) => s.target)).toEqual([
      '.sc-bolt--active',
      '.sc-slot',
    ]);
  });

  it('падающая деталь целится в видимую клетку, а не в безразмерный контейнер', () => {
    expect(TUTORIALS['tetris-fill']?.[0]?.target).toBe('.tf-piece .tf-sq:first-child');
  });

  it('кухня целится в видимую строку рецепта, а котёл подписывает сверху', () => {
    expect(TUTORIALS['cooking-orders']?.[0]?.target).toBe('.co-recipe li:first-child');
    expect(TUTORIALS['cooking-orders']?.[2]?.dir).toBe('down');
  });

  it('у каждого шага есть цель, а проценты лежат внутри неё', () => {
    for (const [game, steps] of Object.entries(TUTORIALS)) {
      for (const step of steps) {
        expect(step.target, game).toMatch(/^\./);
        if (step.x !== undefined) expect(step.x, game).toBeGreaterThanOrEqual(0);
        if (step.x !== undefined) expect(step.x, game).toBeLessThanOrEqual(100);
        if (step.y !== undefined) expect(step.y, game).toBeGreaterThanOrEqual(0);
        if (step.y !== undefined) expect(step.y, game).toBeLessThanOrEqual(100);
      }
    }
  });

  it('подземка ведёт сначала на старт, затем на финиш первого лабиринта', () => {
    expect(TUTORIALS['three-mazes']).toMatchObject([
      { x: 81.5, y: 72.5, dir: 'up', text: expect.stringMatching(/старт/) },
      { x: 36.5, y: 18.5, dir: 'down', text: expect.stringMatching(/двойной янтарный круг/) },
    ]);
  });

  it('Восточный мост целится в стартовую точку Q и не указывает в пустоту', () => {
    expect(TUTORIALS['rescue-catch']).toHaveLength(2);
    expect(TUTORIALS['rescue-catch']?.[1]).toMatchObject({ x: 28.3, y: 71.8, dir: 'left' });
  });
});
