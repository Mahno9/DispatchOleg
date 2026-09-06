import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AudioPanel } from './AudioSettings';
import { DEFAULT_AUDIO_PREFS, type AudioPrefs } from '../state/localState';

// В плеере нет DOM-окружения (vitest в node, без jsdom): проверяем разметку
// через SSR — эффекты не тикают, но состав панели и проводка пропсов видны.
function html(prefs: Partial<AudioPrefs> = {}): string {
  return renderToStaticMarkup(<AudioPanel prefs={{ ...DEFAULT_AUDIO_PREFS, ...prefs }} />);
}

describe('AudioPanel', () => {
  it('рисует три канала: музыку, эффекты и голос', () => {
    const out = html();
    expect(out).toContain('Музыка');
    expect(out).toContain('Эффекты');
    expect(out).toContain('Голос');
    expect(out.match(/type="range"/g)?.length).toBe(3);
  });

  it('ползунок голоса показывает свою громкость, а не громкость эффектов', () => {
    const out = html({ voiceVolume: 35, sfxVolume: 90 });
    expect(out).toContain('id="audio-voice" type="range" min="0" max="100" step="5" value="35"');
    expect(out).toContain('id="audio-sfx" type="range" min="0" max="100" step="5" value="90"');
  });

  it('у голоса свой мьют, у музыки и эффектов — нет', () => {
    // Одна кнопка мьюта на всю панель, и она в строке голоса.
    expect(html().match(/class="audio-mute /g)?.length).toBe(1);
    expect(html()).toContain('aria-label="Выключить голос"');
    expect(html({ voiceMuted: true })).toContain('aria-label="Включить голос"');
    expect(html({ voiceMuted: true })).toContain('audio-mute audio-mute-off');
  });

  it('замьюченный голос гасит свою строку, музыку и эффекты не трогает', () => {
    const out = html({ voiceMuted: true });
    // Ровно одна погашенная строка — голосовая.
    expect(out.match(/audio-row audio-row-off/g)?.length).toBe(1);
    // Общий мьют гасит все три.
    expect(html({ muted: true }).match(/audio-row audio-row-off/g)?.length).toBe(3);
  });
});
