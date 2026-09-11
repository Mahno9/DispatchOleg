import { describe, expect, it } from 'vitest';
import { ambientFadeMix, ambientNeedsSync } from './index.js';

describe('ambient crossfade', () => {
  it('fades linearly in 1.2 seconds and clamps at both ends', () => {
    expect(ambientFadeMix(0, 1, -100)).toBe(0);
    expect(ambientFadeMix(0, 1, 600)).toBe(0.5);
    expect(ambientFadeMix(0, 1, 1200)).toBe(1);
    expect(ambientFadeMix(1, 0, 600)).toBe(0.5);
    expect(ambientFadeMix(1, 0, 2000)).toBe(0);
  });

  it('resyncs only noticeable finite drift', () => {
    expect(ambientNeedsSync(10, 10.1)).toBe(false);
    expect(ambientNeedsSync(10, 10.101)).toBe(true);
    expect(ambientNeedsSync(Number.NaN, 10)).toBe(false);
  });
});
