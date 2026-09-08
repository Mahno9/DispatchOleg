import { describe, expect, it } from 'vitest';
import { DEFAULT_AUDIO_PREFS, localState, normalizeAudioPrefs } from './localState';

describe('normalizeAudioPrefs', () => {
  // У игроков, начавших до появления регулятора, в localStorage лежит
  // prefs: { muted } без громкостей — они обязаны получить дефолты, а не NaN.
  it('fills volumes in for the legacy muted-only shape', () => {
    expect(normalizeAudioPrefs({ muted: true })).toEqual({
      muted: true,
      musicVolume: DEFAULT_AUDIO_PREFS.musicVolume,
      sfxVolume: DEFAULT_AUDIO_PREFS.sfxVolume,
      voiceVolume: DEFAULT_AUDIO_PREFS.voiceVolume,
      voiceMuted: DEFAULT_AUDIO_PREFS.voiceMuted,
    });
  });

  // Голос появился ещё позже громкостей: у тех, кто уже двигал музыку и
  // эффекты, в prefs нет voiceVolume/voiceMuted — голос обязан звучать, а не
  // молчать на undefined.
  it('fills the voice channel in for prefs saved before it existed', () => {
    const p = normalizeAudioPrefs({ muted: false, musicVolume: 40, sfxVolume: 55 });
    expect(p).toEqual({
      muted: false,
      musicVolume: 40,
      sfxVolume: 55,
      voiceVolume: 100,
      voiceMuted: false,
    });
  });

  it('clamps and rounds the voice volume the same way', () => {
    expect(normalizeAudioPrefs({ voiceVolume: 150 }).voiceVolume).toBe(100);
    expect(normalizeAudioPrefs({ voiceVolume: -5 }).voiceVolume).toBe(0);
    expect(normalizeAudioPrefs({ voiceVolume: 42.6 }).voiceVolume).toBe(43);
    expect(normalizeAudioPrefs({ voiceVolume: 'громко' }).voiceVolume).toBe(100);
  });

  it('treats only a real true as voiceMuted', () => {
    expect(normalizeAudioPrefs({ voiceMuted: 'yes' }).voiceMuted).toBe(false);
    expect(normalizeAudioPrefs({ voiceMuted: 1 }).voiceMuted).toBe(false);
    expect(normalizeAudioPrefs({ voiceMuted: true }).voiceMuted).toBe(true);
  });

  it('clamps to 0…100 and rounds', () => {
    expect(normalizeAudioPrefs({ musicVolume: 150, sfxVolume: -20 })).toMatchObject({
      musicVolume: 100,
      sfxVolume: 0,
    });
    expect(normalizeAudioPrefs({ musicVolume: 42.6 })).toMatchObject({ musicVolume: 43 });
  });

  it('falls back to defaults on junk', () => {
    for (const junk of [null, undefined, 'нет', 42, { musicVolume: 'громко' }, { sfxVolume: NaN }]) {
      const p = normalizeAudioPrefs(junk);
      expect(p.musicVolume).toBe(DEFAULT_AUDIO_PREFS.musicVolume);
      expect(p.sfxVolume).toBe(DEFAULT_AUDIO_PREFS.sfxVolume);
      expect(p.muted).toBe(false);
    }
  });

  it('treats only a real true as muted', () => {
    expect(normalizeAudioPrefs({ muted: 'yes' }).muted).toBe(false);
    expect(normalizeAudioPrefs({ muted: 1 }).muted).toBe(false);
    expect(normalizeAudioPrefs({ muted: true }).muted).toBe(true);
  });
});

describe('markDialogueSeen', () => {
  it('records an id once and leaves updatedAt alone on a repeat', () => {
    localState.markDialogueSeen(101);
    expect(localState.getSnapshot().seenDialogues).toContain(101);

    const before = localState.getSnapshot();
    localState.markDialogueSeen(101);
    // Тот же объект состояния: повторная отметка не должна дёргать ре-рендер
    // и двигать updatedAt, иначе синк считает локальное состояние свежее.
    expect(localState.getSnapshot()).toBe(before);

    localState.markDialogueSeen(102);
    expect(localState.getSnapshot().seenDialogues).toEqual([...before.seenDialogues, 102]);
  });
});

