import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/connection.js';
import {
  listCharacters,
  createCharacter,
  updateCharacter,
  deleteCharacter,
  type CharacterInput,
} from '../repos/characters.js';

const bodyProps = {
  name: { type: 'string', minLength: 1 },
  portraitAsset: { type: ['string', 'null'] },
  metaDialogueId: { type: ['integer', 'null'] },
  metaPosition: { type: 'string' },
  description: { type: 'string' },
} as const;

/** Отсекает всё, чего нет в `bodyProps`: тело запроса не должно писать чужие колонки. */
export function pickInput(body: CharacterInput): CharacterInput {
  const input: CharacterInput = {};
  for (const key of Object.keys(bodyProps) as (keyof CharacterInput)[]) {
    if (key in body) (input as Record<string, unknown>)[key] = body[key];
  }
  return input;
}

export async function charactersRoutes(app: FastifyInstance) {
  // Public: the meta screen needs portraits and meta dialogues
  app.get('/api/characters', async () => listCharacters(getDb()));

  app.post<{ Body: CharacterInput & { name: string } }>(
    '/api/admin/characters',
    {
      preHandler: app.requireAdmin,
      schema: { body: { type: 'object', required: ['name'], properties: bodyProps } },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send(createCharacter(getDb(), pickInput(req.body) as CharacterInput & { name: string })),
  );

  app.put<{ Params: { id: string }; Body: CharacterInput }>(
    '/api/admin/characters/:id',
    {
      preHandler: app.requireAdmin,
      schema: { body: { type: 'object', minProperties: 1, properties: bodyProps } },
    },
    async (req, reply) => {
      const character = updateCharacter(getDb(), Number(req.params.id), pickInput(req.body));
      if (!character) return reply.code(404).send({ error: 'character not found' });
      return character;
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/admin/characters/:id',
    { preHandler: app.requireAdmin },
    async (req, reply) => {
      if (!deleteCharacter(getDb(), Number(req.params.id))) {
        return reply.code(404).send({ error: 'character not found' });
      }
      return { ok: true };
    },
  );
}
