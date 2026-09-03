import { describe, it, expect, vi, afterEach } from 'vitest';
import { fillPlaceholders, launchMinigame } from './minigameLoader';
import { api } from '../api';

vi.mock('../api', () => ({
  api: { getGameConfig: vi.fn(), getMinigames: vi.fn() },
}));

describe('fillPlaceholders', () => {
  it('подставляет имя в строки на любой глубине', () => {
    const config = {
      playerName: '{player}',
      attempts: 2,
      muted: false,
      tasks: [
        { text: 'Разобрать входящие', assignee: '{player}', done: false, priority: 1 },
        { text: 'Обход района', assignee: 'Вторая смена', done: false, priority: 1 },
      ],
    };

    expect(fillPlaceholders(config, 'Маша')).toEqual({
      playerName: 'Маша',
      attempts: 2,
      muted: false,
      tasks: [
        { text: 'Разобрать входящие', assignee: 'Маша', done: false, priority: 1 },
        { text: 'Обход района', assignee: 'Вторая смена', done: false, priority: 1 },
      ],
    });
  });

  it('заменяет все вхождения в одной строке', () => {
    expect(fillPlaceholders({ t: '{player} и {player}' }, 'Ким')).toEqual({ t: 'Ким и Ким' });
  });

  it('не трогает конфиг без плейсхолдеров и не портит null', () => {
    const config = { a: 'текст', b: null, c: [1, 2] };
    expect(fillPlaceholders(config, 'Маша')).toEqual(config);
  });
});

describe('launchMinigame — onLine', () => {
  // Нет DOM-раннера (jsdom) в этом воркспейсе — минимальная заглушка document
  // только под то, чем её пользуется launchMinigame: appendChild/style/remove.
  afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
    vi.restoreAllMocks();
  });

  it('доходит от callbacks модуля игры до LaunchOptions.onLine, вместе с onDismiss', async () => {
    (globalThis as { document?: unknown }).document = {
      createElement: () => ({ style: {}, remove: vi.fn() }),
    };
    vi.mocked(api.getGameConfig).mockResolvedValue({
      id: 1,
      title: 'Т',
      minigameId: 'demo',
      config: {},
      characterId: null,
      preDialogueId: null,
      postWinDialogueId: null,
      postLoseDialogueId: null,
      styleDialogues: {},
    });
    vi.mocked(api.getMinigames).mockResolvedValue([
      {
        id: 'demo',
        title: 'Demo',
        entryUrl: new URL('./__fixtures__/fakeMinigame.ts', import.meta.url).href,
        schemaUrl: '',
      },
    ]);

    const container = { appendChild: vi.fn() } as unknown as HTMLElement;
    const onLine = vi.fn();
    await launchMinigame({
      container,
      gameId: 1,
      audio: { muted: false, musicVolume: 70, sfxVolume: 100 },
      onLine,
      onFinished: vi.fn(),
    });

    // Фикстура зовёт onLine('...', dismiss) прямо из init.
    expect(onLine).toHaveBeenNthCalledWith(1, 'Тут кто-то уже проходил.', expect.any(Function));

    // dismiss — замыкание самой игры (см. фикстуру): гасит себя onLine(null).
    onLine.mock.calls[0]![1]!();
    expect(onLine).toHaveBeenNthCalledWith(2, null, undefined);
  });
});
