import type { Database } from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Client state payload types
// ---------------------------------------------------------------------------

export interface GameResult {
  bestScore: number;
  won: boolean;
  attempts: number;
  firstCompletedAt: number;
  rewardGranted?: boolean;
  /** Free-form per-minigame stats from onComplete({ details }), e.g. { wallsBroken: 3, styleTag: 'ghost' } */
  details?: Record<string, number | string>;
}

export interface ClientStatePayload {
  version: number;
  updatedAt: number;
  profile: {
    userId: string;
    name: string;
  };
  gameResults: Record<string, GameResult>;
  /** Tutorial finished (name entered, camera granted, first QR scanned). Merge = OR. */
  onboarded: boolean;
  prefs: Record<string, unknown>;
  /**
   * Admin-reset tombstones: gameId → removedAt (server clock, ms). Server-authoritative —
   * client echoes are ignored on merge. A merged gameResults entry is dropped when its
   * firstCompletedAt <= removedAt, so a stale client copy cannot resurrect a reset game,
   * while a genuine re-completion (fresh firstCompletedAt) survives.
   */
  removedGames?: Record<string, number>;
}

// ---------------------------------------------------------------------------
// resolveSync — pure function, no DB side-effects
// ---------------------------------------------------------------------------

export type SyncOutcome = 'accepted' | 'server-newer' | 'merged';

export interface ServerRow {
  payload: ClientStatePayload;
  clientUpdatedAt: number;
}

export interface ResolveResult {
  outcome: SyncOutcome;
  merged: ClientStatePayload;
}

/**
 * Merge gameResults from `other` into `base`, where `base` is always the side with
 * the newer updatedAt. Rules:
 *   - bestScore = max
 *   - attempts = max
 *   - won = OR
 *   - firstCompletedAt = min (earliest)
 *   - rewardGranted = OR
 *   - details = from the newer side (base), falling back to other
 *
 * Returns { merged, changed } where `changed` is true if anything in base was
 * actually altered by the merge.
 */
function mergeGameResults(
  base: Record<string, GameResult>,
  other: Record<string, GameResult>,
): { merged: Record<string, GameResult>; changed: boolean } {
  let changed = false;
  const merged: Record<string, GameResult> = { ...base };

  for (const [gameId, otherResult] of Object.entries(other)) {
    const baseResult = merged[gameId];
    if (!baseResult) {
      // New entry in other that base doesn't have
      merged[gameId] = { ...otherResult };
      changed = true;
      continue;
    }

    const bestScore = Math.max(baseResult.bestScore, otherResult.bestScore);
    const attempts = Math.max(baseResult.attempts, otherResult.attempts);
    const won = baseResult.won || otherResult.won;
    const firstCompletedAt = Math.min(baseResult.firstCompletedAt, otherResult.firstCompletedAt);
    const rewardGranted =
      baseResult.rewardGranted === undefined && otherResult.rewardGranted === undefined
        ? undefined
        : Boolean(baseResult.rewardGranted) || Boolean(otherResult.rewardGranted);
    // details are not mergeable field-by-field — the newer side (base) wins
    const details = baseResult.details ?? otherResult.details;

    if (
      bestScore !== baseResult.bestScore ||
      attempts !== baseResult.attempts ||
      won !== baseResult.won ||
      firstCompletedAt !== baseResult.firstCompletedAt ||
      rewardGranted !== baseResult.rewardGranted ||
      details !== baseResult.details
    ) {
      changed = true;
    }

    const entry: GameResult = { bestScore, won, attempts, firstCompletedAt };
    if (rewardGranted !== undefined) entry.rewardGranted = rewardGranted;
    if (details !== undefined) entry.details = details;
    merged[gameId] = entry;
  }

  return { merged, changed };
}

/**
 * Drop merged entries killed by admin-reset tombstones: an entry whose
 * firstCompletedAt <= removedAt is a stale pre-reset copy and must not survive.
 */
function applyTombstones(
  gameResults: Record<string, GameResult>,
  removedGames: Record<string, number> | undefined,
): { result: Record<string, GameResult>; changed: boolean } {
  if (!removedGames) return { result: gameResults, changed: false };
  let changed = false;
  const result = { ...gameResults };
  for (const [gameId, removedAt] of Object.entries(removedGames)) {
    const entry = result[gameId];
    if (entry !== undefined && entry.firstCompletedAt <= removedAt) {
      delete result[gameId];
      changed = true;
    }
  }
  return { result, changed };
}

