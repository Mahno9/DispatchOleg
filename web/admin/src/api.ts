// ---------------------------------------------------------------------------
// DTOs — mirror server/src/repos/* and server/src/routes/*
// ---------------------------------------------------------------------------

export interface Settings {
  ui_click_sound_url: { url: string; weight: number; volume?: number }[] | string | null;
  sync_interval_s: number;
  /** Текст, показываемый игроку после прохождения всех игр. */
  final_victory_text: string | null;
}

export interface Asset {
  id: string;
  url: string;
  kind: 'image' | 'audio' | 'gif';
  originalName: string;
  sizeBytes: number;
}

export interface Minigame {
  id: string;
  title: string;
  entryUrl: string;
  schemaUrl: string;
  defaultConfig?: Record<string, unknown>;
}

export interface Game {
  id: number;
  title: string;
  minigameId: string;
  config: Record<string, unknown>;
  characterId: number | null;
  preDialogueId: number | null;
  postWinDialogueId: number | null;
  postLoseDialogueId: number | null;
  /** styleTag → dialogue id (post-win branch on onComplete details.styleTag) */
  styleDialogues: Record<string, number>;
  requiredGameIds: number[];
  sortOrder: number;
  isTutorial: boolean;
}

export type GameInput = Partial<Omit<Game, 'id'>>;

export interface Character {
  id: number;
  name: string;
  portraitAsset: string | null;
  metaDialogueId: number | null;
  metaPosition: string;
}

export type CharacterInput = Partial<Omit<Character, 'id'>>;

export interface DialogueChoice {
  text: string;
  next: string;
}

export interface DialogueNode {
  speaker: string;
  side: 'left' | 'right';
  text: string;
  next?: string | null;
  choices?: DialogueChoice[] | null;
}

export interface DialogueDoc {
  start: string;
  nodes: Record<string, DialogueNode>;
}

export interface Dialogue {
  id: number;
  title: string;
  nodes: unknown;
}

// --- Мета-этапы -------------------------------------------------------------

export interface MetaStageBackground {
  image?: string;
  fit?: 'cover' | 'contain' | 'fill-x' | 'fill-y' | 'center' | 'tile';
  scale?: number;
  offset?: { x: number; y: number };
}

/** x/y — проценты от бокса сцены; якорь спрайта — его центр. */
export interface MetaStageCharacter {
  characterId: number;
  x: number;
  y: number;
  scale?: number;
  dialogueId?: number | null;
}

export type MetaStageTrigger =
  | { type: 'wonCount'; value: number }
  | { type: 'games'; ids: number[] };

export interface MetaStage {
  id: number;
  title: string;
  sortOrder: number;
  background: MetaStageBackground;
  characters: MetaStageCharacter[];
  trigger: MetaStageTrigger;
}

export type MetaStageInput = Partial<Omit<MetaStage, 'id'>>;

export interface GameResult {
  bestScore: number;
  won: boolean;
  attempts: number;
  firstCompletedAt: number;
  rewardGranted?: boolean;
  details?: Record<string, number | string>;
}

export interface AdminUser {
  id: string;
  name: string;
  onboarded: boolean;
  createdAt: number;
  syncedAt: number | null;
  gameResults: Record<string, GameResult>;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const merged: RequestInit = { credentials: 'same-origin', ...init };
  if (init?.body) {
    merged.headers = { 'Content-Type': 'application/json', ...init.headers };
  }
  const res = await fetch(url, merged);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, (body as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  login: (login: string, password: string) =>
    request<{ ok: true }>('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ login, password }),
    }),
  logout: () => request<{ ok: true }>('/api/admin/logout', { method: 'POST' }),
  me: () => request<{ ok: true }>('/api/admin/me'),

  getSettings: () => request<Settings>('/api/settings'),
  updateSettings: (patch: Partial<Settings>) =>
    request<Settings>('/api/admin/settings', { method: 'PUT', body: JSON.stringify(patch) }),

  getMinigames: () => request<Minigame[]>('/api/minigames'),
  updateMinigameDefaults: (id: string, config: Record<string, unknown>) =>
    request<{ ok: true }>(`/api/admin/minigames/${id}/defaults`, {
      method: 'PUT',
      body: JSON.stringify({ config }),
    }),

  getGames: () => request<Game[]>('/api/admin/games'),
  createGame: (body: GameInput & { title: string; minigameId: string }) =>
    request<Game>('/api/admin/games', { method: 'POST', body: JSON.stringify(body) }),
  updateGame: (id: number, body: GameInput) =>
    request<Game>(`/api/admin/games/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteGame: (id: number) =>
    request<{ ok: true }>(`/api/admin/games/${id}`, { method: 'DELETE' }),
  qrUrl: (id: number) => `/api/admin/games/${id}/qr.svg`,

  getCharacters: () => request<Character[]>('/api/characters'),
  createCharacter: (body: CharacterInput & { name: string }) =>
    request<Character>('/api/admin/characters', { method: 'POST', body: JSON.stringify(body) }),
  updateCharacter: (id: number, body: CharacterInput) =>
    request<Character>(`/api/admin/characters/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteCharacter: (id: number) =>
    request<{ ok: true }>(`/api/admin/characters/${id}`, { method: 'DELETE' }),

  getDialogues: () => request<{ id: number; title: string }[]>('/api/dialogues'),
  getDialogue: (id: number) => request<Dialogue>(`/api/dialogues/${id}`),
  createDialogue: (title: string, nodes: unknown = {}) =>
    request<Dialogue>('/api/admin/dialogues', {
      method: 'POST',
      body: JSON.stringify({ title, nodes }),
    }),
  updateDialogue: (id: number, body: { title?: string; nodes?: unknown }) =>
    request<Dialogue>(`/api/admin/dialogues/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteDialogue: (id: number) =>
    request<{ ok: true }>(`/api/admin/dialogues/${id}`, { method: 'DELETE' }),

  getMetaStages: () => request<MetaStage[]>('/api/meta-stages'),
  createMetaStage: (body: MetaStageInput & { title: string }) =>
    request<MetaStage>('/api/admin/meta-stages', { method: 'POST', body: JSON.stringify(body) }),
  updateMetaStage: (id: number, body: MetaStageInput) =>
    request<MetaStage>(`/api/admin/meta-stages/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteMetaStage: (id: number) =>
    request<{ ok: true }>(`/api/admin/meta-stages/${id}`, { method: 'DELETE' }),

  getUsers: () => request<AdminUser[]>('/api/admin/users'),
  resetUserGame: (userId: string, gameId: number) =>
    request<{ ok: true }>(`/api/admin/users/${userId}/reset`, {
      method: 'POST',
      body: JSON.stringify({ gameId }),
    }),
  deleteUser: (userId: string) =>
    request<{ ok: true }>(`/api/admin/users/${userId}`, { method: 'DELETE' }),

  getAssets: () => request<Asset[]>('/api/admin/assets'),
  deleteAsset: (id: string) =>
    request<{ ok: true }>(`/api/admin/assets/${id}`, { method: 'DELETE' }),
  uploadAsset: async (file: File): Promise<Asset> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/admin/assets', {
      method: 'POST',
      credentials: 'same-origin',
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(res.status, (body as { error?: string }).error ?? res.statusText);
    }
    const data = (await res.json()) as { accepted: Asset[]; rejected: string[] };
    const first = data.accepted[0];
    if (!first) {
      throw new ApiError(
        415,
        `Файл отклонён: ${data.rejected.join(', ') || 'неподдерживаемый формат'}`,
      );
    }
    return first;
  },
};
