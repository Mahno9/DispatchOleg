import { describe, it, expect, vi, afterEach } from 'vitest';
import { fillPlaceholders, launchMinigame, preloadAssets } from './minigameLoader';
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

describe('preloadAssets', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubNet(failing: string[] = []) {
    const fetch = vi.fn(async (url: string) => {
      if (failing.includes(url)) throw new Error('net');
      return { ok: true, blob: async () => ({ url }) };
    });
    const created: unknown[] = [];
    const revoked: string[] = [];
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('URL', {
      createObjectURL: (b: { url: string }) => {
        created.push(b);
        return `blob:${b.url}`;
      },
      revokeObjectURL: (u: string) => revoked.push(u),
    });
    return { fetch, created, revoked };
  }

  it('тянет каждый ассет один раз и подменяет адреса на blob на любой глубине', async () => {
    const { fetch, revoked } = stubNet();
    const config = {
      music: '/assets-store/m.ogg',
      sounds: {
        hit: [{ url: '/assets-store/a.ogg', weight: 1 }, { url: '/assets-store/m.ogg', weight: 1 }],
      },
      title: 'не адрес',
      icon: '/other/x.svg',
      n: 3,
    };
    const { config: out, release } = await preloadAssets(config);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(out).toEqual({
      music: 'blob:/assets-store/m.ogg',
      sounds: {
        hit: [
          { url: 'blob:/assets-store/a.ogg', weight: 1 },
          { url: 'blob:/assets-store/m.ogg', weight: 1 },
        ],
      },
      title: 'не адрес',
      icon: '/other/x.svg',
      n: 3,
    });
    expect(config.music).toBe('/assets-store/m.ogg'); // исходник не тронут
    release();
    expect(revoked.sort()).toEqual(['blob:/assets-store/a.ogg', 'blob:/assets-store/m.ogg']);
  });

  it('несдачавшийся ассет оставляет оригинальный адрес, остальные подменяются', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubNet(['/assets-store/bad.ogg']);
    const { config } = await preloadAssets({ a: '/assets-store/bad.ogg', b: '/assets-store/ok.ogg' });
    expect(config).toEqual({ a: '/assets-store/bad.ogg', b: 'blob:/assets-store/ok.ogg' });
  });
});
