import { describe, expect, it, vi } from 'vitest';
import { localState } from './localState';
import { installMemoryLocalStorage } from './memoryStorage';

// Плеер открыт из админки: весь прогон живёт в памяти, мимо localStorage.
vi.mock('../testMode', async (importActual) => ({
  ...(await importActual<typeof import('../testMode')>()),
  testTarget: { kind: 'meta', stageId: null },
}));

installMemoryLocalStorage();

describe('victory flag in test mode', () => {
  // Тестировщик тоже обязан увидеть экран победы после пятой Shift+START, но
  // отметка о показе не должна ложиться на реальный терминал — иначе тестовый
  // прогон крадёт финал у следующего живого игрока.
  it('keeps the flag in memory and never touches localStorage', () => {
    expect(localState.isVictorySeen()).toBe(false);

    localState.markVictorySeen();

    expect(localState.isVictorySeen()).toBe(true);
    expect(localStorage.getItem('dispatch_victory_seen')).toBeNull();
  });

  // Без гашения победа зациклилась бы: мета показывает её снова и снова.
  it('clears the in-memory flag', () => {
    localState.markVictorySeen();
    localState.clearVictorySeen();
    expect(localState.isVictorySeen()).toBe(false);
  });

  it('drops the flag when the next player starts a session', () => {
    localState.markVictorySeen();
    localState.startSession({ userId: 'u1', name: 'ТЕСТ' });
    expect(localState.isVictorySeen()).toBe(false);
  });
});
