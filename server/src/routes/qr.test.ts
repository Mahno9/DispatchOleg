import { describe, expect, it } from 'vitest';
import { missingRequirements, parseQrPayload, qrPayload, signGame } from './qr.js';
import type { GameResult } from '../repos/sync.js';

const won: GameResult = { bestScore: 10, won: true, attempts: 1, firstCompletedAt: 1 };
const lost: GameResult = { bestScore: 0, won: false, attempts: 3, firstCompletedAt: 0 };

describe('qr payload', () => {
  it('round-trips a signed game id', () => {
    expect(parseQrPayload(qrPayload(42))).toBe(42);
    expect(qrPayload(42)).toMatch(/^dispatch:42:[0-9a-f]{16}$/);
  });

  it('rejects a tampered id (signature belongs to another game)', () => {
    expect(parseQrPayload(`dispatch:43:${signGame(42)}`)).toBeNull();
  });

  it('rejects malformed and truncated payloads', () => {
    expect(parseQrPayload('garbage')).toBeNull();
    expect(parseQrPayload('dispatch:42')).toBeNull();
    expect(parseQrPayload(`dispatch:42:${signGame(42).slice(0, 8)}`)).toBeNull();
    expect(parseQrPayload(`other:42:${signGame(42)}`)).toBeNull();
  });
});

describe('missingRequirements', () => {
  it('is empty when nothing is required', () => {
    expect(missingRequirements([], {})).toEqual([]);
  });

  it('lists games that are absent or not won', () => {
    expect(missingRequirements([1, 2, 3], { '1': won, '2': lost })).toEqual([2, 3]);
  });

  it('is empty when every requirement is won', () => {
    expect(missingRequirements([1, 2], { '1': won, '2': won })).toEqual([]);
  });
});
