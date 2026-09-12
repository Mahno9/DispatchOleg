import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../api';
import { localState, type ClientState } from './localState';
import { getConnectivitySnapshot, syncNow } from './sync';
import { installMemoryLocalStorage } from './memoryStorage';

// Плеер тестируется в node, без DOM: без заглушки флаг показа финала не хранится.
installMemoryLocalStorage();

// ApiError настоящий: по нему синк отличает «игрока нет» от обрыва связи.
vi.mock('../api', async (importActual) => ({
  ...(await importActual<typeof import('../api')>()),
  api: { postSync: vi.fn() },
}));

/** Ответ сервера строится как обычный JSON — свежий объект на каждый вызов. */
function serverPayload(overrides: Partial<ClientState> = {}): ClientState {
  return JSON.parse(
    JSON.stringify({ ...localState.getSnapshot(), ...overrides }),
  ) as ClientState;
}

beforeEach(() => {
  vi.mocked(api.postSync).mockReset();
  localState.setProfile({ userId: 'u1', name: 'ОЛЕГ' });
  localState.setAudioPrefs({ muted: false, musicVolume: 70, sfxVolume: 100 });
});

describe('syncNow adopting the server payload', () => {
  // Сервер круглит prefs как непрозрачный объект, поэтому у игроков, начавших
  // до появления регулятора, оттуда приезжает { muted } без громкостей.
  it('normalises legacy prefs instead of writing undefined volumes', async () => {
    vi.mocked(api.postSync).mockResolvedValue({
      outcome: 'server-newer',
      state: serverPayload({ prefs: { muted: true } as never }),
    } as never);

    await syncNow();

    const prefs = localState.getSnapshot().prefs;
    expect(prefs.muted).toBe(true);
    expect(prefs.musicVolume).toBe(70);
    expect(prefs.sfxVolume).toBe(100);
  });

  // MinigameScreen шлёт setVolume по смене ссылки. Синк тикает раз в 20 с и на
  // равных значениях обязан ссылку сохранить, иначе игра дёргается впустую и
  // локальный mute сбрасывается сам собой.
  it('keeps the prefs reference when the server echoes the same values', async () => {
    const before = localState.getSnapshot().prefs;
    vi.mocked(api.postSync).mockResolvedValue({
      outcome: 'server-newer',
      state: serverPayload(),
    } as never);

    await syncNow();

    expect(localState.getSnapshot().prefs).toBe(before);
  });

  it('still adopts a genuinely different value', async () => {
    vi.mocked(api.postSync).mockResolvedValue({
      outcome: 'server-newer',
      state: serverPayload({
        prefs: { muted: false, musicVolume: 10, sfxVolume: 20, voiceVolume: 30, voiceMuted: true },
      }),
    } as never);

    await syncNow();

    expect(localState.getSnapshot().prefs).toMatchObject({
      musicVolume: 10,
      sfxVolume: 20,
      voiceVolume: 30,
      voiceMuted: true,
    });
  });

  // Ползунок, сдвинутый пока запрос был в полёте, не должен откатываться
  // ответом, который построен на устаревшем снимке.
  it('drops a stale response when local state changed mid-flight', async () => {
    const stale = serverPayload();
    vi.mocked(api.postSync).mockImplementation(async () => {
      localState.setAudioPrefs({ musicVolume: 20 });
      return { outcome: 'server-newer', state: stale } as never;
    });

    await syncNow();

    expect(localState.getSnapshot().prefs.musicVolume).toBe(20);
  });
});

describe('syncNow when the server does not know the player', () => {
  beforeEach(() => {
    localState.setOnboarded(true);
  });

  // Базу пересоздали / игрока стёрли в админке: POST /api/sync отдаёт 404.
  // Раньше это ловил общий catch — терминал навсегда оставался в OFFLINE и
  // молчал. Теперь профиль чистится, и App уводит игрока на онбординг.
  it('clears the profile and sends the player back to onboarding on 404', async () => {
    vi.mocked(api.postSync).mockRejectedValue(new ApiError(404, 'user not found'));

    await syncNow();

    expect(localState.getSnapshot().profile.userId).toBe('');
    expect(localState.getSnapshot().onboarded).toBe(false);
    // Сервер ответил — связь есть, вечного OFFLINE быть не должно.
    expect(getConnectivitySnapshot()).toBe(true);
  });

  // Прогресса на сервере больше нет, а за терминалом играют по очереди:
  // остатки результатов и отметок достались бы следующему игроку.
  it('wipes the whole progress but keeps the device audio prefs', async () => {
    localState.recordGameResult(4, { score: 9, won: true });
    localState.markDialogueSeen(303);
    localState.markBriefed('task-sort');
    localState.setAudioPrefs({ musicVolume: 25 });
    localState.markVictorySeen();
    vi.mocked(api.postSync).mockRejectedValue(new ApiError(404, 'user not found'));

    await syncNow();

    const s = localState.getSnapshot();
    expect(s.gameResults).toEqual({});
    expect(s.seenDialogues).toEqual([]);
    expect(s.briefedMinigames).toEqual([]);
    expect(localState.isVictorySeen()).toBe(false);
    expect(s.prefs.musicVolume).toBe(25);
  });

  it('keeps the session and goes OFFLINE on a real network error', async () => {
    vi.mocked(api.postSync).mockRejectedValue(new TypeError('Failed to fetch'));

    await syncNow();

    expect(localState.getSnapshot().profile.userId).toBe('u1');
    expect(localState.getSnapshot().onboarded).toBe(true);
    expect(getConnectivitySnapshot()).toBe(false);
  });

  it('keeps the session on a server error that is not 404', async () => {
    vi.mocked(api.postSync).mockRejectedValue(new ApiError(500, 'boom'));

    await syncNow();

    expect(localState.getSnapshot().profile.userId).toBe('u1');
    expect(getConnectivitySnapshot()).toBe(false);
  });
});
