import { api, type GameConfig, type Minigame } from '../api';
import { localState } from '../state/localState';

/** Имя игрока, если он ещё не представился, — герой по умолчанию. */
export const DEFAULT_PLAYER_NAME = 'Диспетчер';

/**
 * Подстановка `{player}` во все строки конфига мини-игры: в админке пишут
 * ключевое слово, игрок видит своё имя. Рекурсивно, потому что подставлять надо
 * не только в верхние поля (`playerName`), но и внутрь массивов вроде
 * `tasks[].assignee` — иначе задача «моя» только для того, кого зовут как
 * дефолтного игрока.
 */
export function fillPlaceholders<T>(value: T, playerName: string): T {
  return mapStrings(value, (s) => s.replaceAll('{player}', playerName));
}

/** Та же рекурсия по конфигу, что и у плейсхолдеров: применить `fn` к каждой строке. */
function mapStrings<T>(value: T, fn: (s: string) => string): T {
  if (typeof value === 'string') return fn(value) as T;
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn)) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, mapStrings(v, fn)]),
    ) as T;
  return value;
}

/** Загруженные в админке файлы (звук, картинки) — по этому префиксу их видно в конфиге. */
const ASSET_PREFIX = '/assets-store/';

// Сроки подобраны под медленный, но живой канал мероприятия: обычная загрузка
// укладывается в доли секунды, а зависший запрос больше не держит «Загрузку»
// вечно — игрок видит причину и уходит кнопкой «Выйти».
/** Список мини-игр — маленький JSON. */
const LIST_TIMEOUT_MS = 15_000;
/** Бандл игры — сотни килобайт. */
const BUNDLE_TIMEOUT_MS = 30_000;
/** Один ассет: предзагрузка отпускает старт и без него, поэтому срок щедрый. */
const ASSET_FETCH_TIMEOUT_MS = 20_000;
/** Сколько предзагрузка ассетов может задерживать старт игры. */
const ASSETS_TIMEOUT_MS = 8_000;

export const NET_TIMEOUT_TEXT = 'Сеть не отвечает — список операций не пришёл';
export const BUNDLE_TIMEOUT_TEXT = 'Сеть не отвечает — операция не докачалась';

/**
 * Промис с крайним сроком: не уложился — отказ с русским текстом. Саму работу
 * это не отменяет (динамический `import()` отменить нечем), но экран загрузки
 * перестаёт быть вечным.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export interface PreloadedAssets<T> {
  /** Тот же конфиг, но адреса ассетов заменены на blob: — уже в памяти. */
  config: T;
  /** Освободить память: blob-адреса отзываются, повторно их не открыть. */
  release: () => void;
}

/**
 * Игры создают `new Audio(url)` прямо в момент play(): первый звук каждого вида
 * ждал сети, отсюда задержка. Тянем все ассеты конфига заранее, целиком в
 * память, и отдаём игре blob-адреса — для неё ничего не меняется, а
 * воспроизведение мгновенное. Что не скачалось, остаётся оригинальным адресом:
 * звук тогда опоздает, как раньше, но игра не сломается.
 *
 * Каждый файл со своим сроком: без него зависшая на плохом канале мегабайтная
 * музыка не отпускала бы предзагрузку вообще, и уже скачанные blob-адреса
 * висели бы в памяти до перезагрузки страницы.
 */
export async function preloadAssets<T>(config: T): Promise<PreloadedAssets<T>> {
  const urls = new Set<string>();
  mapStrings(config, (s) => {
    if (s.startsWith(ASSET_PREFIX)) urls.add(s);
    return s;
  });
  const blobs = new Map<string, string>();
  await Promise.all(
    [...urls].map(async (url) => {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(ASSET_FETCH_TIMEOUT_MS) });
        if (res.ok) blobs.set(url, URL.createObjectURL(await res.blob()));
      } catch (err) {
        console.warn('[minigameLoader] asset preload failed', url, err);
      }
    }),
  );
  return {
    config: mapStrings(config, (s) => blobs.get(s) ?? s),
    release: () => {
      for (const blob of blobs.values()) URL.revokeObjectURL(blob);
      blobs.clear();
    },
  };
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
  /** Уже загруженный `GET /api/games/:id/config` — его берёт App перед запуском
   *  цепочки, второй такой же запрос был бы лишним кругом перед стартом. */
  config: GameConfig;
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
  const { container, config: gameConfig, audio, onProgress, onLine, onFinished } = opts;

  let handle: MinigameHandle | null = null;
  let settled = false;
  let releaseAssets: (() => void) | null = null;
  /** Предзагрузка, начатая до старта игры: сорвался запуск — её blob-адреса
   *  всё равно надо отпустить, иначе они висят в памяти до перезагрузки. */
  let pendingPreload: Promise<PreloadedAssets<Record<string, unknown>>> | null = null;

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
    // После destroy игры её элементы Audio уже отпущены — теперь можно
    // отзывать blob-адреса, иначе память под звук висела бы до перезагрузки.
    releaseAssets?.();
    releaseAssets = null;
    host.remove();
    if (!settled) finish(null);
  }

  try {
    const minigames = await withTimeout(getMinigames(), LIST_TIMEOUT_MS, NET_TIMEOUT_TEXT);
    const meta = minigames.find((m) => m.id === gameConfig.minigameId);
    if (!meta) throw new Error(`Unknown minigame: ${gameConfig.minigameId}`);
    // Системная мини-игра (онбординг) бандла не имеет — запускать нечего.
    if (!meta.entryUrl) throw new Error(`Системная операция не запускается: ${meta.id}`);
    const entryUrl = meta.entryUrl;

    // Effective config = game defaults ⊕ per-game override (top-level keys).
    const raw: Record<string, unknown> = fillPlaceholders(
      {
        ...(meta.defaultConfig ?? {}),
        ...gameConfig.config,
        muted: audio.muted,
        musicVolume: audio.musicVolume,
        sfxVolume: audio.sfxVolume,
      },
      localState.getSnapshot().profile.name || DEFAULT_PLAYER_NAME,
    );

    // Бандл и ассеты едут параллельно, но держит старт только бандл: без него
    // запускать нечего, а ассеты — ускорение. Не успели за общий бюджет —
    // игра идёт с сетевыми адресами: первый звук опоздает, как до предзагрузки.
    const preload = preloadAssets(raw);
    pendingPreload = preload;
    const assetsSoon = withTimeout(preload, ASSETS_TIMEOUT_MS, 'assets preload timed out').catch(
      (err: unknown) => {
        console.warn('[minigameLoader] starting without preloaded assets', err);
        // Опоздавшие blob-адреса игре уже не достанутся — отпускаем их сразу.
        void preload.then(
          (late) => late.release(),
          () => {},
        );
        return null;
      },
    );
    const mod = await withTimeout(
      import(/* @vite-ignore */ entryUrl) as Promise<MinigameModule>,
      BUNDLE_TIMEOUT_MS,
      BUNDLE_TIMEOUT_TEXT,
    );
    const assets = await assetsSoon;
    releaseAssets = assets?.release ?? null;
    const config = assets?.config ?? raw;

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
    releaseAssets?.();
    void pendingPreload?.then(
      (late) => late.release(),
      () => {},
    );
    host.remove();
    throw err;
  }
}
