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
    });
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
});
