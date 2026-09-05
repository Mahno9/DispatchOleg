import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLobbyMusic } from './useLobbyMusic';
import { DEFAULT_AUDIO_PREFS, type AudioPrefs } from '../state/localState';

// В плеере нет DOM-окружения (vitest в node, без jsdom), поэтому и элемент, и
// document подставляем заглушками — как в minigames/cooking-orders/src/audio.test.ts.
class FakeAudio {
  static nodes: FakeAudio[] = [];
  static rejectNext = false;
  paused = true;
  loop = false;
  volume = 1;
  plays = 0;
  loads = 0;
  constructor(public src: string | null) {
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
  pause(): void {
    this.paused = true;
  }
  hasAttribute(): boolean {
    return this.src !== null;
  }
  removeAttribute(): void {
    this.src = null;
  }
  load(): void {
    this.loads++;
  }
}

const listeners = new Set<() => void>();
const fakeDocument = {
  addEventListener: (_type: string, fn: () => void) => listeners.add(fn),
  removeEventListener: (_type: string, fn: () => void) => listeners.delete(fn),
};

/** Первый жест игрока в документе. */
function pointerdown(): void {
  for (const fn of [...listeners]) {
    listeners.delete(fn); // { once: true }
    fn();
  }
}

const prefs = (over: Partial<AudioPrefs> = {}): AudioPrefs => ({ ...DEFAULT_AUDIO_PREFS, ...over });

beforeEach(() => {
  FakeAudio.nodes = [];
  FakeAudio.rejectNext = false;
  listeners.clear();
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('document', fakeDocument);
});
afterEach(() => vi.unstubAllGlobals());

describe('lobby music', () => {
  it('играет в лобби зацикленно и встаёт на паузу вне его', () => {
    const music = createLobbyMusic('/assets-store/mus.ogg');
    const node = FakeAudio.nodes[0]!;
    expect(node).toMatchObject({ src: '/assets-store/mus.ogg', loop: true, paused: true });

    music.sync({ active: true, prefs: prefs() });
    expect(node).toMatchObject({ paused: false, plays: 1, volume: 0.7 });

    // Диалог/игра/победа — петля молчит, но элемент тот же.
    music.sync({ active: false, prefs: prefs() });
    expect(node.paused).toBe(true);
    music.sync({ active: true, prefs: prefs() });
    expect(node).toMatchObject({ paused: false, plays: 2 });
    expect(FakeAudio.nodes).toHaveLength(1);
    music.destroy();
  });

  it('мьют и нулевая громкость — это пауза, а не игра в ноль', () => {
    const music = createLobbyMusic('/assets-store/mus.ogg');
    const node = FakeAudio.nodes[0]!;

    music.sync({ active: true, prefs: prefs({ muted: true }) });
    expect(node).toMatchObject({ paused: true, plays: 0 });

    music.sync({ active: true, prefs: prefs({ musicVolume: 0 }) });
    expect(node).toMatchObject({ paused: true, plays: 0, volume: 0 });

    // Громкость доезжает вживую, элемент не пересоздаётся.
    music.sync({ active: true, prefs: prefs({ musicVolume: 40 }) });
    expect(node).toMatchObject({ paused: false, plays: 1, volume: 0.4 });
    expect(FakeAudio.nodes).toHaveLength(1);
    music.destroy();
  });

  it('клампит громкость вне диапазона', () => {
    const music = createLobbyMusic('/assets-store/mus.ogg');
    const node = FakeAudio.nodes[0]!;
    music.sync({ active: true, prefs: prefs({ musicVolume: 500 }) });
    expect(node.volume).toBe(1);
    music.sync({ active: true, prefs: prefs({ musicVolume: -20 }) });
    expect(node).toMatchObject({ volume: 0, paused: true });
    music.sync({ active: true, prefs: prefs({ musicVolume: Number.NaN }) });
    expect(node.volume).toBe(0);
    music.destroy();
  });

  it('добирает заблокированный автоплей на первом pointerdown, ровно один раз', async () => {
    const music = createLobbyMusic('/assets-store/mus.ogg');
    const node = FakeAudio.nodes[0]!;
    FakeAudio.rejectNext = true;
    music.sync({ active: true, prefs: prefs() });
    await Promise.resolve();
    expect(node).toMatchObject({ paused: true, plays: 1 });
    expect(listeners.size).toBe(1);

    // Пока ждём жеста, лишний sync не плодит вторую попытку и второй слушатель.
    music.sync({ active: true, prefs: prefs() });
    expect(node.plays).toBe(1);
    expect(listeners.size).toBe(1);

    pointerdown();
    expect(node).toMatchObject({ paused: false, plays: 2 });
    expect(listeners.size).toBe(0);
    music.destroy();
  });

  it('снимает добор автоплея, если игрок ушёл из лобби или выключил звук', async () => {
    const music = createLobbyMusic('/assets-store/mus.ogg');
    FakeAudio.rejectNext = true;
    music.sync({ active: true, prefs: prefs() });
    await Promise.resolve();
    expect(listeners.size).toBe(1);
    music.sync({ active: false, prefs: prefs() });
    expect(listeners.size).toBe(0);
    music.destroy();
  });

  it('на выходе снимает src и зовёт load(), а не гасит пустым src', async () => {
    const music = createLobbyMusic('/assets-store/mus.ogg');
    const node = FakeAudio.nodes[0]!;
    music.sync({ active: true, prefs: prefs() });
    music.destroy();
    expect(node).toMatchObject({ paused: true, src: null, loads: 1 });

    // После destroy ручки мертвы: ни play, ни повторного load.
    music.sync({ active: true, prefs: prefs() });
    expect(node).toMatchObject({ plays: 1, loads: 1 });

    // Отвергнутый play, долетевший после выхода, слушателя уже не вешает.
    const late = createLobbyMusic('/assets-store/late.ogg');
    FakeAudio.rejectNext = true;
    late.sync({ active: true, prefs: prefs() });
    late.destroy();
    await Promise.resolve();
    expect(listeners.size).toBe(0);
  });
});
