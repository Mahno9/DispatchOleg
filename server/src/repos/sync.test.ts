import { describe, expect, it } from 'vitest';
import { resolveSync, type ClientStatePayload, type GameResult, type ServerRow } from './sync.js';

function makePayload(
  updatedAt: number,
  gameResults: Record<string, GameResult> = {},
  extra: { onboarded?: boolean; removedGames?: Record<string, number> } = {},
): ClientStatePayload {
  return {
    version: 1,
    updatedAt,
    profile: { userId: 'u1', name: 'Oleg' },
    gameResults,
    onboarded: extra.onboarded ?? false,
    prefs: {},
    ...(extra.removedGames !== undefined ? { removedGames: extra.removedGames } : {}),
  };
}

function makeServerRow(payload: ClientStatePayload): ServerRow {
  return { payload, clientUpdatedAt: payload.updatedAt };
}

describe('resolveSync', () => {
  it('first sync: no server row → accepted', () => {
    const incoming = makePayload(1000, {
      g1: { bestScore: 100, won: true, attempts: 1, firstCompletedAt: 1000, rewardGranted: true },
    });
    const result = resolveSync(null, { state: incoming, updatedAt: incoming.updatedAt });
    expect(result.outcome).toBe('accepted');
    expect(result.merged).toEqual(incoming);
  });

  it('newer incoming wins → accepted when no server gameResults to merge', () => {
    const serverPayload = makePayload(500, {});
    const incoming = makePayload(1000, {
      g1: { bestScore: 50, won: false, attempts: 2, firstCompletedAt: 800 },
    });
    const result = resolveSync(makeServerRow(serverPayload), {
      state: incoming,
      updatedAt: incoming.updatedAt,
    });
    expect(result.outcome).toBe('accepted');
    expect(result.merged.gameResults['g1']?.bestScore).toBe(50);
  });

  it('stale incoming → server-newer', () => {
    const serverPayload = makePayload(2000, {
      g1: { bestScore: 200, won: true, attempts: 3, firstCompletedAt: 500 },
    });
    const incoming = makePayload(1000, {
      g1: { bestScore: 100, won: false, attempts: 1, firstCompletedAt: 500 },
    });
    const result = resolveSync(makeServerRow(serverPayload), {
      state: incoming,
      updatedAt: incoming.updatedAt,
    });
    expect(result.outcome).toBe('server-newer');
    expect(result.merged.gameResults['g1']?.bestScore).toBe(200);
  });

  it('max-merge: bestScore/attempts max, won OR, firstCompletedAt min', () => {
    const serverPayload = makePayload(500, {
      g1: { bestScore: 300, won: true, attempts: 5, firstCompletedAt: 400, rewardGranted: true },
    });
    const incoming = makePayload(1000, {
      g1: { bestScore: 150, won: false, attempts: 2, firstCompletedAt: 600, rewardGranted: false },
    });
    const result = resolveSync(makeServerRow(serverPayload), {
      state: incoming,
      updatedAt: incoming.updatedAt,
    });
    expect(result.outcome).toBe('merged');
    const g1 = result.merged.gameResults['g1'];
    expect(g1?.bestScore).toBe(300);
    expect(g1?.attempts).toBe(5);
    expect(g1?.won).toBe(true);
    expect(g1?.firstCompletedAt).toBe(400);
    expect(g1?.rewardGranted).toBe(true);
  });

  it('won is OR-merged even when the losing side has the higher score', () => {
    const serverPayload = makePayload(2000, {
      g1: { bestScore: 500, won: false, attempts: 4, firstCompletedAt: 900 },
    });
    const incoming = makePayload(500, {
      g1: { bestScore: 10, won: true, attempts: 1, firstCompletedAt: 900 },
    });
    const result = resolveSync(makeServerRow(serverPayload), {
      state: incoming,
      updatedAt: incoming.updatedAt,
    });
    expect(result.merged.gameResults['g1']?.won).toBe(true);
    expect(result.merged.gameResults['g1']?.bestScore).toBe(500);
  });

  it('details come from the newer side', () => {
    const serverPayload = makePayload(500, {
      g1: {
        bestScore: 10,
        won: true,
        attempts: 1,
        firstCompletedAt: 400,
        details: { styleTag: 'breaker', wallsBroken: 3 },
      },
    });
    const incoming = makePayload(1000, {
      g1: {
        bestScore: 10,
        won: true,
        attempts: 1,
        firstCompletedAt: 400,
        details: { styleTag: 'ghost', wallsBroken: 0 },
      },
    });
    // incoming newer → its details win
    expect(
      resolveSync(makeServerRow(serverPayload), {
        state: incoming,
        updatedAt: incoming.updatedAt,
      }).merged.gameResults['g1']?.details,
    ).toEqual({ styleTag: 'ghost', wallsBroken: 0 });

    // flip the clocks → server details win
    const newerServer = makeServerRow(
      makePayload(3000, serverPayload.gameResults as Record<string, GameResult>),
    );
    expect(
      resolveSync(newerServer, { state: incoming, updatedAt: incoming.updatedAt }).merged
        .gameResults['g1']?.details,
    ).toEqual({ styleTag: 'breaker', wallsBroken: 3 });
  });

  it('details from the only side that has them survive', () => {
    const serverPayload = makePayload(500, {
      g1: { bestScore: 10, won: true, attempts: 1, firstCompletedAt: 400, details: { hits: 7 } },
    });
    const incoming = makePayload(1000, {
      g1: { bestScore: 10, won: true, attempts: 1, firstCompletedAt: 400 },
    });
    const result = resolveSync(makeServerRow(serverPayload), {
      state: incoming,
      updatedAt: incoming.updatedAt,
    });
    expect(result.outcome).toBe('merged');
    expect(result.merged.gameResults['g1']?.details).toEqual({ hits: 7 });
  });

  it('onboarded is OR-merged in both directions', () => {
    const serverOnboarded = makeServerRow(makePayload(500, {}, { onboarded: true }));
    const incomingNotOnboarded = makePayload(1000, {}, { onboarded: false });
    const a = resolveSync(serverOnboarded, {
      state: incomingNotOnboarded,
      updatedAt: incomingNotOnboarded.updatedAt,
    });
    expect(a.merged.onboarded).toBe(true);
    // server contributed something the client didn't have → client must adopt it now
    expect(a.outcome).toBe('merged');

    const serverPlain = makeServerRow(makePayload(2000, {}, { onboarded: false }));
    const incomingOnboarded = makePayload(500, {}, { onboarded: true });
    expect(
      resolveSync(serverPlain, { state: incomingOnboarded, updatedAt: incomingOnboarded.updatedAt })
        .merged.onboarded,
    ).toBe(true);
  });

  it('new game in incoming is merged into server-newer result', () => {
    const serverPayload = makePayload(2000, {
      g1: { bestScore: 100, won: true, attempts: 1, firstCompletedAt: 300 },
    });
    const incoming = makePayload(500, {
      g2: { bestScore: 50, won: false, attempts: 1, firstCompletedAt: 400 },
    });
    const result = resolveSync(makeServerRow(serverPayload), {
      state: incoming,
      updatedAt: incoming.updatedAt,
    });
    expect(result.outcome).toBe('server-newer');
    expect(result.merged.gameResults['g2']?.bestScore).toBe(50);
    expect(result.merged.gameResults['g1']?.bestScore).toBe(100);
  });
});

