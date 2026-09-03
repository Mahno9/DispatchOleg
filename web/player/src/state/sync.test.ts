import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { localState, type ClientState } from './localState';
import { syncNow } from './sync';

vi.mock('../api', () => ({ api: { postSync: vi.fn() } }));

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
      state: serverPayload({ prefs: { muted: false, musicVolume: 10, sfxVolume: 20 } }),
    } as never);

    await syncNow();

    expect(localState.getSnapshot().prefs).toMatchObject({ musicVolume: 10, sfxVolume: 20 });
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
