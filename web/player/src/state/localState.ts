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
  /**
   * Голос персонажей (бубнёж) — отдельный канал, а не часть эффектов: реплики
   * звучат поверх всей игры, и их глушат чаще, чем остальной звук. 0…100.
   */
  voiceVolume: number;
  voiceMuted: boolean;
}

export const DEFAULT_AUDIO_PREFS: AudioPrefs = {
  muted: false,
  musicVolume: 70,
  sfxVolume: 100,
  voiceVolume: 100,
  voiceMuted: false,
};

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
    voiceVolume: num(p.voiceVolume, DEFAULT_AUDIO_PREFS.voiceVolume),
    voiceMuted: p.voiceMuted === true,
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
  /** Ids of dialogues the player has read to the end (meta gate on the meta screen). */
  seenDialogues: number[];
  /** `minigameId` игр, чей инструктаж игрок уже закрыл: на повторной попытке
   *  стрелки не показываются сами, но их можно вызвать кнопкой. */
  briefedMinigames: string[];
  /** Server-authoritative admin-reset tombstones; we only echo what we were given. */
  removedGames?: Record<string, number>;
}

import { testTarget } from '../testMode';

const STORAGE_KEY = 'dispatch_state';

/**
 * «Игрок уже видел финал» — одноразовый флаг показа, а не прогресс, поэтому он
 * намеренно живёт вне ClientState и не попадает в контракт синка с сервером.
 * Ключ держим здесь же: сброс состояния игрока обязан гасить и его, а ради
 * одного места сброса лучше один владелец ключа, чем два.
 */
const VICTORY_SEEN_KEY = 'dispatch_victory_seen';

