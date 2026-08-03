import { describe, expect, it } from 'vitest';
import { makeSessionToken, verifySessionToken } from './auth.js';

describe('session token', () => {
  it('round-trips a fresh token', () => {
    expect(verifySessionToken(makeSessionToken())).toBe(true);
  });

  it('rejects an expired token', () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    expect(verifySessionToken(makeSessionToken(eightDaysAgo))).toBe(false);
  });

  it('rejects a tampered token', () => {
    const token = makeSessionToken();
    const [payload] = token.split('.');
    expect(verifySessionToken(`${Number(payload) + 9999999}.${token.split('.')[1]}`)).toBe(false);
    expect(verifySessionToken('garbage')).toBe(false);
  });
});
