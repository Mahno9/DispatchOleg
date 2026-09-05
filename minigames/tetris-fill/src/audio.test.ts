import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudio, pickSound } from './audio.js';

class FakeAudio {
  static nodes: FakeAudio[] = [];
  static rejectNext = false;
  paused = true;
  loop = false;
  volume = 1;
  plays = 0;
  loads = 0;
  ended?: () => void;
  constructor(public src: string | null) { FakeAudio.nodes.push(this); }
  play(): Promise<void> {
    this.plays++;
    if (FakeAudio.rejectNext) { FakeAudio.rejectNext = false; return Promise.reject(new Error('autoplay blocked')); }
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void { this.paused = true; }
  hasAttribute(): boolean { return this.src !== null; }
  removeAttribute(): void { this.src = null; }
  load(): void { this.loads++; }
  addEventListener(_type: string, listener: () => void): void { this.ended = listener; }
}

beforeEach(() => { FakeAudio.nodes = []; FakeAudio.rejectNext = false; vi.stubGlobal('Audio', FakeAudio); });
afterEach(() => vi.unstubAllGlobals());
describe('pickSound', () => {
  it('accepts the bare string form still shipped by old configs', () => {
    expect(pickSound('rotate.ogg')).toEqual({ url: 'rotate.ogg', volume: 100 });
    expect(pickSound('  ')).toBeUndefined();
    expect(pickSound(undefined)).toBeUndefined();
    expect(pickSound({ url: 'object.ogg' })).toBeUndefined();
  });

  it('drops entries without a positive weight or a usable url and clamps volume', () => {
    expect(pickSound([])).toBeUndefined();
    expect(pickSound([{ url: 'x.ogg', weight: 0 }, { url: ' ', weight: 5 }])).toBeUndefined();
    expect(pickSound([{ url: 'only.ogg', weight: 2, volume: 300 }])).toEqual({ url: 'only.ogg', volume: 100 });
    expect(pickSound([{ url: 'only.ogg', weight: 2, volume: -5 }])).toEqual({ url: 'only.ogg', volume: 0 });
    expect(pickSound([{ url: 'only.ogg', weight: 2 }])).toEqual({ url: 'only.ogg', volume: 100 });
  });

  it('spreads picks across the weighted list and falls back when the value is unusable', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(pickSound([{ url: 'a.ogg', weight: 1 }, { url: 'b.ogg', weight: 1 }])!.url);
    expect([...seen].sort()).toEqual(['a.ogg', 'b.ogg']);
    const audio = createAudio(undefined, {});
    audio.startLoop([{ url: 'bad.ogg', weight: 0 }], 'fallback.ogg');
    expect(FakeAudio.nodes.at(-1)).toMatchObject({ src: 'fallback.ogg', loop: true, paused: false });
    audio.startLoop('replacement.ogg');
    expect(FakeAudio.nodes.at(-1)?.src).toBe('replacement.ogg');
    expect(FakeAudio.nodes.slice(0, -1).every(node => node.paused && node.src === null)).toBe(true);
    audio.destroy();
  });
});

describe('music and audio lifetime', () => {
  it('retries blocked autoplay, pauses at musicVolume zero, and resumes the same element live', async () => {
    const audio = createAudio([{ url: 'music.ogg', weight: 1, volume: 80 }], { musicVolume: 50 });
    const music = FakeAudio.nodes[0]!;
    FakeAudio.rejectNext = true;
    audio.retryMusic();
    await Promise.resolve();
    expect(music.paused).toBe(true);
    audio.retryMusic();
    expect(music).toMatchObject({ paused: false, plays: 2, volume: 0.4, loop: true });
    audio.setVolume({ musicVolume: 0, sfxVolume: 100 });
    expect(music.paused).toBe(true);
    audio.retryMusic();
    expect(music.plays).toBe(2);
    audio.setVolume({ musicVolume: 100, sfxVolume: 100 });
    expect(music).toMatchObject({ paused: false, plays: 3, volume: 0.8 });
    expect(FakeAudio.nodes).toHaveLength(1);
    audio.destroy();
  });

  it('mutes and resumes music plus the current held ingredient without resetting its loop', () => {
    const audio = createAudio('music.ogg', { muted: true });
    audio.retryMusic();
    audio.startLoop('pour.ogg');
    expect(FakeAudio.nodes.every(n => n.plays === 0)).toBe(true);
    audio.setMuted(false);
    expect(FakeAudio.nodes.every(n => !n.paused)).toBe(true);
    audio.setVolume({ musicVolume: -10, sfxVolume: 150 });
    expect(FakeAudio.nodes[0]).toMatchObject({ paused: true, volume: 0 });
    expect(FakeAudio.nodes[1]).toMatchObject({ paused: false, volume: 1 });
    audio.setMuted(true);
    expect(FakeAudio.nodes.every(n => n.paused)).toBe(true);
    audio.destroy();
  });

  it('stops all in-flight effects on exit and cannot restart music after finish or destroy', () => {
    const audio = createAudio('music.ogg', {});
    audio.retryMusic();
    audio.startLoop('cook.ogg');
    audio.play('fail.ogg');
    audio.play('wipe.ogg');
    audio.finishMusic();
    audio.retryMusic();
    expect(FakeAudio.nodes[0]).toMatchObject({ paused: true, src: null, plays: 1 });
    audio.destroy();
    audio.destroy();
    audio.setVolume({ musicVolume: 100, sfxVolume: 100 });
    audio.retryMusic();
    audio.play('late.ogg');
    expect(FakeAudio.nodes).toHaveLength(4);
    expect(FakeAudio.nodes.every(node => node.paused && node.src === null && node.loads === 1)).toBe(true);
  });

  it('respects zero SFX gain and updates active one-shot volume', () => {
    const audio = createAudio(undefined, { sfxVolume: 0 });
    audio.play('silent.ogg');
    expect(FakeAudio.nodes).toHaveLength(0);
    audio.setVolume({ sfxVolume: 100 });
    audio.play([{ url: 'fail.ogg', weight: 1, volume: 40 }]);
    const effect = FakeAudio.nodes[0]!;
    audio.setVolume({ sfxVolume: 50 });
    expect(effect.volume).toBe(0.2);
    audio.setVolume({ sfxVolume: 0 });
    expect(effect).toMatchObject({ paused: true, src: null });
    audio.destroy();
  });
});
