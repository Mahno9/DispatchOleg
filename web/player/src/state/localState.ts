// Shape must stay in sync with `ClientStatePayload` in server/src/repos/sync.ts —
// the server round-trips this object verbatim and merges gameResults field-by-field.

export interface GameResult {
  bestScore: number;
  won: boolean;
  attempts: number;
  firstCompletedAt: number;
  /** Free-form per-minigame stats from onComplete({ details }), e.g. { styleTag: 'ghost' } */
  details?: Record<string, number | string>;
}

/**
 * Громкость — общая для всей игры настройка игрока, не свойство мини-игры.
 * Живёт здесь же, в prefs: сервер круглит `prefs` как `Record<string, unknown>`
 * (server/src/repos/sync.ts), так что новые поля доезжают без правок бэка.
 */
export interface AudioPrefs {
  muted: boolean;
  /** 0…100 */
  musicVolume: number;
  /** 0…100 */
  sfxVolume: number;
}

export const DEFAULT_AUDIO_PREFS: AudioPrefs = { muted: false, musicVolume: 70, sfxVolume: 100 };

/**
 * У игроков со старой версией в localStorage лежит `prefs: { muted }` без
 * громкостей, а то и мусор — поэтому читаем защищаясь, а не приводим типом.
 */
export function normalizeAudioPrefs(raw: unknown): AudioPrefs {
  const p = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : fallback;
  return {
    muted: p.muted === true,
    musicVolume: num(p.musicVolume, DEFAULT_AUDIO_PREFS.musicVolume),
    sfxVolume: num(p.sfxVolume, DEFAULT_AUDIO_PREFS.sfxVolume),
  };
}

export interface ClientState {
  version: 1;
  updatedAt: number;
  profile: { userId: string; name: string };
  /** Keyed by game id (numeric server id, stringified by JSON). */
  gameResults: Record<string, GameResult>;
  onboarded: boolean;
  prefs: AudioPrefs;
  /** Server-authoritative admin-reset tombstones; we only echo what we were given. */
  removedGames?: Record<string, number>;
}

import { testTarget } from '../testMode';

const STORAGE_KEY = 'dispatch_state';

function createInitialState(): ClientState {
  return {
    version: 1,
    updatedAt: 0,
    profile: { userId: '', name: '' },
    gameResults: {},
    onboarded: false,
    prefs: { ...DEFAULT_AUDIO_PREFS },
  };
}

function isClientState(value: unknown): value is ClientState {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 &&
    typeof v.updatedAt === 'number' &&
    typeof v.profile === 'object' &&
    v.profile !== null &&
    typeof v.gameResults === 'object' &&
    v.gameResults !== null
  );
}

/**
 * Client-side state store backed by localStorage. Exposes a
 * useSyncExternalStore-friendly subscribe/getSnapshot pair: the snapshot
 * reference only changes when the state actually changes, so React can bail
 * out of re-renders safely.
 */
class LocalStateStore {
  private state: ClientState = this.read();
  private readonly listeners = new Set<() => void>();

  private read(): ClientState {
    // Test mode: fresh in-memory state; userId stays '' so syncNow() no-ops.
    // Onboarding is only "not passed" when the onboarding itself is under test.
    if (testTarget) {
      const state = createInitialState();
      state.onboarded = testTarget.kind !== 'onboarding';
      state.profile.name = 'ТЕСТ';
      return state;
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (isClientState(parsed)) {
          const merged = { ...createInitialState(), ...parsed };
          // Слияние поверхностное: у старого состояния prefs — это {muted},
          // и он бы затёр громкости целиком, а не дополнился ими.
          merged.prefs = normalizeAudioPrefs(merged.prefs);
          return merged;
        }
      }
    } catch {
      // Corrupt/unavailable storage — fall through to fresh state.
    }
    return createInitialState();
  }

  private save(): void {
    if (testTarget) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Storage full or unavailable — tolerate silently.
    }
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  private commit(next: ClientState): void {
    this.state = next;
    this.save();
    this.emit();
  }

  // -- useSyncExternalStore contract --
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ClientState => this.state;

  /** Replace the entire state (e.g. after a server-newer sync). Saves + emits. */
  replace(next: ClientState): void {
    // Полезная нагрузка сервера — это `Record<string, unknown>` (см.
    // server/src/repos/sync.ts): у игроков, начавших до появления регулятора,
    // там лежит prefs без громкостей. Без нормализации они прилетели бы как
    // undefined и обнулили бы настройку игрока при первой же синхронизации.
    const prefs = normalizeAudioPrefs(next.prefs);
    const cur = this.state.prefs;
    // Сервер отдаёт свежий объект на каждый ответ, а синк тикает раз в 20 с.
    // MinigameScreen шлёт setVolume по смене ссылки на prefs, поэтому при
    // равных значениях ссылку надо сохранить — иначе игра дёргается каждый
    // тик и локальный mute сбрасывается сам собой.
    const same =
      prefs.muted === cur.muted &&
      prefs.musicVolume === cur.musicVolume &&
      prefs.sfxVolume === cur.sfxVolume;
    this.commit({ ...next, prefs: same ? cur : prefs });
  }

  // -- mutate helpers --

  /**
   * Records one finished attempt at a game. bestScore = max, attempts += 1,
   * won = OR (once won, always won), firstCompletedAt set once, details from
   * the latest attempt. Same rules the server merge uses.
   */
  recordGameResult(
    gameId: number,
    result: { score: number; won: boolean; details?: Record<string, number | string> },
  ): void {
    const now = Date.now();
    const key = String(gameId);
    const prev = this.state.gameResults[key];
    const next: GameResult = {
      bestScore: prev ? Math.max(prev.bestScore, result.score) : result.score,
      won: (prev?.won ?? false) || result.won,
      attempts: (prev?.attempts ?? 0) + 1,
      firstCompletedAt: prev?.firstCompletedAt ?? now,
    };
    const details = result.details ?? prev?.details;
    if (details !== undefined) next.details = details;
    this.commit({
      ...this.state,
      updatedAt: now,
      gameResults: { ...this.state.gameResults, [key]: next },
    });
  }

  setProfile(profile: { userId: string; name: string }): void {
    this.commit({ ...this.state, updatedAt: Date.now(), profile: { ...profile } });
  }

  setOnboarded(onboarded: boolean): void {
    if (this.state.onboarded === onboarded) return;
    this.commit({ ...this.state, updatedAt: Date.now(), onboarded });
  }

  setAudioPrefs(patch: Partial<AudioPrefs>): void {
    const next = normalizeAudioPrefs({ ...this.state.prefs, ...patch });
    const cur = this.state.prefs;
    if (next.muted === cur.muted && next.musicVolume === cur.musicVolume && next.sfxVolume === cur.sfxVolume)
      return;
    this.commit({ ...this.state, updatedAt: Date.now(), prefs: next });
  }
}

export const localState = new LocalStateStore();