function createInitialState(): ClientState {
  return {
    version: 1,
    updatedAt: 0,
    profile: { userId: '', name: '' },
    gameResults: {},
    onboarded: false,
    prefs: { ...DEFAULT_AUDIO_PREFS },
    seenDialogues: [],
    briefedMinigames: [],
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
 * Годится ли полезная нагрузка сервера на роль состояния клиента. Сервер
 * круглит payload как непрозрачный объект, поэтому проверяем минимум, на
 * который опирается `replace`.
 */
export function isAdoptableState(value: unknown): value is ClientState {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.version === 1 && typeof v.updatedAt === 'number';
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
  /** Отметка о показе победы в тест-режиме: в памяти, мимо localStorage. */
  private testVictorySeen = false;

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
    // `seenDialogues` появилось позже сервера: у игроков, начавших раньше, его
    // в полезной нагрузке просто нет — без подстановки список стал бы undefined.
    const seenDialogues = Array.isArray(next.seenDialogues) ? next.seenDialogues : [];
    // Отметки инструктажа сервер, в отличие от `seenDialogues`, пока не
    // объединяет (server/src/repos/sync.ts): его payload либо не знает поля
    // вовсе, либо несёт список с другого устройства. Принять его как есть
    // значило бы стереть местные отметки и снова показать стрелки — поэтому
    // объединяем на клиенте, пока серверного слияния нет.
    const briefedMinigames = [
      ...new Set([
        ...this.state.briefedMinigames,
        ...(Array.isArray(next.briefedMinigames) ? next.briefedMinigames : []),
      ]),
    ];
    const cur = this.state.prefs;
    // Сервер отдаёт свежий объект на каждый ответ, а синк тикает раз в 20 с.
    // MinigameScreen шлёт setVolume по смене ссылки на prefs, поэтому при
    // равных значениях ссылку надо сохранить — иначе игра дёргается каждый
    // тик и локальный mute сбрасывается сам собой.
    const same =
      prefs.muted === cur.muted &&
      prefs.musicVolume === cur.musicVolume &&
      prefs.sfxVolume === cur.sfxVolume &&
      prefs.voiceVolume === cur.voiceVolume &&
      prefs.voiceMuted === cur.voiceMuted;
    this.commit({ ...next, seenDialogues, briefedMinigames, prefs: same ? cur : prefs });
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

  /**
   * За терминалом играют по очереди: следующий игрок обязан начать с чистого
   * листа, а не унаследовать чужие пройденные игры, прочитанные диалоги и
   * закрытые инструктажи. Поэтому состояние сбрасывается целиком — кроме
   * `prefs`: громкость и mute настраивают под помещение, это свойство
   * устройства, а не игрока.
   *
   * Сброс безусловный и для вернувшегося игрока: он регистрируется тем же
   * именем, сервер отдаёт его прогресс, и вызывающий накладывает этот payload
   * поверх чистого состояния (`replace`).
   */
  startSession(profile: { userId: string; name: string }): void {
    const fresh = createInitialState();
    this.clearVictorySeen();
    this.commit({
      ...fresh,
      updatedAt: Date.now(),
      profile: { ...profile },
      prefs: this.state.prefs,
    });
  }

  /** Игрока больше нет (404 от сервера): чистим всё, кроме настроек устройства. */
  clearSession(): void {
    this.startSession({ userId: '', name: '' });
  }

  /** Экран победы уже показан этому игроку? */
  isVictorySeen(): boolean {
    if (testTarget) return this.testVictorySeen;
    try {
      return localStorage.getItem(VICTORY_SEEN_KEY) === '1';
    } catch {
      return false;
    }
  }

  /**
   * Отметить показ победы. В тестовом режиме реальный флаг терминала не
   * трогаем — отметка живёт в памяти экземпляра, как и весь тестовый прогон:
   * тестировщик победу видит, но она не зацикливается на мете и не переживает
   * перезагрузку страницы.
   */
  markVictorySeen(): void {
    if (testTarget) {
      this.testVictorySeen = true;
      return;
    }
    try {
      localStorage.setItem(VICTORY_SEEN_KEY, '1');
    } catch {
      // Storage full or unavailable — tolerate silently.
    }
  }

  /** Снять отметку: полного прохождения больше нет — победа взведена заново. */
  clearVictorySeen(): void {
    if (testTarget) {
      this.testVictorySeen = false;
      return;
    }
    try {
      localStorage.removeItem(VICTORY_SEEN_KEY);
    } catch {
      // Storage unavailable — tolerate silently.
    }
  }

  setOnboarded(onboarded: boolean): void {
    if (this.state.onboarded === onboarded) return;
    this.commit({ ...this.state, updatedAt: Date.now(), onboarded });
  }

  /** Диалог дочитан до конца. Повтор — no-op: лишний commit дёргает ре-рендер
   *  и без нужды двигает updatedAt, из-за чего синк считал бы состояние свежее. */
  markDialogueSeen(id: number): void {
    if (this.state.seenDialogues.includes(id)) return;
    this.commit({
      ...this.state,
      updatedAt: Date.now(),
      seenDialogues: [...this.state.seenDialogues, id],
    });
  }

  /** Инструктаж по игре закрыт. Повтор — no-op, как и у `markDialogueSeen`. */
  markBriefed(minigameId: string): void {
    if (this.state.briefedMinigames.includes(minigameId)) return;
    this.commit({
      ...this.state,
      updatedAt: Date.now(),
      briefedMinigames: [...this.state.briefedMinigames, minigameId],
    });
  }

  setAudioPrefs(patch: Partial<AudioPrefs>): void {
    const next = normalizeAudioPrefs({ ...this.state.prefs, ...patch });
    const cur = this.state.prefs;
    if (
      next.muted === cur.muted &&
      next.musicVolume === cur.musicVolume &&
      next.sfxVolume === cur.sfxVolume &&
      next.voiceVolume === cur.voiceVolume &&
      next.voiceMuted === cur.voiceMuted
    )
      return;
    this.commit({ ...this.state, updatedAt: Date.now(), prefs: next });
  }
}

export const localState = new LocalStateStore();
