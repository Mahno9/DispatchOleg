import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NET_TIMEOUT_TEXT, launchMinigame, withTimeout } from './minigameLoader';
import { api, type GameConfig, type Minigame } from '../api';

// Свой файл, как и у системной мини-игры: список мини-игр кэшируется на модуль,
// и тест с зависшим запросом обязан идти до того, как кэш кем-то заполнен.
vi.mock('../api', () => ({
  api: { getMinigames: vi.fn() },
}));

const DEMO: GameConfig = {
  id: 1,
  title: 'Т',
  minigameId: 'demo',
  config: { music: '/assets-store/m.ogg' },
  characterId: null,
  preDialogueId: null,
  postWinDialogueId: null,
  postLoseDialogueId: null,
  styleDialogues: {},
};

const AUDIO = { muted: false, musicVolume: 70, sfxVolume: 100 };

/** Заглушка document: DOM-раннера (jsdom) в этом воркспейсе нет. */
function stubDocument(): void {
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({ style: {}, remove: vi.fn() }),
  };
}

describe('withTimeout', () => {
  afterEach(() => vi.useRealTimers());

  it('пропускает успевший результат', async () => {
    await expect(withTimeout(Promise.resolve(7), 1000, 'поздно')).resolves.toBe(7);
  });

  it('сдаётся русским текстом, а не висит вечно', async () => {
    vi.useFakeTimers();
    const stuck = withTimeout(new Promise<number>(() => {}), 1000, 'поздно');
    const assertion = expect(stuck).rejects.toThrow('поздно');
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });
});

describe('launchMinigame — сроки', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubDocument();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { document?: unknown }).document;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // Зависший запрос держал экран «Загрузка» бесконечно: ни ошибки, ни выхода.
  it('не ждёт зависший список операций вечно', async () => {
    vi.mocked(api.getMinigames).mockReturnValue(new Promise<Minigame[]>(() => {}));
    const launch = launchMinigame({
      container: { appendChild: vi.fn() } as unknown as HTMLElement,
      config: DEMO,
      audio: AUDIO,
      onFinished: vi.fn(),
    });
    const assertion = expect(launch).rejects.toThrow(NET_TIMEOUT_TEXT);
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
  });

  // Мегабайтная музыка на плохом канале не должна держать уже загруженный
  // бандл: игра идёт с сетевым адресом, звук опоздает — как до предзагрузки.
  it('стартует без ассетов, если они не успели', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Ассет висит навсегда; всё остальное на месте.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    vi.mocked(api.getMinigames).mockResolvedValue([
      {
        id: 'demo',
        title: 'Demo',
        entryUrl: new URL('./__fixtures__/echoConfigMinigame.ts', import.meta.url).href,
        schemaUrl: '',
      },
    ]);

    const onProgress = vi.fn();
    const launch = launchMinigame({
      container: { appendChild: vi.fn() } as unknown as HTMLElement,
      config: DEMO,
      audio: AUDIO,
      onProgress,
      onFinished: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(8_000);
    await launch;

    // Фикстура возвращает адрес музыки из конфига, с которым её запустили.
    expect(onProgress).toHaveBeenCalledWith('/assets-store/m.ogg', undefined);
  });
});
