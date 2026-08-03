import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/connection.js';
import {
  listMetaStages,
  createMetaStage,
  updateMetaStage,
  deleteMetaStage,
  type MetaStageInput,
} from '../repos/metaStages.js';

const bodyProps = {
  title: { type: 'string' },
  sortOrder: { type: 'integer' },
  background: { type: 'object' },
  characters: { type: 'array' },
  trigger: { type: 'object' },
} as const;

function pickInput(body: MetaStageInput): MetaStageInput {
  const input: MetaStageInput = {};
  for (const key of Object.keys(bodyProps) as (keyof MetaStageInput)[]) {
    if (key in body) (input as Record<string, unknown>)[key] = body[key];
  }
  return input;
}

export async function metaStagesRoutes(app: FastifyInstance) {
  // Public: the meta screen needs the stage list to render backgrounds/characters.
  app.get('/api/meta-stages', async () => listMetaStages(getDb()));

  app.post<{ Body: MetaStageInput }>(
    '/api/admin/meta-stages',
    {
      preHandler: app.requireAdmin,
      schema: { body: { type: 'object', properties: bodyProps } },
    },
    async (req, reply) => reply.code(201).send(createMetaStage(getDb(), pickInput(req.body))),
  );

  app.put<{ Params: { id: string }; Body: MetaStageInput }>(
    '/api/admin/meta-stages/:id',
    {
      preHandler: app.requireAdmin,
      schema: { body: { type: 'object', minProperties: 1, properties: bodyProps } },
    },
    async (req, reply) => {
      const stage = updateMetaStage(getDb(), Number(req.params.id), pickInput(req.body));
      if (!stage) return reply.code(404).send({ error: 'meta stage not found' });
      return stage;
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/admin/meta-stages/:id',
    { preHandler: app.requireAdmin },
    async (req, reply) => {
      if (!deleteMetaStage(getDb(), Number(req.params.id))) {
        return reply.code(404).send({ error: 'meta stage not found' });
      }
      return { ok: true };
    },
  );
}
