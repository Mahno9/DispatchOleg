import { api, type Minigame } from '../api';

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
  muted: boolean;
  /** Bottom-bar slot 2 feed. Called any number of times, never terminal. */
  onProgress?: (text: string, percent?: number) => void;
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
    },
  ) => { destroy: () => void; setPaused?: (paused: boolean) => void };
}

export interface MinigameHandle {
  destroy: () => void;
  /** Заморозить/разморозить игру, не разрушая её (minigame_contract.md).
   *  Нет у игр без собственных часов — вызывать через `?.`. */
  setPaused?: (paused: boolean) => void;
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
  const { container, gameId, muted, onProgress, onFinished } = opts;

  let handle: MinigameHandle | null = null;
  let settled = false;

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
    container.replaceChildren();
    if (!settled) finish(null);
  }

  try {
    const [gameConfig, minigames] = await Promise.all([api.getGameConfig(gameId), getMinigames()]);
    const meta = minigames.find((m) => m.id === gameConfig.minigameId);
    if (!meta) throw new Error(`Unknown minigame: ${gameConfig.minigameId}`);

    const mod = (await import(/* @vite-ignore */ meta.entryUrl)) as MinigameModule;

    // Effective config = game defaults ⊕ per-game override (top-level keys).
    const config: Record<string, unknown> = {
      ...(meta.defaultConfig ?? {}),
      ...gameConfig.config,
      muted,
    };

    handle = mod.init(container, config, {
      onComplete: (result) => finish(result),
      onExit: () => finish(null),
      onProgress: (text, percent) => onProgress?.(text, percent),
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
    };
  } catch (err) {
    console.error('[minigameLoader] failed to launch minigame', err);
    container.replaceChildren();
    throw err;
  }
}
