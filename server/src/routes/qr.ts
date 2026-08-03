import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import { config } from '../config.js';
import { getDb } from '../db/connection.js';
import { getGame } from '../repos/games.js';
import { getStatePayload, type GameResult } from '../repos/sync.js';

const SIG_LENGTH = 16; // hex chars — 64 bits of HMAC, plenty for a printed sticker
const PAYLOAD_RE = /^dispatch:(\d+):([0-9a-f]+)$/;

export function signGame(gameId: number): string {
  return crypto
    .createHmac('sha256', config.qrSecret)
    .update(String(gameId))
    .digest('hex')
    .slice(0, SIG_LENGTH);
}

export function qrPayload(gameId: number): string {
  return `dispatch:${gameId}:${signGame(gameId)}`;
}

/** Game id when the payload is well-formed and correctly signed, else null. */
export function parseQrPayload(payload: string): number | null {
  const match = PAYLOAD_RE.exec(payload.trim());
  if (!match) return null;
  const gameId = Number(match[1]);
  const sig = match[2]!;
  const expected = signGame(gameId);
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return gameId;
}

/** Required games the player has not won yet. */
export function missingRequirements(
  requiredIds: number[],
  results: Record<string, GameResult>,
): number[] {
  return requiredIds.filter((id) => results[String(id)]?.won !== true);
}

export async function qrRoutes(app: FastifyInstance) {
  // GET /api/admin/games/:id/qr.svg — printable code for a game
  app.get<{ Params: { id: string } }>(
    '/api/admin/games/:id/qr.svg',
    { preHandler: app.requireAdmin },
    async (req, reply) => {
      const gameId = Number(req.params.id);
      const game = getGame(getDb(), gameId);
      if (!game) return reply.code(404).send({ error: 'game not found' });
      const svg = await QRCode.toString(qrPayload(gameId), { type: 'svg', margin: 1, width: 512 });
      return reply.type('image/svg+xml').send(svg);
    },
  );

  // POST /api/qr/verify — signature + existence + unlock check for a scanned code
  app.post<{ Body: { payload: string; userId: string } }>(
    '/api/qr/verify',
    {
      schema: {
        body: {
          type: 'object',
          required: ['payload', 'userId'],
          properties: { payload: { type: 'string' }, userId: { type: 'string' } },
        },
      },
    },
    async (req) => {
      const gameId = parseQrPayload(req.body.payload);
      if (gameId === null) return { ok: false, reason: 'bad-signature' };

      const db = getDb();
      const game = getGame(db, gameId);
      if (!game) return { ok: false, reason: 'not-found' };

      const results = getStatePayload(db, req.body.userId)?.gameResults ?? {};
      const missing = missingRequirements(game.requiredGameIds, results);
      if (missing.length > 0) {
        return {
          ok: false,
          reason: 'locked',
          requiredTitles: missing.map((id) => getGame(db, id)?.title ?? `#${id}`),
        };
      }

      // isTutorial: the onboarding scan accepts the tutorial code only.
      return {
        ok: true,
        game: {
          id: game.id,
          title: game.title,
          minigameId: game.minigameId,
          isTutorial: game.isTutorial,
        },
      };
    },
  );
}
