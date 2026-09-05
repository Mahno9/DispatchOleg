import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClickSound, normalizeClickSound } from './useClickSound';
import { DEFAULT_AUDIO_PREFS, type AudioPrefs } from '../state/localState';

// В плеере нет DOM-окружения (vitest в node, без jsdom), поэтому элемент
// подставляем заглушкой — как в useLobbyMusic.test.ts.
class FakeAudio {
  static nodes: FakeAudio[] = [];
  static rejectNext = false;
  paused = true;
  preload = '';
  volume = 1;
  currentTime = 7;
  plays = 0;
  constructor(public src: string) {
    FakeAudio.nodes.push(this);
  }
  play(): Promise<void> {
    this.plays++;
    if (FakeAudio.rejectNext) {
      FakeAudio.rejectNext = false;
      return Promise.reject(new Error('autoplay blocked'));
    }
    this.paused = false;
    return Promise.resolve();
  }
  cloneNode(): FakeAudio {
    const copy = new FakeAudio(this.src);
    copy.preload = this.preload;
    return copy;
  }
}

const prefs = (over: Partial<AudioPrefs> = {}): AudioPrefs => ({ ...DEFAULT_AUDIO_PREFS, ...over });

beforeEach(() => {
  FakeAudio.nodes = [];
  FakeAudio.rejectNext = false;
  vi.stubGlobal('Audio', FakeAudio);
});
afterEach(() => vi.unstubAllGlobals());

describe('click sound: нормализация', () => {
  it('строка — единственный вариант с полной громкостью', () => {
    expect(normalizeClickSound('/assets-store/click.ogg')).toEqual([
      { url: '/assets-store/click.ogg', weight: 1, volume: 100 },
    ]);
  });

  it('список — веса и громкости, с починкой пропусков', () => {
    expect(
      normalizeClickSound([
        { url: '/a.ogg', weight: 3, volume: 50 },
        { url: '/b.ogg' },
        { url: '/c.ogg', weight: 0, volume: 0 },
        { url: '/d.ogg', volume: 999 },
      ]),
    ).toEqual([
      { url: '/a.ogg', weight: 3, volume: 50 },
      { url: '/b.ogg', weight: 1, volume: 100 },
      // Нулевой вес — не «никогда», а «как все»; нулевая громкость — тишина.
      { url: '/c.ogg', weight: 1, volume: 0 },
      { url: '/d.ogg', weight: 1, volume: 200 },
    ]);
  });

  it('null, пустая строка и мусор — вариантов нет', () => {
    expect(normalizeClickSound(null)).toEqual([]);
    expect(normalizeClickSound(undefined)).toEqual([]);
    expect(normalizeClickSound('')).toEqual([]);
    expect(normalizeClickSound(42)).toEqual([]);
    expect(normalizeClickSound({ url: '/a.ogg' })).toEqual([]);
    expect(normalizeClickSound([])).toEqual([]);
    expect(normalizeClickSound([null, { weight: 2 }, { url: 5 }])).toEqual([]);
  });
});

describe('click sound: выбор варианта', () => {
  it('взвешенный выбор детерминирован при фиксированном random', () => {
    const sound = createClickSound([
      { url: '/a.ogg', weight: 3 },
      { url: '/b.ogg', weight: 1 },
    ]);
    // Сумма весов 4: первые три четверти — /a.ogg, последняя — /b.ogg.
    expect(sound.pick(0)?.url).toBe('/a.ogg');
    expect(sound.pick(0.74)?.url).toBe('/a.ogg');
    expect(sound.pick(0.76)?.url).toBe('/b.ogg');
    expect(sound.pick(0.999)?.url).toBe('/b.ogg');
    // Ровно 1.0 из Math.random() не приходит, но округление не должно ронять.
    expect(sound.pick(1)?.url).toBe('/b.ogg');
  });

  it('пустой список — играть нечего и элементы не заводятся', () => {
    const sound = createClickSound(null);
    expect(sound.pick(0.5)).toBeNull();
    sound.play(prefs());
    expect(FakeAudio.nodes).toHaveLength(0);
  });
});

describe('click sound: воспроизведение', () => {
  it('заводит по элементу на url заранее, с preload', () => {
    createClickSound([{ url: '/a.ogg', weight: 1 }, { url: '/b.ogg', weight: 1 }]);
    expect(FakeAudio.nodes.map((n) => n.src)).toEqual(['/a.ogg', '/b.ogg']);
    expect(FakeAudio.nodes.every((n) => n.preload === 'auto')).toBe(true);
  });

  it('мьют и нулевая громкость эффектов — тишина', () => {
    const sound = createClickSound('/click.ogg');
    const node = FakeAudio.nodes[0]!;
    sound.play(prefs({ muted: true }));
    sound.play(prefs({ sfxVolume: 0 }));
    expect(node.plays).toBe(0);
  });

  it('громкость — ползунок эффектов на громкость варианта', () => {
    const sound = createClickSound([{ url: '/a.ogg', weight: 1, volume: 50 }]);
    const node = FakeAudio.nodes[0]!;
    sound.play(prefs({ sfxVolume: 80 }));
    expect(node.volume).toBeCloseTo(0.4);
    expect(node).toMatchObject({ plays: 1, currentTime: 0 });
  });

  it('клампит громкость сверху: 200% варианта не выходит за единицу', () => {
    const sound = createClickSound([{ url: '/a.ogg', weight: 1, volume: 200 }]);
    const node = FakeAudio.nodes[0]!;
    sound.play(prefs({ sfxVolume: 100 }));
    expect(node.volume).toBe(1);
    sound.play(prefs({ sfxVolume: 500 }));
    expect(node.volume).toBe(1);
  });

  it('частые клики переспускают звук копиями, а не ждут очереди', () => {
    const sound = createClickSound('/click.ogg');
    sound.play(prefs());
    sound.play(prefs());
    // Первый элемент ещё играет — на второй клик уходит копия.
    expect(FakeAudio.nodes).toHaveLength(2);
    expect(FakeAudio.nodes.map((n) => n.plays)).toEqual([1, 1]);

    // Освободившийся элемент переиспользуется, а не плодит третий.
    FakeAudio.nodes[0]!.paused = true;
    sound.play(prefs());
    expect(FakeAudio.nodes).toHaveLength(2);
    expect(FakeAudio.nodes[0]!.plays).toBe(2);
  });

  it('пул ограничен: очередь кликов не растит элементы бесконечно', () => {
    const sound = createClickSound('/click.ogg');
    for (let i = 0; i < 10; i++) sound.play(prefs());
    expect(FakeAudio.nodes).toHaveLength(4);
  });

  it('отказ play() не роняет клик', async () => {
    const sound = createClickSound('/click.ogg');
    FakeAudio.rejectNext = true;
    expect(() => sound.play(prefs())).not.toThrow();
    await Promise.resolve();
    expect(FakeAudio.nodes[0]!.plays).toBe(1);
  });
});
