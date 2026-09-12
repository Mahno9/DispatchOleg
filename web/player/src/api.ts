import type { ClientState } from './state/localState';

export interface Character {
  id: number;
  name: string;
  portraitAsset: string | null;
  metaDialogueId: number | null;
  /** Slot name on the meta scene (server stores it as an opaque string). */
  metaPosition: string;
  /** Who the player is talking to. Empty — the portrait carries no info affordance. */
  description: string;
}

/** Meta-screen game entry (GET /api/games — no config, that comes at launch). */
export interface Game {
  id: number;
  title: string;
  minigameId: string;
  isTutorial: boolean;
  /** Финал смены: запускается с экрана победы, а не кодом со стены. */
  isFinale: boolean;
  requiredGameIds: number[];
  sortOrder: number;
  character: Character | null;
}

/** GET /api/games/:id/config — everything needed to run the pre/game/post chain. */
export interface GameConfig {
  id: number;
  title: string;
  minigameId: string;
  config: Record<string, unknown>;
  characterId: number | null;
  preDialogueId: number | null;
  postWinDialogueId: number | null;
  postLoseDialogueId: number | null;
  styleDialogues: Record<string, number>;
}

/** Background of a meta stage. `offset` is in percent of the stage box. */
export interface MetaStageBackground {
  image?: string;
  fit?: 'cover' | 'contain' | 'fill-x' | 'fill-y' | 'center' | 'tile';
  scale?: number;
  offset?: { x: number; y: number };
}

/** One character placed on a stage. x/y are percent of the stage box; the
 *  sprite is anchored by its centre. `dialogueId` overrides `metaDialogueId`. */
export interface MetaStageCharacter {
  characterId: number;
  x: number;
  y: number;
  scale?: number;
  dialogueId?: number | null;
}

/** What has to be true for the stage to be the current one. */
export type MetaStageTrigger =
  { type: 'wonCount'; value: number } | { type: 'games'; ids: number[] };

/** GET /api/meta-stages — the meta scene at a given point of the story. */
export interface MetaStage {
  id: number;
  title: string;
  sortOrder: number;
  background: MetaStageBackground;
  characters: MetaStageCharacter[];
  trigger: MetaStageTrigger;
}

/** GET /api/settings — admin-editable knobs; only the keys we read are typed. */
export interface Settings {
  final_victory_text?: string | null;
  /** Фоновая петля лобби (мета/скан/запуск); null — без музыки. */
  meta_music_url?: string | null;
  /** Щелчок по кнопке: один файл или взвешенный список вариантов из админки. */
  ui_click_sound_url?: string | { url: string; weight?: number; volume?: number }[] | null;
  /** Пресеты бубнежа персонажей: `{ [speakerId]: preset }` (dialogue/voice.ts). */
  character_voices?: unknown;
  /** Сервер запущен с NO_QR=1: операции выдаются жребием, сканер не нужен. */
  no_qr?: boolean;
  /** Период фонового синка в секундах (редактируется в админке). */
  sync_interval_s?: number;
  [key: string]: unknown;
}

export interface Minigame {
  id: string;
  title: string;
  /** null у системных мини-игр (онбординг): бандла для запуска нет. */
  entryUrl: string | null;
  schemaUrl: string;
  defaultConfig?: Record<string, unknown>;
}

export interface SessionUser {
  id: string;
  name: string;
  onboarded: boolean;
}

export interface SessionResponse {
  user: SessionUser;
  state: ServerState | null;
}

/** Minimal shape the player relies on; the server round-trips the rest. */
export interface ServerState {
  updatedAt: number;
  [key: string]: unknown;
}

export type SyncOutcome = 'accepted' | 'merged' | 'server-newer';

export interface SyncResponse {
  outcome: SyncOutcome;
  state: ServerState;
  serverTime: number;
}

export interface VerifiedGame {
  id: number;
  title: string;
  minigameId: string;
  /** The onboarding gate only opens for the tutorial game. */
  isTutorial: boolean;
  /** Финал смены: сканер его отбивает, запуск — только «Закрыть смену». */
  isFinale: boolean;
}

export type QrVerifyResponse =
  | { ok: true; game: VerifiedGame }
  | { ok: false; reason: 'bad-signature' | 'not-found' }
  | { ok: false; reason: 'locked'; requiredTitles: string[] };

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin', ...init });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, (body as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

function post<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Поле `isFinale` появилось позже клиента: на старом сервере его в ответе нет,
 * и без подстановки оно приехало бы как undefined — тогда `!g.isFinale` ещё
 * работает, а `games.find((g) => g.isFinale)` молча вернул бы что угодно из
 * будущих проверок. Нормализуем на границе, один раз.
 */
function withFinaleFlag<T extends { isFinale?: boolean }>(game: T): T & { isFinale: boolean } {
  return { ...game, isFinale: game.isFinale === true };
}

/** То же для ответа сканера: у него игра лежит внутри `ok: true`. */
function withVerifiedFinaleFlag(res: QrVerifyResponse): QrVerifyResponse {
  return res.ok ? { ...res, game: withFinaleFlag(res.game) } : res;
}

export const api = {
  postSession: (name: string) => post<SessionResponse>('/api/session', { name }),
  postSync: (body: { userId: string; state: ClientState }) => post<SyncResponse>('/api/sync', body),
  getGames: () => request<Game[]>('/api/games').then((list) => list.map(withFinaleFlag)),
  getGameConfig: (id: number) => request<GameConfig>(`/api/games/${id}/config`),
  getCharacters: () => request<Character[]>('/api/characters'),
  getMetaStages: () => request<MetaStage[]>('/api/meta-stages'),
  getSettings: () => request<Settings>('/api/settings'),
  getDialogue: (id: number) => request<unknown>(`/api/dialogues/${id}`),
  getMinigames: () => request<Minigame[]>('/api/minigames'),
  verifyQr: (body: { payload: string; userId: string }) =>
    post<QrVerifyResponse>('/api/qr/verify', body).then(withVerifiedFinaleFlag),
};