export function resolveSync(
  serverRow: ServerRow | null,
  incoming: { state: ClientStatePayload; updatedAt: number },
): ResolveResult {
  // No server row → accept incoming as-is (minus any client-echoed tombstones —
  // those are server-authoritative and the server has none here)
  if (serverRow === null) {
    const state = { ...incoming.state };
    delete state.removedGames;
    return { outcome: 'accepted', merged: state };
  }

  const tombstones = serverRow.payload.removedGames;
  const onboarded = Boolean(incoming.state.onboarded) || Boolean(serverRow.payload.onboarded);

  if (incoming.updatedAt > serverRow.clientUpdatedAt) {
    // Incoming is newer — start from incoming, but max-merge server's gameResults in
    const { merged: unionResults, changed } = mergeGameResults(
      incoming.state.gameResults,
      serverRow.payload.gameResults,
    );
    const { result: gameResults, changed: tombstoned } = applyTombstones(unionResults, tombstones);
    const mergedPayload: ClientStatePayload = {
      ...incoming.state,
      gameResults,
      onboarded,
    };
    // Tombstones are server-authoritative — never keep the client's echo
    delete mergedPayload.removedGames;
    if (tombstones !== undefined) mergedPayload.removedGames = tombstones;
    return {
      // A tombstone kill also forces 'merged' so the client adopts the reset now,
      // not on the next sync cycle
      outcome:
        changed || tombstoned || onboarded !== Boolean(incoming.state.onboarded)
          ? 'merged'
          : 'accepted',
      merged: mergedPayload,
    };
  } else {
    // Server is newer or equal — start from server payload, but max-merge incoming's gameResults in
    const { merged: unionResults } = mergeGameResults(
      serverRow.payload.gameResults,
      incoming.state.gameResults,
    );
    const { result: gameResults } = applyTombstones(unionResults, tombstones);
    const mergedPayload: ClientStatePayload = {
      ...serverRow.payload,
      gameResults,
      onboarded,
    };
    return {
      outcome: 'server-newer',
      merged: mergedPayload,
    };
  }
}

// ---------------------------------------------------------------------------
// DB helpers for session & sync
// ---------------------------------------------------------------------------

export interface UserRow {
  id: string;
  name: string;
  onboarded: number;
  created_at: number;
}

export interface GameStateRow {
  user_id: string;
  payload: string;
  client_updated_at: number;
  synced_at: number;
}

export function findUserByName(db: Database, name: string): UserRow | null {
  return (
    (db.prepare('SELECT * FROM users WHERE name = ? COLLATE NOCASE').get(name) as
      | UserRow
      | undefined) ?? null
  );
}

export function findUserById(db: Database, id: string): UserRow | null {
  return (db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined) ?? null;
}

export function getGameState(db: Database, userId: string): GameStateRow | null {
  return (
    (db.prepare('SELECT * FROM game_states WHERE user_id = ?').get(userId) as
      | GameStateRow
      | undefined) ?? null
  );
}

/** Parsed sync payload for a user, or null when they have never synced. */
export function getStatePayload(db: Database, userId: string): ClientStatePayload | null {
  const row = getGameState(db, userId);
  return row ? (JSON.parse(row.payload) as ClientStatePayload) : null;
}

export function upsertGameState(
  db: Database,
  userId: string,
  payload: ClientStatePayload,
  clientUpdatedAt: number,
): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO game_states (user_id, payload, client_updated_at, synced_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       payload = excluded.payload,
       client_updated_at = excluded.client_updated_at,
       synced_at = excluded.synced_at`,
  ).run(userId, JSON.stringify(payload), clientUpdatedAt, now);
}

/** Mirror the payload's onboarded flag onto the user row (admin lists read it from there). */
export function setUserOnboarded(db: Database, userId: string, onboarded: boolean): void {
  db.prepare('UPDATE users SET onboarded = ? WHERE id = ?').run(onboarded ? 1 : 0, userId);
}
