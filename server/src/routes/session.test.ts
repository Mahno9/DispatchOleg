import { describe, expect, it } from 'vitest';
import { applyAdminReset } from './session.js';
import { resolveSync, type ClientStatePayload } from '../repos/sync.js';

function payload(updatedAt: number): ClientStatePayload {
  return {
    version: 1,
    updatedAt,
    profile: { userId: 'u1', name: 'Oleg' },
    gameResults: { '7': { bestScore: 10, won: true, attempts: 1, firstCompletedAt: 500 } },
    onboarded: true,
    prefs: {},
  };
}

describe('applyAdminReset', () => {
  it('drops the result and records a tombstone', () => {
    const next = applyAdminReset(payload(1000), '7', 2000);
    expect(next.gameResults['7']).toBeUndefined();
    expect(next.removedGames).toEqual({ '7': 2000 });
  });

  it('a stale client copy cannot resurrect a reset game', () => {
    const server = applyAdminReset(payload(1000), '7', 2000);
    const { merged } = resolveSync(
      { payload: server, clientUpdatedAt: 1000 },
      { state: payload(3000), updatedAt: 3000 }, // client is newer but still has the old result
    );
    expect(merged.gameResults['7']).toBeUndefined();
    expect(merged.removedGames).toEqual({ '7': 2000 });
  });

  it('a genuine re-completion after the reset survives', () => {
    const server = applyAdminReset(payload(1000), '7', 2000);
    const replayed = payload(3000);
    replayed.gameResults['7'] = { bestScore: 5, won: true, attempts: 1, firstCompletedAt: 2500 };
    const { merged } = resolveSync(
      { payload: server, clientUpdatedAt: 1000 },
      { state: replayed, updatedAt: 3000 },
    );
    expect(merged.gameResults['7']?.firstCompletedAt).toBe(2500);
  });
});
