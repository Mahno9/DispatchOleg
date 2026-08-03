import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/connection.js';
import { listCharacters } from '../repos/characters.js';
import {
  listGames,
  getGame,
  createGame,
  updateGame,
  deleteGame,
  type GameInput,
} from '../repos/games.js';

const gameBodyProps = {
  title: { type: 'string', minLength: 1 },
  minigameId: { type: 'string', minLength: 1 },
  config: { type: 'object' },
  characterId: { type: ['integer', 'null'] },
  preDialogueId: { type: ['integer', 'null'] },
  postWinDialogueId: { type: ['integer', 'null'] },
  postLoseDialogueId: { type: ['integer', 'null'] },
  styleDialogues: { type: 'object' },
  requiredGameIds: { type: 'array', items: { type: 'integer' } },
  sortOrder: { type: 'integer' },
  isTutorial: { type: 'boolean' },
} as const;

type GameBody = GameInput & { title?: string; minigameId?: string };

function pickInput(body: GameBody): GameInput {
  const input: GameInput = {};
  for (const key of Object.keys(gameBodyProps) as (keyof GameBody)[]) {
    if (key in body) (input as Record<string, unknown>)[key] = body[key];
  }
  return input;
}

export async function gamesRoutes(app: FastifyInstance) {
  // ---- Public ----

  // GET /api/games — meta screen list. No config: it is handed out per game at launch.
  app.get('/api/games', async () => {
    const db = getDb();
    const characters = new Map(listCharacters(db).map((c) => [c.id, c]));
    return listGames(db).map((g) => ({
      id: g.id,
      title: g.title,
      minigameId: g.minigameId,
      isTutorial: g.isTutorial,
      requiredGameIds: g.requiredGameIds,
      sortOrder: g.sortOrder,
      character: g.characterId === null ? null : (characters.get(g.characterId) ?? null),
    }));
  });

  // GET /api/games/:id/config — minigameId + config + the dialogue wiring needed to
  // run the pre/post chain. Fetched when a game actually starts (after QR verify).
  app.get<{ Params: { id: string } }>('/api/games/:id/config', async (req, reply) => {
    const game = getGame(getDb(), Number(req.params.id));
    if (!game) return reply.code(404).send({ error: 'game not found' });
    return {
      id: game.id,
      title: game.title,
      minigameId: game.minigameId,
      config: game.config,
      characterId: game.characterId,
      preDialogueId: game.preDialogueId,
      postWinDialogueId: game.postWinDialogueId,
      postLoseDialogueId: game.postLoseDialogueId,
      styleDialogues: game.styleDialogues,
    };
  });

  // ---- Admin ----

  app.get('/api/admin/games', { preHandler: app.requireAdmin }, async () => listGames(getDb()));

  app.post<{ Body: GameBody & { title: string; minigameId: string } }>(
    '/api/admin/games',
    {
      preHandler: app.requireAdmin,
      schema: {
        body: {
          type: 'object',
          required: ['title', 'minigameId'],
          properties: gameBodyProps,
        },
      },
    },
    async (req, reply) => {
      const input = pickInput(req.body) as GameInput & { title: string; minigameId: string };
      return reply.code(201).send(createGame(getDb(), input));
    },
  );

  app.put<{ Params: { id: string }; Body: GameBody }>(
    '/api/admin/games/:id',
    {
      preHandler: app.requireAdmin,
      schema: { body: { type: 'object', minProperties: 1, properties: gameBodyProps } },
    },
    async (req, reply) => {
      const game = updateGame(getDb(), Number(req.params.id), pickInput(req.body));
      if (!game) return reply.code(404).send({ error: 'game not found' });
      return game;
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/admin/games/:id',
    { preHandler: app.requireAdmin },
    async (req, reply) => {
      if (!deleteGame(getDb(), Number(req.params.id))) {
        return reply.code(404).send({ error: 'game not found' });
      }
      return { ok: true };
    },
  );
}
