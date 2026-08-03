import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { getDb } from '../db/connection.js';
import {
  findUserByName,
  findUserById,
  getGameState,
  getStatePayload,
  upsertGameState,
  setUserOnboarded,
  resolveSync,
  type UserRow,
  type ClientStatePayload,
} from '../repos/sync.js';

function userToDto(row: UserRow) {
  return { id: row.id, name: row.name, onboarded: row.onboarded !== 0 };
}

/**
 * Admin reset of one game for a user: drop the result and leave a
 * server-authoritative tombstone, so a stale client copy cannot resurrect it on
 * the next sync (see applyTombstones in repos/sync.ts).
 */
export function applyAdminReset(
  payload: ClientStatePayload,
  gameId: string,
  now = Date.now(),
): ClientStatePayload {
  const gameResults = { ...payload.gameResults };
  delete gameResults[gameId];
  return { ...payload, gameResults, removedGames: { ...payload.removedGames, [gameId]: now } };
}

export async function sessionRoutes(app: FastifyInstance) {
  // POST /api/session — find or create user by name (registration is name-only)
  app.post<{ Body: { name: string } }>(
    '/api/session',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string', minLength: 1, maxLength: 30 } },
        },
      },
    },
    async (req) => {
      const db = getDb();
      const { name } = req.body;

      let user = findUserByName(db, name);
      if (!user) {
        const id = nanoid(10);
        db.prepare('INSERT INTO users (id, name, onboarded, created_at) VALUES (?, ?, 0, ?)').run(
          id,
          name,
          Date.now(),
        );
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;
      }

      return { user: userToDto(user), state: getStatePayload(db, user.id) };
    },
  );

  // POST /api/sync — sync client state with server
  app.post<{ Body: { userId: string; state: ClientStatePayload } }>(
    '/api/sync',
    {
      schema: {
        body: {
          type: 'object',
          required: ['userId', 'state'],
          properties: {
            userId: { type: 'string' },
            state: {
              type: 'object',
              required: ['updatedAt'],
              properties: { updatedAt: { type: 'number' } },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const db = getDb();
      const { userId, state: incomingState } = req.body;

      const user = findUserById(db, userId);
      if (!user) return reply.code(404).send({ error: 'user not found' });

      const stateRow = db
        .prepare('SELECT payload, client_updated_at FROM game_states WHERE user_id = ?')
        .get(userId) as { payload: string; client_updated_at: number } | undefined;
      const serverRow = stateRow
        ? {
            payload: JSON.parse(stateRow.payload) as ClientStatePayload,
            clientUpdatedAt: stateRow.client_updated_at,
          }
        : null;

      const { outcome, merged } = resolveSync(serverRow, {
        state: incomingState,
        updatedAt: incomingState.updatedAt,
      });

      // For server-newer we keep the server's clientUpdatedAt, otherwise incoming's
      const clientUpdatedAt =
        outcome === 'server-newer' && serverRow !== null
          ? serverRow.clientUpdatedAt
          : incomingState.updatedAt;

      upsertGameState(db, userId, merged, clientUpdatedAt);
      if (merged.onboarded && user.onboarded === 0) setUserOnboarded(db, userId, true);

      return { outcome, state: merged, serverTime: Date.now() };
    },
  );

  // GET /api/state/:userId — current stored state
  app.get<{ Params: { userId: string } }>('/api/state/:userId', async (req, reply) => {
    const db = getDb();
    if (!findUserById(db, req.params.userId)) {
      return reply.code(404).send({ error: 'user not found' });
    }
    return { state: getStatePayload(db, req.params.userId) };
  });

  // ---- Admin ----

  // GET /api/admin/users — players with their synced progress
  app.get('/api/admin/users', { preHandler: app.requireAdmin }, async () => {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all() as UserRow[];
    // ponytail: one state query per user — admin list, tens of rows at most.
    return rows.map((row) => {
      const state = getGameState(db, row.id);
      const payload = state ? (JSON.parse(state.payload) as ClientStatePayload) : null;
      return {
        ...userToDto(row),
        createdAt: row.created_at,
        syncedAt: state?.synced_at ?? null,
        gameResults: payload?.gameResults ?? {},
      };
    });
  });

  // POST /api/admin/users/:id/reset — wipe one game's result for a player
  app.post<{ Params: { id: string }; Body: { gameId: number } }>(
    '/api/admin/users/:id/reset',
    {
      preHandler: app.requireAdmin,
      schema: {
        body: {
          type: 'object',
          required: ['gameId'],
          properties: { gameId: { type: 'integer' } },
        },
      },
    },
    async (req, reply) => {
      const db = getDb();
      if (!findUserById(db, req.params.id)) {
        return reply.code(404).send({ error: 'user not found' });
      }
      const state = getGameState(db, req.params.id);
      if (!state) return { ok: true, state: null }; // never synced — nothing to reset
      const next = applyAdminReset(
        JSON.parse(state.payload) as ClientStatePayload,
        String(req.body.gameId),
      );
      upsertGameState(db, req.params.id, next, state.client_updated_at);
      return { ok: true, state: next };
    },
  );

  // DELETE /api/admin/users/:id — remove a player (game_states cascades)
  app.delete<{ Params: { id: string } }>(
    '/api/admin/users/:id',
    { preHandler: app.requireAdmin },
    async (req, reply) => {
      const changes = getDb().prepare('DELETE FROM users WHERE id = ?').run(req.params.id).changes;
      if (changes === 0) return reply.code(404).send({ error: 'user not found' });
      return { ok: true };
    },
  );
}