describe('resolveSync tombstones (admin reset)', () => {
  const staleResult: GameResult = {
    bestScore: 50,
    won: true,
    attempts: 2,
    firstCompletedAt: 900,
    rewardGranted: true,
  };

  it('admin reset + unchanged client state → server-newer, stale entry stays dead', () => {
    const serverPayload = makePayload(5000, {}, { removedGames: { g1: 5000 } });
    const incoming = makePayload(1000, { g1: staleResult });
    const result = resolveSync(makeServerRow(serverPayload), {
      state: incoming,
      updatedAt: incoming.updatedAt,
    });
    expect(result.outcome).toBe('server-newer');
    expect(result.merged.gameResults['g1']).toBeUndefined();
    expect(result.merged.removedGames).toEqual({ g1: 5000 });
  });

  it('admin reset + client played OTHER games (incoming newer) → forced merged, reset holds', () => {
    const serverPayload = makePayload(5000, {}, { removedGames: { g1: 5000 } });
    const incoming = makePayload(6000, {
      g1: staleResult,
      g2: { bestScore: 70, won: true, attempts: 1, firstCompletedAt: 5900 },
    });
    const result = resolveSync(makeServerRow(serverPayload), {
      state: incoming,
      updatedAt: incoming.updatedAt,
    });
    expect(result.outcome).toBe('merged');
    expect(result.merged.gameResults['g1']).toBeUndefined();
    expect(result.merged.gameResults['g2']?.bestScore).toBe(70);
    expect(result.merged.removedGames).toEqual({ g1: 5000 });
  });

  it('genuine re-completion after adopted reset survives (fresh firstCompletedAt)', () => {
    const serverPayload = makePayload(5000, {}, { removedGames: { g1: 5000 } });
    const incoming = makePayload(7000, {
      g1: { bestScore: 80, won: true, attempts: 1, firstCompletedAt: 6500 },
    });
    const result = resolveSync(makeServerRow(serverPayload), {
      state: incoming,
      updatedAt: incoming.updatedAt,
    });
    expect(result.merged.gameResults['g1']?.bestScore).toBe(80);
  });

  it('tombstones are server-authoritative: client echo is ignored', () => {
    const serverPayload = makePayload(5000, {
      g1: { bestScore: 100, won: true, attempts: 1, firstCompletedAt: 5000 },
    });
    const incoming = makePayload(6000, { g1: staleResult }, { removedGames: { g1: 4000 } });
    const result = resolveSync(makeServerRow(serverPayload), {
      state: incoming,
      updatedAt: incoming.updatedAt,
    });
    expect(result.merged.gameResults['g1']?.bestScore).toBe(100);
    expect(result.merged.removedGames).toBeUndefined();
  });

  it('no server row: client-echoed tombstones are stripped', () => {
    const incoming = makePayload(1000, { g1: staleResult }, { removedGames: { g2: 500 } });
    const result = resolveSync(null, { state: incoming, updatedAt: incoming.updatedAt });
    expect(result.outcome).toBe('accepted');
    expect(result.merged.removedGames).toBeUndefined();
    expect(result.merged.gameResults['g1']?.bestScore).toBe(50);
  });
});
