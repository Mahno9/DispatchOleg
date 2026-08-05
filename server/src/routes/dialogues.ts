import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/connection.js';
import {
  listDialogues,
  getDialogue,
  createDialogue,
  updateDialogue,
  deleteDialogue,
  dialogueUsage,
} from '../repos/dialogues.js';

export async function dialoguesRoutes(app: FastifyInstance) {
  // ---- Public ----

  // GET /api/dialogues — id + title only (the player fetches nodes per dialogue)
  app.get('/api/dialogues', async () => listDialogues(getDb()));

  app.get<{ Params: { id: string } }>('/api/dialogues/:id', async (req, reply) => {
    const dialogue = getDialogue(getDb(), Number(req.params.id));
    if (!dialogue) return reply.code(404).send({ error: 'dialogue not found' });
    return dialogue;
  });

  // ---- Admin ----

  app.post<{ Body: { title: string; nodes?: unknown } }>(
    '/api/admin/dialogues',
    {
      preHandler: app.requireAdmin,
      schema: {
        body: {
          type: 'object',
          required: ['title'],
          properties: { title: { type: 'string', minLength: 1 }, nodes: { type: 'object' } },
        },
      },
    },
    async (req, reply) =>
      reply.code(201).send(createDialogue(getDb(), req.body.title, req.body.nodes ?? {})),
  );

  app.put<{ Params: { id: string }; Body: { title?: string; nodes?: unknown } }>(
    '/api/admin/dialogues/:id',
    {
      preHandler: app.requireAdmin,
      schema: {
        body: {
          type: 'object',
          minProperties: 1,
          properties: { title: { type: 'string', minLength: 1 }, nodes: { type: 'object' } },
        },
      },
    },
    async (req, reply) => {
      const input: { title?: string; nodes?: unknown } = {};
      if ('title' in req.body) input.title = req.body.title;
      if ('nodes' in req.body) input.nodes = req.body.nodes;
      const dialogue = updateDialogue(getDb(), Number(req.params.id), input);
      if (!dialogue) return reply.code(404).send({ error: 'dialogue not found' });
      return dialogue;
    },
  );

  // Кто ссылается на диалог — админка спрашивает перед удалением, чтобы
  // показать список и предупредить, что ссылки будут сняты.
  app.get<{ Params: { id: string } }>(
    '/api/admin/dialogues/:id/usage',
    { preHandler: app.requireAdmin },
    async (req, reply) => {
      const db = getDb();
      const id = Number(req.params.id);
      if (!getDialogue(db, id)) return reply.code(404).send({ error: 'dialogue not found' });
      return dialogueUsage(db, id);
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/admin/dialogues/:id',
    { preHandler: app.requireAdmin },
    async (req, reply) => {
      if (!deleteDialogue(getDb(), Number(req.params.id))) {
        return reply.code(404).send({ error: 'dialogue not found' });
      }
      return { ok: true };
    },
  );
}
