import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudio, pickSound } from '../../shared/audio.js';
import { currentStep, initialState, normalize, startPour } from './engine.js';

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

describe('ingredient audio', () => {
  it('preserves liquid, mixed and solid overrides through normalization and replaces the active loop', () => {
    const { ingredients, cfg } = normalize({
      ingredients: [{ id: 'soup', pourSound: 'liquid.ogg' }, { id: 'mayo', pourSound: [{ url: 'mixed.ogg', weight: 1 }] }, { id: 'flour', pourSound: 'solid.ogg' }, { id: 'new', pourSound: [] }],
      characters: [{ steps: ['soup', 'mayo', 'flour', 'new'].map(ingredientId => ({ ingredientId, amount: 1 })) }],
    });
    const audio = createAudio(undefined, {});
    for (let stepIndex = 0; stepIndex < 4; stepIndex++) {
      const state = startPour({ ...initialState(), stepIndex }, cfg, ingredients[stepIndex]!.id, 0);
      const ingredient = ingredients.find(i => i.id === currentStep(state, cfg)?.ingredientId);
      audio.startLoop(ingredient?.pourSound, 'fallback.ogg');
      expect(FakeAudio.nodes.at(-1)?.src).toBe(['liquid.ogg', 'mixed.ogg', 'solid.ogg', 'fallback.ogg'][stepIndex]);
      expect(FakeAudio.nodes.at(-1)?.paused).toBe(false);
      expect(FakeAudio.nodes.slice(0, -1).every(node => node.paused && node.src === null)).toBe(true);
    }
    audio.destroy();
  });

  it('uses fallback for invalid override but preserves an explicit zero volume', () => {
    const audio = createAudio(undefined, {});
    audio.startLoop([{ url: 'bad.ogg', weight: 0 }], 'fallback.ogg');
    expect(FakeAudio.nodes.at(-1)?.src).toBe('fallback.ogg');
    audio.startLoop([{ url: 'silent.ogg', weight: 1, volume: 0 }], 'fallback.ogg');
    expect(FakeAudio.nodes.at(-1)).toMatchObject({ src: 'silent.ogg', volume: 0, plays: 0 });
    expect(pickSound([{ url: 'clip.ogg', weight: 1, volume: 300 }])?.volume).toBe(100);
    audio.destroy();
  });
});
