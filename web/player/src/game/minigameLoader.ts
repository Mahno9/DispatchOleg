import { api, type Minigame } from '../api';
import { localState } from '../state/localState';

/** Имя игрока, если он ещё не представился, — герой по умолчанию. */
export const DEFAULT_PLAYER_NAME = 'Олег';

/**
 * Подстановка `{player}` во все строки конфига мини-игры: в админке пишут
 * ключевое слово, игрок видит своё имя. Рекурсивно, потому что подставлять надо
 * не только в верхние поля (`playerName`), но и внутрь массивов вроде
 * `tasks[].assignee` — иначе задача «моя» только для того, кого зовут Олегом.
 */
export function fillPlaceholders<T>(value: T, playerName: string): T {
  if (typeof value === 'string') return value.replaceAll('{player}', playerName) as T;
  if (Array.isArray(value)) return value.map((v) => fillPlaceholders(v, playerName)) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, fillPlaceholders(v, playerName)]),
    ) as T;
  return value;
}

export interface MinigameResult {
  score: number;
  won: boolean;
  /** Free-form per-game stats; `styleTag` picks the post-win dialogue branch. */
  details?: Record<string, number | string>;
}

interface LaunchOptions {
  /** Working area of the `minigame` screen — the bottom bar is not part of it. */
  container: HTMLElement;
  gameId: number;
  /** Стартовые значения общего регулятора; дальше — через handle.setVolume. */
  audio: AudioSettingsPatch;
  /** Bottom-bar slot 2 feed. Called any number of times, never terminal. */
  onProgress?: (text: string, percent?: number) => void;
  /** Bottom-bar slot 2 story line (minigame_contract.md). `null` restores the
   *  onProgress string; onDismiss is the game's own — the platform never
   *  clears the slot on its own. */
  onLine?: (text: string | null, onDismiss?: () => void) => void;
  /** Receives the result, or null when the player exited early / on error. */
  onFinished: (result: MinigameResult | null) => void;
}

interface MinigameModule {
  init: (
    container: HTMLElement,
    config: Record<string, unknown>,
    callbacks: {
      onComplete: (result: MinigameResult) => void;
      onExit: () => void;
      onProgress: (text: string, percent?: number) => void;
      onLine?: (text: string | null, onDismiss?: () => void) => void;
    },
  ) => {
    destroy: () => void;
    setPaused?: (paused: boolean) => void;
    setVolume?: (volume: AudioSettingsPatch) => void;
  };
}

export interface MinigameHandle {
  destroy: () => void;
  /** Заморозить/разморозить игру, не разрушая её (minigame_contract.md).
   *  Нет у игр без собственных часов — вызывать через `?.`. */
  setPaused?: (paused: boolean) => void;
  /** Живая громкость из общего регулятора в шапке. Без неё игра просто
   *  останется на значениях, полученных при запуске. */
  setVolume?: (volume: AudioSettingsPatch) => void;
}

/** 0…100 на канал; `muted` глушит оба, не теряя их значений. */
export interface AudioSettingsPatch {
  muted: boolean;
  musicVolume: number;
  sfxVolume: number;
}

let minigamesCache: Minigame[] | null = null;

async function getMinigames(): Promise<Minigame[]> {
  if (!minigamesCache) minigamesCache = await api.getMinigames();
  return minigamesCache;
}

/**
 * Loads the minigame bound to a game and runs it inside `container`.
 * Calls onFinished exactly once (null on exit or destroy) and returns a handle
 * the caller must destroy on unmount. Rejects if the bundle cannot be launched
 * at all — onFinished is then never called and the caller shows the failure.
 */
export async function launchMinigame(opts: LaunchOptions): Promise<MinigameHandle> {
  const { container, gameId, audio, onProgress, onLine, onFinished } = opts;

  let handle: MinigameHandle | null = null;
  let settled = false;

  // Каждый запуск живёт в собственном узле, а не прямо в общем контейнере.
  // Под StrictMode эффект монтируется дважды: отменённый первый запуск
  // дорезолвливается уже ПОСЛЕ того, как второй смонтировал игру, и чистка
  // общего контейнера стирала живую игру — чёрный экран через раз.
  const host = document.createElement('div');
  // Длинные свойства вместо `inset`: узел обязан повторить контейнер пиксель в
  // пиксель, а не схлопнуться по содержимому, — от размера зависит вся вёрстка игры.
  host.style.cssText = 'position:absolute;top:0;right:0;bottom:0;left:0';
  container.appendChild(host);

  function finish(result: MinigameResult | null): void {
    if (settled) {
      console.warn('[minigameLoader] callback fired twice, ignoring');
      return;
    }
    settled = true;
    onFinished(result);
  }

  function destroy(): void {
    try {
      handle?.destroy();
    } catch (err) {
      console.error('[minigameLoader] destroy failed', err);
    }
    handle = null;
    host.remove();
    if (!settled) finish(null);
  }

  try {
    const [gameConfig, minigames] = await Promise.all([api.getGameConfig(gameId), getMinigames()]);
    const meta = minigames.find((m) => m.id === gameConfig.minigameId);
    if (!meta) throw new Error(`Unknown minigame: ${gameConfig.minigameId}`);

    const mod = (await import(/* @vite-ignore */ meta.entryUrl)) as MinigameModule;

    // Effective config = game defaults ⊕ per-game override (top-level keys).
    const config: Record<string, unknown> = fillPlaceholders(
      {
        ...(meta.defaultConfig ?? {}),
        ...gameConfig.config,
        muted: audio.muted,
        musicVolume: audio.musicVolume,
        sfxVolume: audio.sfxVolume,
      },
      localState.getSnapshot().profile.name || DEFAULT_PLAYER_NAME,
    );

    handle = mod.init(host, config, {
      onComplete: (result) => finish(result),
      onExit: () => finish(null),
      onProgress: (text, percent) => onProgress?.(text, percent),
      onLine: (text, onDismiss) => onLine?.(text, onDismiss),
    });
    return {
      destroy,
      setPaused: (paused) => {
        try {
          handle?.setPaused?.(paused);
        } catch (err) {
          console.error('[minigameLoader] setPaused failed', err);
        }
      },
      setVolume: (volume) => {
        try {
          handle?.setVolume?.(volume);
        } catch (err) {
          console.error('[minigameLoader] setVolume failed', err);
        }
      },
    };
  } catch (err) {
    console.error('[minigameLoader] failed to launch minigame', err);
    host.remove();
    throw err;
  }
}
