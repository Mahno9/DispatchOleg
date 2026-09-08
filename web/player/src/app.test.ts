import { describe, expect, it } from 'vitest';
import { launchAction, syncIntervalS } from './App';
import type { GameConfig } from './api';

function config(preDialogueId: number | null): GameConfig {
  return {
    id: 1,
    title: 'Т',
    minigameId: 'demo',
    config: {},
    characterId: null,
    preDialogueId,
    postWinDialogueId: null,
    postLoseDialogueId: null,
    styleDialogues: {},
  };
}

describe('launchAction', () => {
  it('ведёт в мини-игру или в сцену перед ней', () => {
    expect(launchAction(1, 1, config(null))).toEqual({ kind: 'minigame' });
    expect(launchAction(1, 1, config(7))).toEqual({ kind: 'dialogue', dialogueId: 7 });
  });

  // Гонка: игрок нажал «Отмена» (или его увело на онбординг), пока конфиг летел.
  // Поздний ответ обязан промолчать, а не выкинуть его в пустую мини-игру.
  it('молчит, если запуск уже отменён', () => {
    expect(launchAction(1, 2, config(null))).toEqual({ kind: 'ignore' });
    expect(launchAction(1, 2, config(7))).toEqual({ kind: 'ignore' });
    expect(launchAction(1, 2, null)).toEqual({ kind: 'ignore' });
  });

  it('несдавшийся конфиг — ошибка, а не запуск игры без конфига', () => {
    expect(launchAction(3, 3, null)).toEqual({ kind: 'error' });
  });
});

describe('syncIntervalS', () => {
  it('берёт настройку админки', () => {
    expect(syncIntervalS(60)).toBe(60);
    expect(syncIntervalS(7.4)).toBe(7);
  });

  it('без настройки (и на мусоре) — запасные 20 с', () => {
    expect(syncIntervalS(undefined)).toBe(20);
    expect(syncIntervalS(null)).toBe(20);
    expect(syncIntervalS('30')).toBe(20);
    expect(syncIntervalS(Number.NaN)).toBe(20);
  });

  it('ноль и отрицательное не устраивают шторм запросов', () => {
    expect(syncIntervalS(0)).toBe(5);
    expect(syncIntervalS(-100)).toBe(5);
  });
});
