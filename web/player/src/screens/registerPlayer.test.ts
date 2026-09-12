import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { localState } from '../state/localState';
import { registerPlayer } from './OnboardingScreen';
import { installMemoryLocalStorage } from '../state/memoryStorage';

// Плеер тестируется в node, без DOM: без заглушки флаг показа финала не хранится.
installMemoryLocalStorage();

vi.mock('../api', async (importActual) => ({
  ...(await importActual<typeof import('../api')>()),
  api: { postSession: vi.fn() },
}));

beforeEach(() => {
  vi.mocked(api.postSession).mockReset();
});

/** Прогресс прежнего игрока за этим же терминалом. */
function seedPreviousPlayer(): void {
  localState.startSession({ userId: 'u-old', name: 'ОЛЕГ' });
  localState.setOnboarded(true);
  localState.recordGameResult(2, { score: 42, won: true });
  localState.markDialogueSeen(11);
  localState.markBriefed('safe-crack');
  localState.markVictorySeen();
  localState.setAudioPrefs({ musicVolume: 18, sfxVolume: 19 });
}

describe('registerPlayer', () => {
  // Терминал общий: следующий игрок садится за него с чистого листа.
  it('starts a brand-new player from scratch, device audio prefs aside', async () => {
    seedPreviousPlayer();
    vi.mocked(api.postSession).mockResolvedValue({
      user: { id: 'u-new', name: 'АНЯ', onboarded: false },
      state: null,
    } as never);

    const onboarded = await registerPlayer('АНЯ');

    const s = localState.getSnapshot();
    expect(onboarded).toBe(false);
    expect(s.profile).toEqual({ userId: 'u-new', name: 'АНЯ' });
    expect(s.gameResults).toEqual({});
    expect(s.seenDialogues).toEqual([]);
    expect(s.briefedMinigames).toEqual([]);
    expect(s.onboarded).toBe(false);
    expect(localState.isVictorySeen()).toBe(false);
    expect(s.prefs.musicVolume).toBe(18);
    expect(s.prefs.sfxVolume).toBe(19);
  });

  // Вернувшийся игрок называется тем же именем — сервер узнаёт его и отдаёт
  // прогресс из БД: он ложится поверх чистого состояния, а не поверх чужого.
  it('applies the returning player payload on top of the clean state', async () => {
    seedPreviousPlayer();
    vi.mocked(api.postSession).mockResolvedValue({
      user: { id: 'u-back', name: 'ЛЕНА', onboarded: true },
      state: {
        version: 1,
        updatedAt: Date.now(),
        profile: { userId: 'u-back', name: 'ЛЕНА' },
        gameResults: { '5': { bestScore: 7, won: true, attempts: 1, firstCompletedAt: 1 } },
        onboarded: true,
        seenDialogues: [99],
        briefedMinigames: ['three-mazes'],
      },
    } as never);

    const onboarded = await registerPlayer('ЛЕНА');

    const s = localState.getSnapshot();
    expect(onboarded).toBe(true);
    expect(Object.keys(s.gameResults)).toEqual(['5']);
    expect(s.seenDialogues).toEqual([99]);
    // Отметки прежнего игрока стёрты до наложения payload, а не объединены с ним.
    expect(s.briefedMinigames).toEqual(['three-mazes']);
    expect(s.onboarded).toBe(true);
  });

  // Payload у нового игрока — null, и мусор оттуда принимать тоже нельзя:
  // состояние должно остаться чистым.
  it('ignores a payload that is not an adoptable state', async () => {
    seedPreviousPlayer();
    vi.mocked(api.postSession).mockResolvedValue({
      user: { id: 'u-junk', name: 'ПЁТР', onboarded: false },
      state: { updatedAt: Date.now() },
    } as never);

    await registerPlayer('ПЁТР');

    expect(localState.getSnapshot().gameResults).toEqual({});
    expect(localState.getSnapshot().profile.userId).toBe('u-junk');
  });
});
