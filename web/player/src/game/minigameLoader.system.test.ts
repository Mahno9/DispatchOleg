import { afterEach, describe, expect, it, vi } from 'vitest';
import { launchMinigame } from './minigameLoader';
import { api, type GameConfig } from '../api';

// Отдельный файл, а не ещё один describe рядом: список мини-игр в лоадере
// кэшируется на модуль, и первый же тест зафиксировал бы его для остальных.
vi.mock('../api', () => ({
  api: { getMinigames: vi.fn() },
}));

const ONBOARDING: GameConfig = {
  id: 9,
  title: 'Онбординг',
  minigameId: 'onboarding',
  config: {},
  characterId: null,
  preDialogueId: null,
  postWinDialogueId: null,
  postLoseDialogueId: null,
  styleDialogues: {},
};

describe('launchMinigame — системная мини-игра', () => {
  afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
    vi.restoreAllMocks();
  });

  // Сервер отдаёт системным играм (онбординг) entryUrl: null — бандла нет.
  // Раньше null уезжал прямо в import() и падал чем угодно, кроме понятного.
  it('падает с понятной ошибкой, а не уходит в import(null)', async () => {
    // Заглушка document: DOM-раннера (jsdom) в этом воркспейсе нет.
    (globalThis as { document?: unknown }).document = {
      createElement: () => ({ style: {}, remove: vi.fn() }),
    };
    vi.mocked(api.getMinigames).mockResolvedValue([
      { id: 'onboarding', title: 'Онбординг', entryUrl: null, schemaUrl: '' },
    ]);

    await expect(
      launchMinigame({
        container: { appendChild: vi.fn() } as unknown as HTMLElement,
        config: ONBOARDING,
        audio: { muted: false, musicVolume: 70, sfxVolume: 100 },
        onFinished: vi.fn(),
      }),
    ).rejects.toThrow('Системная операция не запускается: onboarding');
  });
});