describe('markBriefed', () => {
  it('records a minigame once and leaves updatedAt alone on a repeat', () => {
    localState.markBriefed('safe-crack');
    expect(localState.getSnapshot().briefedMinigames).toContain('safe-crack');

    const before = localState.getSnapshot();
    localState.markBriefed('safe-crack');
    expect(localState.getSnapshot()).toBe(before);

    localState.markBriefed('tetris-fill');
    expect(localState.getSnapshot().briefedMinigames).toEqual([
      ...before.briefedMinigames,
      'tetris-fill',
    ]);
  });

  // Сервер (пока) не объединяет эти отметки, как seenDialogues: его ответ либо
  // не знает поля вовсе, либо несёт список с другого устройства. Принять его
  // как есть значило бы снова показать инструктаж по уже пройденной игре.
  it('survives a server payload that does not know the field', () => {
    localState.markBriefed('three-mazes');
    localState.replace({
      ...localState.getSnapshot(),
      updatedAt: Date.now() + 1000,
      briefedMinigames: undefined as unknown as string[],
    });
    expect(localState.getSnapshot().briefedMinigames).toContain('three-mazes');
  });

  it('unions the server list with the local one', () => {
    localState.markBriefed('cooking-orders');
    localState.replace({
      ...localState.getSnapshot(),
      updatedAt: Date.now() + 1000,
      briefedMinigames: ['task-sort', 'cooking-orders'],
    });
    const out = localState.getSnapshot().briefedMinigames;
    expect(out).toContain('cooking-orders');
    expect(out).toContain('task-sort');
    // Объединение, а не склейка: дублей быть не должно.
    expect(out.filter((id) => id === 'cooking-orders')).toHaveLength(1);
  });
});

describe('setAudioPrefs', () => {
  // MinigameScreen шлёт setVolume по изменению ссылки на prefs. Если бы стор
  // коммитил на каждый вызов, игра дёргалась бы на ровном месте.
  it('keeps the snapshot reference when nothing actually changes', () => {
    localState.setAudioPrefs({ musicVolume: 55 });
    const before = localState.getSnapshot();
    localState.setAudioPrefs({ musicVolume: 55 });
    expect(localState.getSnapshot()).toBe(before);
  });

  it('replaces the snapshot when a value changes', () => {
    localState.setAudioPrefs({ sfxVolume: 30 });
    const before = localState.getSnapshot();
    localState.setAudioPrefs({ sfxVolume: 31 });
    const after = localState.getSnapshot();
    expect(after).not.toBe(before);
    expect(after.prefs.sfxVolume).toBe(31);
    expect(after.prefs.musicVolume).toBe(before.prefs.musicVolume);
  });

  it('normalises what it stores', () => {
    localState.setAudioPrefs({ musicVolume: 999 });
    expect(localState.getSnapshot().prefs.musicVolume).toBe(100);
  });

  // Голос — свой канал: его правка обязана доехать до снимка и не задеть
  // соседние громкости, а повтор того же значения — не дёргать ссылку.
  it('stores the voice channel independently of the others', () => {
    localState.setAudioPrefs({ voiceVolume: 50, voiceMuted: false });
    const before = localState.getSnapshot();
    expect(before.prefs.voiceVolume).toBe(50);

    localState.setAudioPrefs({ voiceVolume: 50 });
    expect(localState.getSnapshot()).toBe(before);

    localState.setAudioPrefs({ voiceMuted: true });
    const after = localState.getSnapshot();
    expect(after).not.toBe(before);
    expect(after.prefs.voiceMuted).toBe(true);
    expect(after.prefs.voiceVolume).toBe(50);
    expect(after.prefs.sfxVolume).toBe(before.prefs.sfxVolume);
    expect(after.prefs.musicVolume).toBe(before.prefs.musicVolume);
  });
});
